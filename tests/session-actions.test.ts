import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store,scopeKey} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {botSchema,type CallerScope,type InboundMessage,type ChannelAdapter,type SessionBinding,type TurnSnapshot} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';
import type {DeferredSessionAction,SessionActionRecord} from '../src/core/session-actions.js';

const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};
let sequence=0;
const input=(text:string):InboundMessage=>({id:`action-${++sequence}`,scope,text,attachments:[],reply:{target:'real-user'},timestamp:Date.now()});
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};}
async function until(check:()=>boolean){for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('Timed out waiting for deferred action');}
async function fixture(t:any){
  const home=await mkdtemp(path.resolve('.codex/session-actions-'));const store=new Store(home);store.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true,trustedUsers:['alice']}));
  const sent:string[]=[];const assets=new Assets(store),media=new MediaService(store,assets);
  let onRun:((binding:SessionBinding,snapshot:TurnSnapshot,signal:AbortSignal)=>Promise<void>)|undefined;
  const harness:HarnessPort={run:async(binding,messages,signal)=>{const snapshot=freezeTurn(store.effectiveConfig(binding),store.bot('one'),scope,messages.map(m=>m.id));store.put('turn-snapshot',binding.sessionId,snapshot);await onRun?.(binding,snapshot,signal);store.markSessionPersisted(binding);return{turnId:`turn-${sequence}`,outputs:[],snapshot};},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{},inspectSession:async()=>{},compact:async()=> '压缩完成'};
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.from(''),send:async(_b,_c,d)=>{assert.deepEqual(d.reply,{target:'real-user'});sent.push(d.output.text??'');return'receipt';}};
  const credentials={read:async()=>({accountId:'one'}),write:async()=>{},remove:async()=>{}};
  const runtime=new BotRuntime(store,assets,media,harness,createChannelRegistry([{id:'qq',displayName:'QQ',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}},{id:'weixin',displayName:'Weixin',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}}]),credentials,60000);
  t.after(async()=>{await runtime.close();store.close();await rm(home,{recursive:true,force:true});});
  return{store,runtime,harness,sent,adapter,credentials,assets,media,onRun:(fn:typeof onRun)=>{onRun=fn;},records:()=>store.list<SessionActionRecord>('session-action'),run:async(text='please manage this session')=>{await runtime.receive(input(text));await runtime.process(scopeKey(scope));}};
}

test('a new-session tool returns queued during its own turn and executes once afterward without self-wait',async t=>{
  const f=await fixture(t);assert.equal(typeof f.runtime.queueSessionAction,'function');const old=f.store.binding(scope);const release=gate(),entered=gate();
  f.onRun(async(binding,snapshot,signal)=>{
    const a=f.runtime.queueSessionAction(binding,snapshot,{action:'new'},signal);const duplicate=f.runtime.queueSessionAction(binding,snapshot,{action:'new'},signal);
    assert.equal(a.status,'queued');assert.equal(a.actionId,duplicate.actionId);assert.equal(f.store.binding(scope).sessionId,old.sessionId);
    assert.throws(()=>f.runtime.queueSessionAction(binding,snapshot,{action:'stop'},signal),/SESSION_ACTION_ALREADY_QUEUED/);entered.resolve();await release.promise;
  });
  const working=f.run();await entered.promise;assert.equal(f.records()[0].state,'queued');release.resolve();await working;await until(()=>f.records()[0].state==='succeeded');
  assert.notEqual(f.store.binding(scope).sessionId,old.sessionId);assert.equal(f.store.sessions(scope).length,2);await f.runtime.flushDeliveries();assert.match(f.sent.at(-1)!,/已开启新会话/);
});

test('slash stop and natural new cancel queued actions and cannot deadlock the finishing turn',async t=>{
  for(const command of ['/stop','新建会话']){
    const f=await fixture(t);const entered=gate();
    f.onRun(async(binding,snapshot,signal)=>{f.runtime.queueSessionAction(binding,snapshot,{action:'new'},signal);entered.resolve();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));});
    const working=f.run();await entered.promise;await f.runtime.receive(input(command));await working;await until(()=>f.records()[0].state==='cancelled');
    assert.equal(f.store.sessions(scope).length,command==='/stop'?1:2);assert.equal(f.records()[0].state,'cancelled');
  }
});

test('queued compaction starts after the main turn and natural stop cancels it immediately',async t=>{
  const f=await fixture(t);const entered=gate();let aborted=false;
  f.harness.compact=async(_binding,signal)=>{entered.resolve();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));return'finished';};
  f.onRun(async(binding,snapshot,signal)=>{f.runtime.queueSessionAction(binding,snapshot,{action:'compact'},signal);});
  await f.run();await entered.promise;assert.equal(f.runtime.sessionStatus(scope),'compacting');await f.runtime.receive(input('停止'));assert.equal(aborted,true);assert.equal(f.records()[0].state,'cancelled');assert.equal(f.runtime.sessionStatus(scope),'idle');
});

