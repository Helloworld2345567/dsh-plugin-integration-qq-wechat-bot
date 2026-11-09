import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {botSchema,type ChannelAdapter,type CallerScope,type InboundMessage} from '../src/core/types.js';
import {scopeKey} from '../src/core/identity.js';
import {freezeTurn} from '../src/core/policy.js';
import type {SessionActionRecord} from '../src/core/session-actions.js';

const scope=(id='one'):CallerScope=>({botId:id,platform:'fixture',accountId:id,kind:'private',channelId:'user',senderId:'user'});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};}

async function fixture(t:any){
  const home=await mkdtemp(path.resolve('.codex/runtime-service-')),store=new SqlitePersistence(home),assets=new Assets(store.repositories());
  for(const [id,enabled] of [['one',true],['two',true],['off',false]] as const)store.bots.saveBot(botSchema.parse({id,name:id,channel:'fixture',accountId:id,enabled,trustedUsers:['user']}));
  const connected:string[]=[],disconnected:string[]=[],sent:string[]=[],runs:string[]=[];
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async(bot,_credential,_receive,signal)=>{connected.push(bot.id);await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{disconnected.push(bot.id);resolve();},{once:true}));},materialize:async()=>Buffer.alloc(0),send:async(_bot,_credential,delivery)=>{sent.push(delivery.output.text??'');return'receipt';}};
  const harness:HarnessPort={run:async(binding,messages)=>{runs.push(binding.scope.botId);return{turnId:'turn',outputs:[{type:'text',text:'reply'}],snapshot:freezeTurn(store.personas.effectiveConfig(binding),store.bots.bot(binding.scope.botId),binding.scope,messages.map(message=>message.id))};},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const credentials={read:async(id:string)=>({accountId:id}),write:async()=>{},remove:async()=>{}};
  const runtime=new BotRuntime(store.repositories(),assets,new MediaService(store.repositories(),assets),harness,createChannelRegistry([{id:'fixture',displayName:'Fixture',adapter,capabilities:{conversations:['private'],login:[],groupSupport:'unsupported'}}]),credentials,60000);
  t.after(async()=>{await runtime.close();store.close();await rm(home,{recursive:true,force:true});});
  let sequence=0;
  const enqueue=(text:string,id='one')=>{const binding=store.sessions.binding(scope(id));return store.deliveries.enqueue(binding,`source-${++sequence}`,`turn-${sequence}`,[{type:'text',text}],{});};
  return{store,runtime,adapter,credentials,connected,disconnected,sent,runs,enqueue};
}

test('loading management with autoStart false preserves pending work without connecting or consuming it',async t=>{
  const f=await fixture(t),binding=f.store.sessions.binding(scope()),key=scopeKey(scope());
  f.enqueue('preserved');
  const message:InboundMessage={id:'pending',scope:scope(),text:'hello',timestamp:Date.now(),attachments:[],reply:{}};
  f.store.inbox.accept(message);f.store.inbox.accept({...message,id:'control',text:'/status'});f.store.inbox.mark(key,['control'],'control');
  const action:SessionActionRecord={id:'queued-action',scopeKey:key,scope:scope(),sessionId:binding.sessionId,generation:binding.generation,sourceIds:['pending'],sourceId:'pending',action:{action:'new'},trusted:true,personaId:'default',personaRevision:1,state:'queued',createdAt:Date.now(),updatedAt:Date.now()};
  f.store.sessionActions.saveSessionAction(action.id,action);
  f.store.jobs.saveJob('old-running',{id:'old-running',operation:'image_convert',state:'running'});
  await f.runtime.initialize({autoStart:false});
  f.runtime.resumeProcessing();f.runtime.resumeCommands();f.runtime.resumeSessionActions();await f.runtime.process(key);await f.runtime.flushDeliveries();await f.runtime.deliveryWorker.flush();
  await f.runtime.receive({...message,id:'ignored'});await tick();
  assert.equal(f.runtime.serviceRunning(),false);assert.equal(f.runtime.health().serviceRunning,false);
  assert.deepEqual(f.connected,[]);assert.deepEqual(f.sent,[]);assert.deepEqual(f.runs,[]);
  assert.equal(f.store.deliveries.deliveries(['pending']).length,1);assert.equal(f.store.inbox.messages(key,['control']).length,1);assert.equal(f.store.inbox.source(key,'ignored'),undefined);
  assert.equal(f.store.sessionActions.findSessionAction<SessionActionRecord>(action.id)?.state,'queued');assert.equal(f.store.sessions.binding(scope()).sessionId,binding.sessionId);
  assert.equal(f.store.jobs.findJob('old-running')?.state,'interrupted');
});

