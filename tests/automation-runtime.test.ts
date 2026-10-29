import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store,scopeKey} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {botSchema,type CallerScope,type Delivery} from '../src/core/types.js';
import {fixtureChannels} from './test-channel.js';

const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
async function fixture(t:any){
  const directory=await mkdtemp(path.resolve('.codex/automation-runtime-')),store=new Store(directory),assets=new Assets(store);
  store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',configId:'sakura',enabled:true,trustedUsers:['owner']}));
  store.accept({id:'context',scope,text:'我们刚聊过天',attachments:[],timestamp:Date.now()-3600000,reply:{target:'owner',kind:'private',msgId:'old'},replyEnvelope:{channelId:'qq',version:1,payload:{target:'owner',kind:'private',msgId:'old'}}});store.mark(scopeKey(scope),['context'],'complete');
  const sent:Delivery[]=[];
  const harness:HarnessPort={run:async(_b,_m,_s,options)=>({turnId:'background',outputs:[{type:'text',text:'晚安'}],snapshot:options!.snapshot!}),cancel:()=>{},dispose:async()=>{},validateModel:async()=>{}};
  const adapter={beginLogin:async()=>({status:'pending' as const}),pollLogin:async()=>({status:'expired' as const}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async(_b:any,_c:any,delivery:Delivery)=>{sent.push(delivery);return'receipt';}};
  const runtime=new BotRuntime(store,assets,new MediaService(store,assets),harness,fixtureChannels(adapter),{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},60000);
  t.after(async()=>{await runtime.close();store.close();await rm(directory,{recursive:true,force:true});});
  return{runtime,store,harness,sent};
}

test('automatic runs use the existing conversation, frozen persona and active QQ delivery without changing inbox metrics',async t=>{
  const f=await fixture(t),binding=f.store.binding(scope);let called=false;
  f.harness.run=async(b,messages,signal,options)=>{
    called=true;assert.equal(b.sessionId,binding.sessionId);assert.equal(f.runtime.busy(b),true);assert.ok(messages[0].id.startsWith('automation:'));assert.equal(signal.aborted,false);
    assert.equal(options!.snapshot!.config.id,'sakura');assert.equal(options!.snapshot!.config.tools.includes('bot_read_social'),false);
    return{turnId:'background',outputs:[{type:'text',text:'晚安'}],snapshot:options!.snapshot!};
  };
  f.runtime.automation.configureProactive(scope,{enabled:false});
  const run=await f.runtime.automation.runProactive(scope,true);
  assert.equal(run.state,'succeeded');assert.equal(called,true);assert.equal(f.runtime.busy(binding),false);
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].reply.msgId,undefined);assert.equal(f.sent[0].replyEnvelope!.payload.msgId,undefined);
  assert.ok(f.sent[0].sourceId.startsWith('automation:'));assert.equal(f.store.allMessages().length,1);
});

test('an active chat blocks automation until idle without starting a second model turn',async t=>{
  const f=await fixture(t);let release!:()=>void,entered!:()=>void,calls=0;const started=new Promise<void>(r=>entered=r);
  f.harness.run=async(_b,_m,_s,options)=>{calls++;entered();await new Promise<void>(r=>release=r);return{turnId:'chat',outputs:[],snapshot:options!.snapshot!};};
  await f.runtime.receive({id:'foreground',scope,text:'正在聊天',attachments:[],reply:{target:'owner',kind:'private',msgId:'new'},timestamp:Date.now()});
  const work=f.runtime.process(scopeKey(scope));await started;
  const job=f.runtime.automation.createJob(scope,'提醒',{runAt:Date.now()+3600000});
  const blocked=await f.runtime.automation.runJob(job);assert.equal(blocked.error,'AUTOMATION_BUSY');assert.equal(calls,1);
  release();await work;assert.equal(f.runtime.busy(scopeKey(scope)),false);
});

test('stopping a running background task cancels it and suppresses its output',async t=>{
  const f=await fixture(t);let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
  f.harness.run=async(_b,_m,signal,options)=>{entered();await new Promise<void>(r=>signal.addEventListener('abort',()=>r(),{once:true}));return{turnId:'cancelled',outputs:[{type:'text',text:'不应发送'}],snapshot:options!.snapshot!};};
  const job=f.runtime.automation.createJob(scope,'提醒',{runAt:Date.now()+3600000});const work=f.runtime.automation.runJob(job);await started;
  assert.equal(f.runtime.health().activeTasks,1);await f.runtime.stopSession(scope);assert.equal((await work).state,'failed');assert.equal(f.sent.length,0);
});

test('revoking trust before a due run blocks generation and delivery',async t=>{
  const f=await fixture(t);let calls=0;f.harness.run=async()=>{calls++;throw Error('must not call');};
  const job=f.runtime.automation.createJob(scope,'提醒',{runAt:Date.now()+3600000});f.store.saveBot({...f.store.bot('bot'),trustedUsers:[]});
  assert.equal((await f.runtime.automation.runJob(job)).error,'TRUSTED_PRIVATE_REQUIRED');assert.equal(calls,0);assert.equal(f.sent.length,0);
});

test('manual proactive command queues behind its own command instead of rejecting a busy session',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-29T00:00:00Z')});
  const f=await fixture(t);f.runtime.automation.configureProactive(scope,{enabled:false});
  await f.runtime.receive({id:'now',scope,text:'/proactive now',attachments:[],reply:{target:'owner',kind:'private',msgId:'now'},timestamp:Date.now()});
  assert.match(f.sent[0].output.text!,/已排队/);
  t.mock.timers.tick(1);await f.runtime.automation.drain();
  assert.equal(f.sent[1].output.text,'晚安');assert.equal(f.store.list<any>('proactive-run')[0].state,'succeeded');
});