test('stop during upgrade pause cancels queued and validating actions only in the caller scope',async t=>{
  for(const state of ['queued','running'] as const){
    const f=await fixture(t);const entered=gate(),release=gate();
    f.harness.validateModel=async()=>{entered.resolve();await release.promise;};
    f.onRun(async(b,s,signal)=>{f.runtime.queueSessionAction(b,s,{action:'persona',personaId:'sakura'},signal);if(state==='queued')f.runtime.pauseProcessing();});
    await f.run();if(state==='running')await entered.promise;
    const own=f.records()[0];const otherScope={...scope,senderId:'other',channelId:'other'};const otherBinding=f.store.binding(otherScope);const otherSource={...input('other request'),scope:otherScope};f.store.accept(otherSource);
    const other:SessionActionRecord={...own,id:`other-${state}`,scopeKey:otherBinding.key,scope:otherScope,sessionId:otherBinding.sessionId,generation:otherBinding.generation,sourceIds:[otherSource.id],sourceId:otherSource.id,action:{action:'new'},state:'queued'};f.store.put('session-action',other.id,other);
    const draining=f.runtime.quiesce();const stopping=f.runtime.receive(input('/stop'));
    try{assert.equal(f.store.get<SessionActionRecord>('session-action',own.id)?.state,'cancelled');assert.equal(f.store.get<SessionActionRecord>('session-action',other.id)?.state,'queued');}
    finally{release.resolve();await Promise.all([stopping,draining]);}
    assert.equal(f.store.binding(scope).personaId,undefined);assert.equal(f.store.get<SessionActionRecord>('session-action',other.id)?.state,'queued');
  }
});

test('deferred actions validate actual processing sources, frozen trust and host-independent permissions',async t=>{
  const f=await fixture(t);const config=f.store.config('default');f.store.saveConfig({...config,allowHostTools:false},config.revision);
  const binding=f.store.binding(scope);assert.throws(()=>f.runtime.queueSessionAction(binding,freezeTurn(f.store.effectiveConfig(binding),f.store.bot('one'),scope,[]),{action:'new'},new AbortController().signal),/SESSION_ACTION_SOURCE/);
  f.onRun(async(b,s,signal)=>{
    assert.throws(()=>f.runtime.queueSessionAction(b,{...s,sourceIds:['fabricated']},{action:'new'},signal),/SESSION_ACTION_SOURCE/);
    assert.throws(()=>f.runtime.queueSessionAction(b,{...s,trusted:false},{action:'persona',personaId:'sakura'},signal),/TRUSTED_PRIVATE_REQUIRED/);
    assert.equal(f.runtime.queueSessionAction(b,s,{action:'persona',personaId:'sakura'},signal).status,'queued');
  });await f.run();await until(()=>f.records()[0].state==='succeeded');assert.equal(f.store.binding(scope).personaId,'sakura');
});

test('revocation or persona revision changes during deferred validation prevents publication',async t=>{
  for(const change of ['trust','revision','stop']){
    const f=await fixture(t);const entered=gate(),release=gate();f.harness.validateModel=async()=>{entered.resolve();await release.promise;};
    f.onRun(async(b,s,signal)=>{f.runtime.queueSessionAction(b,s,{action:'persona',personaId:'sakura'},signal);});
    await f.run();await entered.promise;
    let stop:Promise<void>|undefined;
    if(change==='trust')f.runtime.saveBot({...f.store.bot('one'),trustedUsers:[]});
    else if(change==='revision'){const c=f.store.config('sakura');f.store.saveConfig({...c,name:'changed'},c.revision);}
    else stop=f.runtime.receive(input('/stop'));
    release.resolve();await stop;await until(()=>['failed','cancelled'].includes(f.records()[0].state));assert.equal(f.store.binding(scope).personaId,undefined);
  }
});

test('skill mutation receives a reauthorization callback and never applies to a newly selected persona',async t=>{
  const f=await fixture(t);let applied=false;const entered=gate(),release=gate();
  f.runtime.commandServices.skills={list:async()=>'',reload:async()=>'',toggle:async(_binding,_name,_enabled,authorize)=>{entered.resolve();await release.promise;authorize?.();applied=true;return'toggled';}};
  f.onRun(async(b,s,signal)=>{f.runtime.queueSessionAction(b,s,{action:'skill',name:'media-analysis',enabled:false},signal);});await f.run();await entered.promise;
  await f.runtime.switchPersona(scope,'sakura');release.resolve();await until(()=>f.records()[0].state==='failed');assert.equal(applied,false);
});

