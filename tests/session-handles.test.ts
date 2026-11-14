import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {AgentRegistry,type Agent,type AgentFactory,type AgentHandle} from '@deepseek-ai/dsh-agent';
import {SessionId} from '@deepseek-ai/dsh-session';
import {SessionHandles} from '../src/harness/session-handles.js';

function gate(){let resolve!:()=>void;let reject!:(error:Error)=>void;const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
async function fixture(t:TestContext){
  const root=new Context();
  t.after(async()=>{await root.fiber.dispose();while(root.fiber.inertia)await root.fiber.inertia;});
  await root.plugin(AgentRegistry);
  const registry=root.get('agents')!;
  const handles=new Map<string,AgentHandle>(),owners=new Map<string,Context>(),disposeCalls:string[]=[],disposeInvocations:string[]=[];
  const beforeCreate=new Map<string,()=>Promise<void>>(),beforeDispose=new Map<string,()=>Promise<void>>(),factoryCalls:string[]=[];
  const make=async(owner:Context,id:string):Promise<AgentHandle>=>{
    factoryCalls.push(id);
    owners.set(id,owner);await beforeCreate.get(id)?.();
    const agent={id:SessionId(id),session:{id:SessionId(id)},ctx:owner} as Agent;
    const detach=registry.enter(agent,undefined);let disposing:Promise<void>|undefined;
    const handle:AgentHandle={agent,dispose(){disposeInvocations.push(id);return disposing??=(async()=>{disposeCalls.push(id);await beforeDispose.get(id)?.();detach();})();}};
    handles.set(id,handle);await registry.announce(agent,'startup');return handle;
  };
  const factory:AgentFactory={createAgent:(owner,options)=>make(owner,options.sessionId),resume:(owner,options)=>make(owner,options.resumeSessionId)};
  registry.setFactory(factory);
  let tracker!:SessionHandles,caller!:Context,web!:Context;
  const trackerFiber=await root.plugin({name:'session-handle-tracker',inject:['agents'],apply(ctx:Context){tracker=new SessionHandles(ctx);}});
  await root.plugin({name:'session-handle-caller',inject:['agents'],apply(ctx:Context){caller=ctx;}});
  await root.plugin({name:'session-handle-web',inject:['agents'],apply(ctx:Context){web=ctx;}});
  return{root,registry,caller,web,tracker,trackerFiber,handles,owners,disposeCalls,disposeInvocations,beforeCreate,beforeDispose,factoryCalls};
}

test('public creation keeps the caller context and returns the exact handle; deletion releases only requested sessions',async t=>{
  const f=await fixture(t);
  const created=await f.caller.agents.create({sessionId:SessionId('created')});
  const resumed=await f.caller.agents.resume({resumeSessionId:SessionId('resumed')});
  assert.equal(created,f.handles.get('created'));assert.equal(resumed,f.handles.get('resumed'));
  assert.equal(f.owners.get('created')?.fiber,f.caller.fiber);assert.equal(f.owners.get('resumed')?.fiber,f.caller.fiber);
  assert.equal(f.caller.agents.get(created.agent.id),created.agent);
  assert.equal(f.caller.agents.list().length,2);
  assert.equal(await f.tracker.deleting(['created'],async()=>{assert.equal(f.registry.get(created.agent.id),undefined);return 'deleted';}),'deleted');
  assert.deepEqual(f.disposeCalls,['created']);assert.equal(f.registry.get(resumed.agent.id),resumed.agent);
  assert.ok(await f.caller.agents.create({sessionId:created.agent.id}));
});

test('Web and bot entry points resume the same native handle without replacing the agent',async t=>{
  const f=await fixture(t),id=SessionId('shared');
  const first=await f.web.agents.resume({resumeSessionId:id});
  const resumed=await f.caller.agents.resume({resumeSessionId:id});
  assert.equal(resumed,first);assert.equal(f.tracker.get(id),first);
  assert.equal(f.registry.get(id),first.agent);
  assert.equal(f.owners.get(id)?.fiber,f.web.fiber);
  assert.deepEqual(f.factoryCalls,['shared']);assert.deepEqual(f.disposeCalls,[]);
  await first.dispose();assert.equal(f.tracker.get(id),undefined);
  const next=await f.caller.agents.resume({resumeSessionId:id});
  assert.notEqual(next,first);assert.equal(f.tracker.get(id),next);
  assert.deepEqual(f.factoryCalls,['shared','shared']);
});

test('concurrent create and resume share only one in-flight native creation',async t=>{
  const f=await fixture(t),id=SessionId('shared'),entered=gate(),finish=gate();
  f.beforeCreate.set(id,async()=>{entered.resolve();await finish.promise;});
  const creating=f.web.agents.create({sessionId:id});await entered.promise;
  const resuming=f.caller.agents.resume({resumeSessionId:id});
  const another=f.caller.agents.create({sessionId:id});
  assert.deepEqual(f.factoryCalls,['shared']);finish.resolve();
  const [first,second,third]=await Promise.all([creating,resuming,another]);
  assert.equal(second,first);assert.equal(third,first);
  assert.equal(f.tracker.get(id),first);assert.deepEqual(f.factoryCalls,['shared']);
});

test('concurrent resumes share a failure and a later request can retry',async t=>{
  const f=await fixture(t),id=SessionId('retry'),entered=gate(),finish=gate(),failure=Error('load failed');
  f.beforeCreate.set(id,async()=>{entered.resolve();await finish.promise;});
  const first=f.web.agents.resume({resumeSessionId:id});await entered.promise;
  const second=f.caller.agents.resume({resumeSessionId:id});
  const failures=Promise.all([assert.rejects(first,error=>error===failure),assert.rejects(second,error=>error===failure)]);
  finish.reject(failure);await failures;assert.equal(f.tracker.get(id),undefined);
  f.beforeCreate.delete(id);
  const retried=await f.caller.agents.resume({resumeSessionId:id});
  assert.equal(f.tracker.get(id),retried);assert.deepEqual(f.factoryCalls,['retry','retry']);
});

test('waiting for a published agent waits until its creation listeners finish',async t=>{
  const f=await fixture(t),id=SessionId('publishing'),entered=gate(),finish=gate();
  const detach=f.root.on('agent/created',async({agent})=>{if(agent.id===id){entered.resolve();await finish.promise;}});
  const creating=f.web.agents.resume({resumeSessionId:id});
  try{
    await entered.promise;assert.ok(f.registry.get(id));assert.equal(f.tracker.get(id),undefined);
    let settled=false;const waiting=f.tracker.wait(id).then(handle=>{settled=true;return handle;});
    await Promise.resolve();assert.equal(settled,false);
    finish.resolve();const created=await creating;assert.equal(await waiting,created);
    assert.equal(await f.tracker.wait(id),created);assert.equal(await f.tracker.wait('absent'),undefined);
  }finally{finish.resolve();await creating;detach();}
});

test('completed creation keeps native duplicate-create semantics and bare agents do not fabricate handles',async t=>{
  const f=await fixture(t),id=SessionId('created');
  const created=await f.caller.agents.create({sessionId:id});
  await assert.rejects(f.web.agents.create({sessionId:id}),/already registered/);
  assert.equal(f.tracker.get(id),created);
  const bare=await f.registry.resume({resumeSessionId:SessionId('bare')});
  assert.equal(f.tracker.get('bare'),undefined);
  await assert.rejects(f.caller.agents.resume({resumeSessionId:bare.agent.id}),/already registered/);
  assert.equal(f.tracker.get('bare'),undefined);assert.equal(f.registry.get(bare.agent.id),bare.agent);
});

test('disposing a session waits for in-flight resume and releases its real handle',async t=>{
  const f=await fixture(t),id=SessionId('release'),entered=gate(),finish=gate();
  f.beforeCreate.set(id,async()=>{entered.resolve();await finish.promise;});
  const creating=f.web.agents.resume({resumeSessionId:id});await entered.promise;
  const disposing=f.tracker.dispose(id);
  await assert.rejects(f.caller.agents.resume({resumeSessionId:id}),{code:'SESSION_QUERY_SESSION_NOT_FOUND'});
  finish.resolve();await creating;await disposing;
  assert.equal(f.tracker.get(id),undefined);assert.equal(f.registry.get(id),undefined);
  assert.deepEqual(f.disposeCalls,['release']);
  assert.ok(await f.caller.agents.resume({resumeSessionId:id}));
});

test('deletion waits for admitted creation and blocks new create and resume until its operation settles',async t=>{
  const f=await fixture(t),entered=gate(),finish=gate(),operation=gate();
  f.beforeCreate.set('target',async()=>{entered.resolve();await finish.promise;});
  const creating=f.caller.agents.resume({resumeSessionId:SessionId('target')});await entered.promise;
  let running=false;
  const deleting=f.tracker.deleting(['target'],async()=>{running=true;assert.deepEqual(f.disposeCalls,['target']);await operation.promise;});
  await assert.rejects(f.caller.agents.create({sessionId:SessionId('target')}),{code:'SESSION_QUERY_SESSION_NOT_FOUND'});
  assert.equal(running,false);finish.resolve();await creating;
  while(!running)await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(f.caller.agents.resume({resumeSessionId:SessionId('target')}),{code:'SESSION_QUERY_SESSION_NOT_FOUND'});
  operation.resolve();await deleting;
  assert.ok(await f.caller.agents.resume({resumeSessionId:SessionId('target')}));
});

test('failed in-flight creation does not block deletion, and failed deletion unlocks the identity',async t=>{
  const f=await fixture(t),entered=gate(),finish=gate(),failure=Error('creation failed'),operationFailure=Error('delete failed');
  f.beforeCreate.set('target',async()=>{entered.resolve();await finish.promise;});
  const creating=f.caller.agents.create({sessionId:SessionId('target')});
  const rejected=assert.rejects(creating,error=>error===failure);await entered.promise;
  const deleting=f.tracker.deleting(['target'],async()=>{throw operationFailure;});
  finish.reject(failure);await rejected;
  await assert.rejects(deleting,error=>error===operationFailure);
  f.beforeCreate.delete('target');assert.ok(await f.caller.agents.create({sessionId:SessionId('target')}));
});

test('disposed notifications clear captured handles, including a child disposed by its parent',async t=>{
  const f=await fixture(t);
  const parent=await f.caller.agents.create({sessionId:SessionId('parent')});
  const child=await f.caller.agents.create({sessionId:SessionId('child')});
  const other=await f.caller.agents.create({sessionId:SessionId('other')});
  f.beforeDispose.set('parent',()=>child.dispose());
  await f.tracker.deleting([parent.agent.id,child.agent.id],async()=>{});
  assert.deepEqual(f.disposeInvocations,['parent','child']);
  await other.dispose();await f.tracker.deleting([other.agent.id],async()=>{});
  assert.deepEqual(f.disposeInvocations,['parent','child','other']);
});

test('deletion drains manager-owned descendants of exact target agents before releasing parents',async t=>{
  const f=await fixture(t),entered=gate(),finish=gate(),events:string[]=[];
  const parent=await f.caller.agents.create({sessionId:SessionId('parent')});
  const child=await f.caller.agents.create({sessionId:SessionId('managed-child')});
  const other=await f.caller.agents.create({sessionId:SessionId('other')});
  f.beforeDispose.set('parent',async()=>{events.push('parent-disposed');assert.equal(f.registry.get(child.agent.id),undefined);});
  f.root.reflect.provide('subagents',{async drainDescendants(parents:readonly Agent[]){
    assert.deepEqual(parents,[parent.agent]);assert.equal(parents[0],parent.agent);
    assert.equal(f.registry.get(parent.agent.id),parent.agent);
    events.push('draining');entered.resolve();await finish.promise;
    await child.dispose();events.push('drained');
  }});
  const deleting=f.tracker.deleting([parent.agent.id,'cold'],async()=>{events.push('removed');});
  await entered.promise;assert.deepEqual(f.disposeInvocations,[]);
  finish.resolve();await deleting;
  assert.deepEqual(events,['draining','drained','parent-disposed','removed']);
  assert.deepEqual(f.disposeInvocations,['managed-child','parent']);
  assert.equal(f.registry.get(other.agent.id),other.agent);
});

test('unloading the registry removes interception without disposing externally created handles',async t=>{
  const f=await fixture(t),registry=f.caller.agents;
  const handle=await registry.create({sessionId:SessionId('external')});
  await f.trackerFiber.dispose();
  assert.deepEqual(f.disposeCalls,[]);assert.equal(f.registry.get(handle.agent.id),handle.agent);assert.equal(f.tracker.get(handle.agent.id),undefined);
  assert.ok(await registry.create({sessionId:SessionId('cached-registry')}));
  assert.ok(await f.caller.agents.create({sessionId:SessionId('after-unload')}));
  assert.deepEqual(f.disposeCalls,[]);
});
