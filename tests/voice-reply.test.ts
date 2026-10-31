import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store,scopeKey} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {botSchema,type CallerScope,type Delivery,type Output} from '../src/core/types.js';
import {spokenReplyText} from '../src/core/voice-reply.js';
import {fixtureChannels} from './test-channel.js';

const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};}

async function fixture(t:any){
  const directory=await mkdtemp(path.resolve('.codex/voice-reply-')),store=new Store(directory),assets=new Assets(store);
  const initial=store.config('sakura');store.saveConfig({...initial,media:{voice:{enabled:true,protocol:'edge_tts',replyMode:'auto',voice:'first',format:'mp3'}}},initial.revision);
  store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',configId:'sakura',enabled:true,trustedUsers:['owner']}));
  const binding=store.binding(scope);
  store.accept({id:'context',scope,text:'已有上下文',attachments:[],timestamp:Date.now()-3600000,reply:{target:'owner',kind:'private',msgId:'old'}});store.mark(binding.key,['context'],'complete');
  const audio=await assets.save(binding.key,{kind:'audio',name:'ai-voice.wav',mime:'audio/wav'},Buffer.from('audio fixture'));
  const sent:Delivery[]=[];const calls:Array<{config:any;parameters:any;signal:AbortSignal}>=[];
  const harness:HarnessPort={run:async(_b,_m,_s,options)=>({turnId:'reply',outputs:[{type:'text',text:'你好'}],snapshot:options!.snapshot!}),cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const adapter={beginLogin:async()=>({status:'pending' as const}),pollLogin:async()=>({status:'expired' as const}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async(_b:any,_c:any,delivery:Delivery)=>{sent.push(delivery);return'receipt';}};
  const media=new MediaService(store,assets);media.run=async(_scope,operation,config,inputs,parameters,signal,authorize)=>{
    assert.equal(operation,'voice_speak');assert.deepEqual(inputs,[]);authorize?.();calls.push({config,parameters,signal});return{assetIds:[audio.id]};
  };
  const runtime=new BotRuntime(store,assets,media,harness,fixtureChannels(adapter),{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},60000);
  const chat=async()=>{await runtime.receive({id:'incoming',scope,text:'请回答',attachments:[],reply:{target:'owner',kind:'private',msgId:'incoming'},timestamp:Date.now()});await runtime.process(scopeKey(scope));};
  t.after(async()=>{await runtime.close();store.close();await rm(directory,{recursive:true,force:true});});
  return{runtime,store,assets,media,harness,sent,calls,audio,binding,chat};
}

test('spoken replies retain prose and link labels while excluding code blocks and URL destinations',()=>{
  const outputs:Output[]=[{type:'text',text:'# 你好\n请看 [说明](https://example.invalid/docs)。\n```ts\nsecret();\n```\n~~~python\nprint(1)\n~~~\n    indented_code()\nhttps://example.invalid/path\n结尾 **文字**。'}];
  const text=spokenReplyText(outputs)!;
  assert.match(text,/你好/);assert.match(text,/请看 说明。/);assert.match(text,/结尾 文字。/);assert.doesNotMatch(text,/secret|print|indented|https|```|~~~/);
  assert.equal(spokenReplyText([{type:'text',text:'```\nnot closed'}]),undefined);
  assert.equal(spokenReplyText([{type:'text',text:'字'.repeat(11000)}]),undefined);
  assert.equal(spokenReplyText([{type:'asset',assetId:'asset'}]),undefined);
});

test('foreground auto voice synthesizes once before text chunking and delivery retries reuse the asset',async t=>{
  const f=await fixture(t);const answer='正文'.repeat(1000);
  f.harness.run=async(_b,_m,_s,options)=>({turnId:'reply',outputs:[{type:'text',text:answer},{type:'text',text:'[链接文字](https://example.invalid)'}],snapshot:options!.snapshot!});
  await f.chat();assert.equal(f.calls.length,1);assert.equal(f.calls[0].parameters.text,`${answer}\n\n链接文字`);
  assert.equal(f.calls[0].config.media.voice.voice,'first');assert.equal(f.calls[0].config.media.voice.format,'mp3');
  assert.equal(f.sent.filter(delivery=>delivery.output.type==='asset').length,1);assert.ok(f.sent.some(delivery=>delivery.output.text?.includes('AI 生成语音')));
  await f.runtime.flushDeliveries();assert.equal(f.calls.length,1);
});

for(const scenario of ['on_demand','explicit-success','explicit-failure','only-assets','code-only','too-long'] as const)test(`${scenario} does not start automatic synthesis`,async t=>{
  const f=await fixture(t);
  if(scenario==='on_demand'){const config=f.store.config('sakura');f.store.saveConfig({...config,media:{voice:{...config.media.voice!,replyMode:'on_demand'}}},config.revision);}
  f.harness.run=async(_b,_m,_s,options)=>({turnId:'reply',outputs:scenario==='only-assets'?[{type:'asset',assetId:f.audio.id}]:[{type:'text',text:scenario==='code-only'?'```ts\nconst x=1;\n```':scenario==='too-long'?'字'.repeat(11000):'回复'},...(scenario==='explicit-success'?[{type:'asset' as const,assetId:f.audio.id}]:[])],snapshot:options!.snapshot!,voiceAttempted:scenario.startsWith('explicit-')});
  await f.chat();assert.equal(f.calls.length,0);assert.ok(f.sent.length>0);
});

test('automatic synthesis failure preserves the completed answer with a short text notice',async t=>{
  const f=await fixture(t);f.media.run=async()=>{throw new Error('GPT_SOVITS_UNAVAILABLE');};
  await f.chat();assert.equal(f.sent.length,1);assert.match(f.sent[0].output.text!,/^你好/);assert.match(f.sent[0].output.text!,/语音生成失败/);assert.doesNotMatch(f.sent[0].output.text!,/模型请求失败|GPT_SOVITS/);
});

test('progress continues in the media stage after the model finishes and stops when audio is ready',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:Date.parse('2026-10-31T00:00:00Z')});
  const f=await fixture(t),started=deferred(),finish=deferred();const stages:string[]=[];
  f.harness.formatProgress=async(_binding,_snapshot,facts)=>{stages.push(facts.stage);return'语音还在生成中。';};
  f.media.run=async()=>{started.resolve();await finish.promise;return{assetIds:[f.audio.id]};};
  const work=f.chat();await started.promise;t.mock.timers.tick(60000);
  for(let i=0;i<8;i++)await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(stages,['media']);assert.equal(f.sent[0].purpose,'progress');
  finish.resolve();await work;t.mock.timers.tick(120000);
  for(let i=0;i<4;i++)await new Promise<void>(resolve=>setImmediate(resolve));
  assert.deepEqual(stages,['media']);assert.equal(f.sent.filter(delivery=>delivery.output.type==='asset').length,1);
});

