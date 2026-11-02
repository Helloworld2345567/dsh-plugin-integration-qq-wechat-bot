import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store,scopeKey} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {botSchema,configSchema,type CallerScope,type ChannelAdapter,type ChannelOutboundContext,type Delivery,type Output} from '../src/core/types.js';
import {fixtureChannels} from './test-channel.js';

const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};}

async function fixture(t:TestContext){
  await mkdir(path.resolve('.codex'),{recursive:true});const directory=await mkdtemp(path.resolve('.codex/qq-outbound-runtime-')),store=new Store(directory),assets=new Assets(store);
  const initial=store.config('sakura'),config=configSchema.parse({...initial,schemaVersion:3,media:{voice:{enabled:true,protocol:'edge_tts',replyMode:'auto',format:'mp3'}}});
  store.put('config',config.id,config);store.put('config-version',`${config.id}:${config.revision}`,config);
  store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',configId:config.id,enabled:true,trustedUsers:['owner']}));
  const binding=store.binding(scope);store.accept({id:'context',scope,text:'已有上下文',attachments:[],timestamp:Date.now()-3600000,reply:{target:'owner',kind:'private',msgId:'old'}});store.mark(binding.key,['context'],'complete');
  const audio=await assets.save(binding.key,{kind:'audio',name:'song.mp3',mime:'audio/mpeg'},Buffer.from('song'));
  const parts=await Promise.all([1,2].map(index=>assets.save(binding.key,{kind:'audio',name:`part-${index}.silk`,mime:'audio/silk'},Buffer.from(`part-${index}`))));
  const image=await assets.save(binding.key,{kind:'image',name:'image.png',mime:'image/png'},Buffer.from('image'));
  const original:Output[]=[{type:'text',text:'唱好了。'},{type:'asset',assetId:audio.id}];
  const sent:Delivery[]=[],voiceCalls:AbortSignal[]=[],contexts:ChannelOutboundContext[]=[];
  const harness:HarnessPort={run:async(_binding,_messages,_signal,options)=>({turnId:'reply',outputs:original,snapshot:options!.snapshot!,singingAttempted:true}),cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async(_bot,_credential,delivery)=>{sent.push(delivery);return'receipt';}};
  const media=new MediaService(store,assets);media.run=async(_scope,operation,_config,_inputs,_parameters,signal,authorize)=>{assert.equal(operation,'voice_speak');authorize?.();voiceCalls.push(signal);return{assetIds:[audio.id]};};
  const runtime=new BotRuntime(store,assets,media,harness,fixtureChannels(adapter),{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},60000);
  const chat=async()=>{await runtime.receive({id:'incoming',scope,text:'唱歌',attachments:[],reply:{target:'owner',kind:'private',msgId:'incoming'},timestamp:Date.now()});await runtime.process(scopeKey(scope));};
  const install=(prepare:(context:ChannelOutboundContext)=>Promise<Output[]>)=>{adapter.prepareOutbound=async context=>{contexts.push(context);return prepare(context);};};
  const split=(context:ChannelOutboundContext):Output[]=>[...context.outputs.filter(output=>output.type==='text'),...parts.map(part=>({type:'asset' as const,assetId:part.id})),{type:'asset',assetId:audio.id,asFile:true}];
  t.after(async()=>{await runtime.close();store.close();await rm(directory,{recursive:true,force:true});});
  return{runtime,store,assets,media,harness,adapter,audio,parts,image,binding,original,sent,voiceCalls,contexts,chat,install,split};
}

test('explicit song outputs become independent voice parts and a complete file before enqueue',async t=>{
  const f=await fixture(t);f.install(async context=>{assert.equal(context.binding.sessionId,f.binding.sessionId);context.authorize();return f.split(context);});
  await f.chat();assert.equal(f.contexts.length,1);assert.equal(f.voiceCalls.length,0);assert.deepEqual(f.contexts[0].outputs,f.original);
  const deliveries=f.sent.filter(delivery=>delivery.output.type==='asset');assert.deepEqual(deliveries.map(delivery=>delivery.output.assetId),[...f.parts.map(part=>part.id),f.audio.id]);
  assert.deepEqual(deliveries.map(delivery=>delivery.index),[1,2,3]);assert.equal(new Set(deliveries.map(delivery=>delivery.id)).size,3);assert.equal(deliveries.at(-1)!.output.asFile,true);
  assert.equal(f.original[1].asFile,undefined);await f.runtime.flushDeliveries();assert.equal(f.contexts.length,1);
});