test('service start restores enabled bots and stop preserves their settings and pending deliveries for restart',async t=>{
  const f=await fixture(t);await f.runtime.initialize({autoStart:false});f.enqueue('first');
  await Promise.all([f.runtime.startService(),f.runtime.startService()]);await f.runtime.flushDeliveries();
  assert.deepEqual(f.connected.sort(),['one','two']);assert.deepEqual(f.sent,['first']);assert.equal(f.runtime.serviceRunning(),true);
  await Promise.all([f.runtime.stopService(),f.runtime.stopService()]);assert.equal(f.runtime.serviceRunning(),false);assert.deepEqual(f.disconnected.sort(),['one','two']);
  assert.equal(f.store.bots.bot('one').enabled,true);assert.equal(f.store.bots.bot('two').enabled,true);assert.equal(f.store.bots.bot('off').enabled,false);
  f.enqueue('after-stop');await f.runtime.flushDeliveries();await f.runtime.deliveryWorker.flush();assert.deepEqual(f.sent,['first']);assert.equal(f.store.deliveries.deliveries(['pending']).length,1);
  await f.runtime.startService();await f.runtime.flushDeliveries();assert.deepEqual(f.sent,['first','after-stop']);assert.equal(f.connected.length,4);
});

test('stopping aborts an active delivery and does not submit the remaining lane items',async t=>{
  const f=await fixture(t),entered=gate();await f.runtime.initialize({autoStart:false});await f.runtime.startService();
  let sends=0;
  f.adapter.send=async(_bot,_credential,_delivery,_asset,signal)=>{sends++;entered.resolve();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));throw Error('fixture service stopped');};
  f.enqueue('active');f.enqueue('later');const flushing=f.runtime.flushDeliveries();await entered.promise;
  await f.runtime.stopService();await flushing;assert.equal(sends,1);assert.equal(f.store.deliveries.deliveries(['pending']).length,1);assert.equal(f.store.bots.bot('one').enabled,true);
  await f.runtime.flushDeliveries();assert.equal(sends,1);
  f.adapter.send=async()=>{sends++;return'receipt';};await f.runtime.startService();await f.runtime.flushDeliveries();assert.equal(sends,2);assert.equal(f.store.deliveries.deliveries(['pending']).length,0);
});

test('a stop during credential preparation leaves the delivery pending instead of submitting it',async t=>{
  const f=await fixture(t),entered=gate(),release=gate();await f.runtime.initialize({autoStart:false});await f.runtime.startService();
  f.credentials.read=async id=>{entered.resolve();await release.promise;return{accountId:id};};f.enqueue('prepared');
  const flushing=f.runtime.flushDeliveries();await entered.promise;const stopping=f.runtime.stopService();await tick();assert.equal(f.runtime.serviceRunning(),false);release.resolve();await Promise.all([stopping,flushing]);
  assert.deepEqual(f.sent,[]);assert.equal(f.store.deliveries.deliveries(['pending']).length,1);
});

test('the panel bot.start action activates the service and connects only the selected bot',async t=>{
  const f=await fixture(t);await f.runtime.initialize({autoStart:false});await f.runtime.start('one');
  assert.equal(f.runtime.serviceRunning(),true);assert.deepEqual(f.connected,['one']);assert.equal(f.store.bots.bot('two').enabled,true);
  f.enqueue('panel');await f.runtime.flushDeliveries();assert.deepEqual(f.sent,['panel']);
});

test('the existing initialize default still reconnects enabled bots',async t=>{
  const f=await fixture(t);await f.runtime.initialize();await tick();
  assert.equal(f.runtime.serviceRunning(),true);assert.deepEqual(f.connected.sort(),['one','two']);
});

test('delivery retry and manual automation cannot bypass a stopped service',async t=>{
  const f=await fixture(t);await f.runtime.initialize({autoStart:false});f.enqueue('failed');const delivery=f.store.deliveries.deliveries()[0];f.store.deliveries.deliveryState(delivery,'failed',undefined,'fixture failure');
  await f.runtime.deliveryWorker.retry(delivery.id);assert.equal(f.store.deliveries.find(delivery.id)?.state,'failed');
  const job=f.runtime.automation.createJob(scope(),'fixture prompt',{runAt:Date.now()+60000});const result=await f.runtime.automation.runJob(job);
  assert.equal(result.state,'blocked');assert.equal(result.error,'AUTOMATION_BUSY');assert.deepEqual(f.runs,[]);assert.deepEqual(f.sent,[]);
});

test('a failed panel start leaves an initially stopped service inactive',async t=>{
  const f=await fixture(t);await f.runtime.initialize({autoStart:false});f.enqueue('preserved');
  await assert.rejects(f.runtime.start('missing'));
  assert.equal(f.runtime.serviceRunning(),false);await f.runtime.flushDeliveries();assert.deepEqual(f.sent,[]);assert.deepEqual(f.connected,[]);
});

test('close waits for a pending service start and disconnects connections created by it',async t=>{
  const f=await fixture(t),entered=gate(),release=gate();await f.runtime.initialize({autoStart:false});
  f.credentials.read=async id=>{entered.resolve();await release.promise;return{accountId:id};};
  const starting=f.runtime.startService();await entered.promise;const closing=f.runtime.close();
  assert.equal(f.runtime.serviceRunning(),false);release.resolve();await Promise.all([starting,closing]);
  assert.deepEqual(f.connected.sort(),['one','two']);assert.deepEqual(f.disconnected.sort(),['one','two']);assert.deepEqual(f.sent,[]);
});