test('voice settings remain frozen when the persona changes during the model turn',async t=>{
  const f=await fixture(t);
  f.harness.run=async(_b,_m,_s,options)=>{
    const config=f.store.config('sakura');await f.runtime.saveConfig({...config,media:{voice:{...config.media.voice!,voice:'second',replyMode:'on_demand'}}},config.revision);
    return{turnId:'reply',outputs:[{type:'text',text:'你好'}],snapshot:options!.snapshot!};
  };
  await f.chat();assert.equal(f.calls.length,1);assert.equal(f.calls[0].config.media.voice.voice,'first');assert.equal(f.calls[0].config.media.voice.replyMode,'auto');
});

for(const change of ['revoke-before','revoke-after','new-session','cancel'] as const)test(`${change} suppresses the completed answer and any late audio`,async t=>{
  const f=await fixture(t),started=deferred(),finish=deferred();
  const revoke=()=>{const config=f.store.config('sakura');f.store.saveConfig({...config,media:{voice:{...config.media.voice!,enabled:false}}},config.revision);};
  if(change==='revoke-before')f.harness.run=async(_b,_m,_s,options)=>{revoke();return{turnId:'reply',outputs:[{type:'text',text:'不应发送'}],snapshot:options!.snapshot!};};
  else f.media.run=async(_scope,_operation,_config,_inputs,_parameters,signal,authorize)=>{
    authorize?.();started.resolve();signal.addEventListener('abort',finish.resolve,{once:true});await finish.promise;return{assetIds:[f.audio.id]};
  };
  const work=f.chat();
  if(change!=='revoke-before'){
    await started.promise;
    if(change==='revoke-after')revoke();
    if(change==='new-session')f.store.reset(scope);
    if(change==='cancel')await f.runtime.stopSession(scope);
    finish.resolve();
  }
  await work;assert.equal(f.sent.length,0);assert.equal(f.store.messages(f.binding.key,['cancelled']).length,1);
});

for(const kind of ['scheduled','proactive'] as const)test(`${kind} final replies use the same automatic voice stage`,async t=>{
  const f=await fixture(t);
  if(kind==='proactive')f.runtime.automation.configureProactive(scope,{enabled:false});
  const result=kind==='scheduled'?await f.runtime.automation.runJob(f.runtime.automation.createJob(scope,'提醒',{runAt:Date.now()+3600000})):await f.runtime.automation.runProactive(scope,true);
  assert.equal(result.state,'succeeded');assert.equal(f.calls.length,1);assert.equal(f.sent.filter(delivery=>delivery.output.type==='asset').length,1);assert.ok(f.sent.some(delivery=>delivery.output.text?.startsWith('你好')));
});

test('background voice failure falls back to text but revoked permissions suppress the entire result',async t=>{
  const f=await fixture(t);f.media.run=async()=>{throw Error('VOICE_FAILED');};
  const first=f.runtime.automation.createJob(scope,'提醒',{runAt:Date.now()+3600000});assert.equal((await f.runtime.automation.runJob(first)).state,'succeeded');assert.match(f.sent[0].output.text!,/语音生成失败/);
  f.sent.length=0;f.media.run=async()=>{const config=f.store.config('sakura');f.store.saveConfig({...config,tools:config.tools.filter(tool=>tool!=='bot_voice')},config.revision);throw Error('VOICE_FAILED');};
  const second=f.runtime.automation.createJob(scope,'提醒2',{runAt:Date.now()+7200000});assert.equal((await f.runtime.automation.runJob(second)).state,'failed');assert.equal(f.sent.length,0);
});