test('automatic TTS completes before the outbound hook receives its audio and signal',async t=>{
  const f=await fixture(t);f.harness.run=async(_binding,_messages,_signal,options)=>({turnId:'reply',outputs:[{type:'text',text:'你好。'}],snapshot:options!.snapshot!});
  f.install(async context=>{assert.equal(f.voiceCalls.length,1);assert.equal(context.signal,f.voiceCalls[0]);context.authorize();assert.ok(context.outputs.some(output=>output.assetId===f.audio.id));return f.split(context);});
  await f.chat();assert.equal(f.contexts.length,1);assert.equal(f.sent.filter(delivery=>delivery.output.type==='asset').length,3);assert.ok(f.sent.some(delivery=>delivery.output.text?.includes('AI 生成语音')));
});

test('channels without an outbound hook keep explicit outputs unchanged',async t=>{
  const f=await fixture(t);await f.chat();assert.equal(f.voiceCalls.length,0);assert.deepEqual(f.sent.map(delivery=>delivery.output),f.original);
});

test('preparation failure preserves original audio as a file and leaves other attachments intact',async t=>{
  const f=await fixture(t);f.original.push({type:'asset',assetId:f.image.id});
  f.install(async context=>{context.outputs[0].text='partial mutation';context.outputs.splice(1,1);context.outputs.push({type:'asset',assetId:f.parts[0].id});throw Error('private transcoder details');});
  await f.chat();assert.deepEqual(f.sent.filter(delivery=>delivery.output.type==='asset').map(delivery=>delivery.output),[{type:'asset',assetId:f.audio.id,asFile:true},{type:'asset',assetId:f.image.id}]);
  assert.match(f.sent[0].output.text!,/^唱好了。/);assert.match(f.sent[0].output.text!,/本次语音发送准备失败，已保留音频文件。/);assert.doesNotMatch(f.sent[0].output.text!,/partial mutation|private transcoder/);assert.equal(f.original[1].asFile,undefined);
});

for(const change of ['revoke','new-session','cancel','revoke-and-fail'] as const)test(`${change} during preparation suppresses late results and file fallback`,async t=>{
  const f=await fixture(t),started=deferred(),finish=deferred();let context!:ChannelOutboundContext;
  f.install(async value=>{context=value;value.authorize();value.signal.addEventListener('abort',finish.resolve,{once:true});started.resolve();await finish.promise;if(change==='revoke-and-fail')throw Error('PREPARE_FAILED');return f.split(value);});
  const work=f.chat();await started.promise;
  if(change.startsWith('revoke')){const config=f.store.config('sakura');f.store.saveConfig({...config,tools:config.tools.filter(tool=>tool!=='bot_voice')},config.revision);assert.throws(context.authorize,/REPLY_CONTEXT_CHANGED/);}
  if(change==='new-session'){f.store.reset(scope);assert.throws(context.authorize,/REPLY_CONTEXT_CHANGED/);}
  if(change==='cancel'){await f.runtime.stopSession(scope);assert.equal(context.signal.aborted,true);}
  finish.resolve();await work;assert.equal(f.sent.length,0);
});

for(const kind of ['scheduled','proactive'] as const)test(`${kind} replies pass through the same outbound preparation hook`,async t=>{
  const f=await fixture(t);f.harness.run=async(_binding,_messages,_signal,options)=>({turnId:'reply',outputs:[{type:'text',text:'提醒。'}],snapshot:options!.snapshot!});f.install(async context=>{context.authorize();return f.split(context);});
  if(kind==='proactive')f.runtime.automation.configureProactive(scope,{enabled:false});
  const result=kind==='scheduled'?await f.runtime.automation.runJob(f.runtime.automation.createJob(scope,'提醒',{runAt:Date.now()+3600000})):await f.runtime.automation.runProactive(scope,true);
  assert.equal(result.state,'succeeded');assert.equal(f.voiceCalls.length,1);assert.equal(f.contexts.length,1);assert.equal(f.sent.filter(delivery=>delivery.output.type==='asset').length,3);
});