test('ordinary callers may queue their own session reset but foreign history restoration fails without replacement',async t=>{
  const f=await fixture(t);f.runtime.saveBot({...f.store.bot('one'),trustedUsers:[]});const original=f.store.binding(scope);
  const other=f.store.binding({...scope,senderId:'other',channelId:'other'});f.store.markSessionPersisted(other);
  f.onRun(async(b,s,signal)=>{f.runtime.queueSessionAction(b,s,{action:'resume',sessionId:other.sessionId},signal);});await f.run();await until(()=>f.records()[0].state==='failed'&&f.runtime.health().activeTasks===0);assert.equal(f.store.binding(scope).sessionId,original.sessionId);assert.match(f.records()[0].result!,/不属于/);
  f.onRun(async(b,s,signal)=>{f.runtime.queueSessionAction(b,s,{action:'new'},signal);});await f.run();await until(()=>f.records().some(r=>r.state==='succeeded'));assert.notEqual(f.store.binding(scope).sessionId,original.sessionId);
});

test('a cancelled tool signal prevents queueing and cancels a previously queued action before it runs',async t=>{
  const f=await fixture(t);const original=f.store.binding(scope);
  f.onRun(async(b,s)=>{const controller=new AbortController();f.runtime.queueSessionAction(b,s,{action:'new'},controller.signal);controller.abort();assert.throws(()=>f.runtime.queueSessionAction(b,s,{action:'new'},controller.signal),/abort/i);});
  await f.run();assert.equal(f.records()[0].state,'cancelled');assert.equal(f.store.binding(scope).sessionId,original.sessionId);
});

test('paused actions survive restart, running actions become unknown and queued actions precede new inbox work',async t=>{
  const f=await fixture(t);f.onRun(async(b,s,signal)=>{f.runtime.queueSessionAction(b,s,{action:'new'},signal);f.runtime.pauseProcessing();});
  await f.run();assert.equal(f.records()[0].state,'queued');await f.runtime.receive(input('must be cancelled by new'));await f.runtime.quiesce();await f.runtime.close();
  const queued=f.records()[0];const unknown={...queued,id:'interrupted-action',state:'running' as const,action:{action:'compact'} as DeferredSessionAction};f.store.put('session-action',unknown.id,unknown);
  f.store.mark(queued.scopeKey,queued.sourceIds,'processing');
  let runs=0;const nextHarness={...f.harness,run:async()=>{runs++;throw Error('ordinary inbox ran before action');}};
  const next=new BotRuntime(f.store,f.assets,f.media,nextHarness,createChannelRegistry([{id:'qq',displayName:'QQ',adapter:f.adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}},{id:'weixin',displayName:'Weixin',adapter:f.adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}}]),f.credentials,0);next.pauseProcessing();await next.initialize();
  assert.equal(f.store.get<SessionActionRecord>('session-action',unknown.id)?.state,'interrupted');assert.equal(f.store.get<SessionActionRecord>('session-action',queued.id)?.state,'queued');
  assert.deepEqual(f.store.messages(queued.scopeKey,['interrupted']).map(m=>m.id),queued.sourceIds);
  next.resumeProcessing();await until(()=>f.store.get<SessionActionRecord>('session-action',queued.id)?.state==='succeeded');assert.equal(runs,0);assert.equal(f.store.sessions(scope).length,2);await next.close();
});

test('recovered compact consumes no later input and never replays its interrupted source turn',async t=>{
  const f=await fixture(t);f.onRun(async(b,s,signal)=>{f.runtime.queueSessionAction(b,s,{action:'compact'},signal);f.runtime.pauseProcessing();});await f.run();await f.runtime.close();
  const record=f.records()[0];f.store.mark(record.scopeKey,record.sourceIds,'processing');const later=input('new independent message');f.store.accept(later);let runs=0,compactions=0;
  const harness:HarnessPort={...f.harness,compact:async()=>{compactions++;return'compacted';},run:async(_b,messages)=>{runs++;assert.equal(f.store.get<SessionActionRecord>('session-action',record.id)?.state,'succeeded');assert.deepEqual(messages.map(m=>m.id),[later.id]);return{turnId:'later',outputs:[],snapshot:freezeTurn(f.store.config('default'),f.store.bot('one'),scope,[later.id])};}};
  const next=new BotRuntime(f.store,f.assets,f.media,harness,createChannelRegistry([{id:'qq',displayName:'QQ',adapter:f.adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}},{id:'weixin',displayName:'Weixin',adapter:f.adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}}]),f.credentials,0);await next.initialize();try{await until(()=>runs===1);assert.equal(compactions,1);assert.deepEqual(f.store.messages(record.scopeKey,['interrupted']).map(m=>m.id),record.sourceIds);}finally{await next.close();}
});

test('natural commands recover from control inbox while quoted and escaped text remain ordinary chat',async t=>{
  const f=await fixture(t);f.runtime.pauseProcessing();await f.runtime.receive(input('查看当前状态'));assert.equal(f.store.messages(scopeKey(scope),['control']).length,1);f.runtime.resumeProcessing();await until(()=>f.store.messages(scopeKey(scope),['control']).length===0);assert.match(f.sent[0],/会话：/);
  await f.runtime.receive({...input('解释这个词'),quoted:{text:'停止'}});await f.runtime.receive(input('//停止'));assert.deepEqual(f.store.messages(scopeKey(scope)).map(m=>m.text),['解释这个词','/停止']);
});
