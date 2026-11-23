import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../../../src/infrastructure/sqlite/persistence.js';
import {scopeKey} from '../../../src/core/identity.js';
import {Assets,MediaService} from '../../../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../../../src/core/runtime.js';
import {BotFeatures} from '../../../src/core/features.js';
import {freezeTurn} from '../../../src/core/policy.js';
import {NativeHarness,type LiveSession} from '../../../src/harness/bridge.js';
import {botSchema,configSchema,botSettingsFromConfig,type CallerScope,type Delivery,type Output,type TurnSnapshot} from '../../../src/core/types.js';
import {spokenReplyText} from '../../../src/core/voice-reply.js';
import {ProfileStore} from '../../../src/core/profile-store.js';
import {fixtureChannels} from '../../fixtures/test-channel.js';
import {seedAppliedConfig} from '../../fixtures/sqlite-fixtures.js';

const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return{promise,resolve};}

async function fixture(t:any){
  const directory=await mkdtemp(path.resolve('.codex/voice-reply-')),store=new SqlitePersistence(directory),assets=new Assets(store.repositories()),profiles=new ProfileStore(store.profiles);
  const initial=store.personas.config('sakura'),currentConfig=configSchema.parse({...initial,schemaVersion:4,media:{voice:{enabled:true,protocol:'edge_tts',replyMode:'auto',voice:'first',format:'mp3'}}});seedAppliedConfig(store,currentConfig);
  store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',configId:'sakura',enabled:true,trustedUsers:['owner']}));
  const binding=store.sessions.binding(scope);
  store.inbox.accept({id:'context',scope,text:'已有上下文',attachments:[],timestamp:Date.now()-3600000,reply:{target:'owner',kind:'private',msgId:'old'}});store.inbox.mark(binding.key,['context'],'complete');
  const audio=await assets.save(binding.key,{kind:'audio',name:'ai-voice.wav',mime:'audio/wav'},Buffer.from('audio fixture'));
  const sent:Delivery[]=[];const calls:Array<{config:any;parameters:any;signal:AbortSignal;snapshot?:TurnSnapshot}>=[];
  const harness:HarnessPort={run:async(_b,_m,_s,options)=>({turnId:'reply',outputs:[{type:'text',text:'你好'}],snapshot:options!.snapshot!}),cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const adapter={beginLogin:async()=>({status:'pending' as const}),pollLogin:async()=>({status:'expired' as const}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async(_b:any,_c:any,delivery:Delivery)=>{sent.push(delivery);return'receipt';}};
  const media=new MediaService(store.repositories(),assets);media.run=async(_scope,operation,config,inputs,parameters,signal,authorize,snapshot)=>{
    assert.equal(operation,'voice_speak');assert.deepEqual(inputs,[]);authorize?.();calls.push({config,parameters,signal,snapshot});return{assetIds:[audio.id]};
  };
  const runtime=new BotRuntime(store.repositories(),assets,media,harness,fixtureChannels(adapter),{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},60000,0,profiles);
  const chat=async()=>{await runtime.receive({id:'incoming',scope,text:'请回答',attachments:[],reply:{target:'owner',kind:'private',msgId:'incoming'},timestamp:Date.now()});await runtime.process(scopeKey(scope));};
  t.after(async()=>{await runtime.close();store.close();await rm(directory,{recursive:true,force:true});});
  return{runtime,store,assets,media,harness,profiles,sent,calls,audio,binding,chat};
}

/** Drive the registered channel tools with a scripted model and the same live session as the runtime. */
function voiceTurn(f:Awaited<ReturnType<typeof fixture>>,snapshot:TurnSnapshot,signal:AbortSignal){
  const agent={id:f.binding.sessionId},tools=new Map<string,any>();
  const ctx:any={on:()=>{},effect:()=>{},agents:{list:()=>[agent]},tools:{guard:()=>{},register:(tool:any)=>{tools.set(tool.name,tool);return()=>tools.delete(tool.name);}}};
  const features=new BotFeatures(f.runtime);
  const bridge=new NativeHarness(ctx,f.store.repositories(),f.assets,f.media,{voice:features.voice.bind(features)});
  const live:LiveSession={agent:agent as LiveSession['agent'],binding:f.binding,snapshot,sources:snapshot.sourceIds,skills:{},assets:[],images:new Map(),
    voice:{attempted:false},singing:{attempted:false},cwd:'',selection:{current:undefined,assembled:undefined},loadedTools:new Set(),toolSections:[]};
  bridge.live.set(f.binding.sessionId,live);
  bridge['tools'](ctx,live);
  f.harness.applyTurnSelection=bridge.applyTurnSelection.bind(bridge);
  const call=async(name:string,args:Record<string,unknown>,caller=agent)=>JSON.parse(await tools.get(name).execute(args,{agent:caller,signal}));
  const child=()=>{
    const subtask={id:'voice-subtask'} as LiveSession['agent'];
    bridge['scoped'].set(subtask,{...live,agent:subtask});
    return subtask;
  };
  return{live,call,child};
}

test('a voice control in the foreground turn selects the profile used by final automatic speech',async t=>{
  const f=await fixture(t);
  const selected=f.profiles.create({serviceId:'gpt-sovits',profileId:'speaker',state:'ready',capabilities:['gpt-sovits.speak'],displayName:'Speaker',managedConfig:{}});
  f.harness.run=async(_binding,_messages,signal,options)=>{
    const {live,call}=voiceTurn(f,options!.snapshot!,signal);
    await call('bot_voice_control',{role:'tts',action:'set',id:'gpt-sovits/speaker'});
    return{turnId:'reply',outputs:[{type:'text',text:'换好音色了'}],snapshot:live.snapshot};
  };
  await f.chat();
  assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0].config.media.voice.profileRef,{serviceId:'gpt-sovits',profileId:'speaker'});
  assert.equal(f.calls[0].snapshot?.services.voice?.snapshot?.profileContentHash,selected.contentHash);
  assert.equal(f.calls[0].parameters.text,'换好音色了');
  assert.equal(f.sent.filter(delivery=>delivery.output.type==='asset').length,1);
  const another=f.store.sessions.binding({...scope,senderId:'other',channelId:'other'});
  assert.equal(f.runtime.effectiveConfig(another).media.voice?.voice,'first');
});

test('explicit speech and singing use their newly selected profiles while an earlier speech job keeps its revision',async t=>{
  const f=await fixture(t),bot=f.store.bots.bot('bot'),settings=bot.settings!;
  f.runtime.saveBot({...bot,settings:{...settings,tools:[...settings.tools,'bot_sing'],skills:[...settings.skills,'singing-conversion'],media:{...settings.media,singing:{enabled:true,defaultOutput:'mp3'}}}});
  const voice=f.profiles.create({serviceId:'gpt-sovits',profileId:'speaker',state:'ready',capabilities:['gpt-sovits.speak'],displayName:'Speaker',managedConfig:{version:1}});
  const singer=f.profiles.create({serviceId:'rvc',profileId:'singer',state:'ready',capabilities:['rvc.convert'],displayName:'Singer',managedConfig:{}});
  const first=freezeTurn(f.runtime.effectiveConfig(f.binding),bot,scope,['request'],f.profiles);
  const {call,live,child}=voiceTurn(f,first,new AbortController().signal);
  const entered=deferred(),finish=deferred();
  const calls:Array<{operation:string;id?:string;revision?:number;voice?:string;inputs:string[]}>=[];
  f.media.run=async(_key,operation,config,inputs,parameters,_signal,authorize,snapshot)=>{
    if(parameters.text==='before'){entered.resolve();await finish.promise;}
    authorize?.();
    const role=operation==='singing_convert'?'singing':'voice',profile=snapshot?.services[role]?.snapshot;
    calls.push({operation,id:config.media[role]?.profileRef?.profileId,revision:profile?.profileRevision,voice:config.media.voice?.voice,inputs});
    return{assetIds:[f.audio.id]};
  };
  await call('bot_voice_control',{role:'tts',action:'set',id:'gpt-sovits/speaker'});
  const pending=call('bot_voice',{text:'before',deliver:false},child());
  try{
    await Promise.race([entered.promise,pending]);
    f.profiles.create({...voice,managedConfig:{version:2}});
    await call('bot_voice_control',{role:'tts',action:'set',id:'edge/en-US-AriaNeural'});
    await assert.rejects(call('bot_voice_control',{role:'tts',action:'set',id:'gpt-sovits/missing'}));
    await call('bot_voice',{text:'after',deliver:false});
  }finally{finish.resolve();await pending;}
  assert.deepEqual(calls.map(c=>[c.operation,c.id,c.revision,c.voice]),[
    ['voice_speak',undefined,undefined,'en-US-AriaNeural'],['voice_speak','speaker',voice.revision,undefined],
  ]);
  await call('bot_voice_control',{role:'sts',action:'set',id:'rvc/singer'});
  const prepared=await call('bot_sing',{action:'prepare',inputs:[f.audio.id]});
  const result=await call('bot_sing',{action:'convert',candidateSet:prepared.candidateSet,candidate:1,sourceType:'vocals'});
  assert.equal(result.status,'succeeded');
  assert.deepEqual(calls[2],{operation:'singing_convert',id:'singer',revision:singer.revision,voice:'en-US-AriaNeural',inputs:[f.audio.id]});
  assert.equal(live.assets.length,1);
  const reset=await call('bot_voice_control',{role:'sts',action:'reset'});
  assert.equal(reset.current,undefined);
  assert.equal(live.snapshot.services.singing?.state,'missing');
  await assert.rejects(call('bot_sing',{action:'prepare',inputs:[f.audio.id]}),/SINGING_DISABLED/);
});

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

for(const scenario of ['on_demand','explicit-success','explicit-failure','singing-attempt','only-assets','code-only','too-long'] as const)test(`${scenario} does not start automatic synthesis`,async t=>{
  const f=await fixture(t);
  if(scenario==='on_demand'){const bot=f.store.bots.bot('bot'),settings=bot.settings!;f.runtime.saveBot({...bot,settings:{...settings,media:{voice:{...settings.media.voice!,replyMode:'on_demand'}}}});}
  f.harness.run=async(_b,_m,_s,options)=>({turnId:'reply',outputs:scenario==='only-assets'?[{type:'asset',assetId:f.audio.id}]:[{type:'text',text:scenario==='code-only'?'```ts\nconst x=1;\n```':scenario==='too-long'?'字'.repeat(11000):'回复'},...(scenario==='explicit-success'?[{type:'asset' as const,assetId:f.audio.id}]:[])],snapshot:options!.snapshot!,voiceAttempted:scenario.startsWith('explicit-'),singingAttempted:scenario==='singing-attempt'});
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

test('voice settings remain frozen when bot settings change during the model turn',async t=>{
  const f=await fixture(t);
  f.harness.run=async(_b,_m,_s,options)=>{
    const bot=f.store.bots.bot('bot'),settings=bot.settings!;f.runtime.saveBot({...bot,settings:{...settings,media:{voice:{...settings.media.voice!,voice:'second',replyMode:'on_demand'}}}});
    return{turnId:'reply',outputs:[{type:'text',text:'你好'}],snapshot:options!.snapshot!};
  };
  await f.chat();assert.equal(f.calls.length,1);assert.equal(f.calls[0].config.media.voice.voice,'first');assert.equal(f.calls[0].config.media.voice.replyMode,'auto');
});

test('retiring a voice Profile after generation keeps the text reply deliverable',async t=>{
  const f=await fixture(t);
  const profile=f.profiles.create({serviceId:'gpt-sovits',profileId:'retiring',state:'ready',capabilities:['gpt-sovits.speak'],displayName:'Retiring voice',managedConfig:{baseUrl:'http://127.0.0.1:9880',modelVersion:'v4'}});
  const current=f.store.personas.config('sakura');
  const configured=configSchema.parse({...current,media:{voice:{enabled:true,engine:'gpt-sovits',profileRef:{serviceId:'gpt-sovits',profileId:profile.profileId},replyMode:'auto',format:'wav'}}});
  f.runtime.saveBot({...f.store.bots.bot('bot'),settings:botSettingsFromConfig(configured)});
  f.harness.run=async(_b,_m,_s,options)=>{
    f.profiles.transition({serviceId:'gpt-sovits',profileId:profile.profileId},'missing');
    return{turnId:'reply',outputs:[{type:'text',text:'Profile 失效后仍应发送这段文字。'}],snapshot:options!.snapshot!};
  };
  await f.chat();
  assert.ok(f.sent.some(delivery=>delivery.output.type==='text'&&delivery.output.text?.includes('Profile 失效后仍应发送')));
  assert.equal(f.store.inbox.source(f.binding.key,'incoming')?.id,'incoming');
  assert.equal(f.store.inbox.messages(f.binding.key,['complete']).filter(message=>message.id==='incoming').length,1);
});

for(const change of ['revoke-before','revoke-after','new-session','cancel'] as const)test(`${change} suppresses the completed answer and any late audio`,async t=>{
  const f=await fixture(t),started=deferred(),finish=deferred();
  const revoke=()=>{const bot=f.store.bots.bot('bot'),settings=bot.settings!;f.runtime.saveBot({...bot,settings:{...settings,media:{voice:{...settings.media.voice!,enabled:false}}}});};
  if(change==='revoke-before')f.harness.run=async(_b,_m,_s,options)=>{revoke();return{turnId:'reply',outputs:[{type:'text',text:'不应发送'}],snapshot:options!.snapshot!};};
  else f.media.run=async(_scope,_operation,_config,_inputs,_parameters,signal,authorize)=>{
    authorize?.();started.resolve();signal.addEventListener('abort',finish.resolve,{once:true});await finish.promise;return{assetIds:[f.audio.id]};
  };
  const work=f.chat();
  if(change!=='revoke-before'){
    await started.promise;
    if(change==='revoke-after')revoke();
    if(change==='new-session')f.store.sessions.reset(scope);
    if(change==='cancel')await f.runtime.stopSession(scope);
    finish.resolve();
  }
  await work;assert.equal(f.sent.length,0);assert.equal(f.store.inbox.messages(f.binding.key,['cancelled']).length,1);
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
  f.sent.length=0;f.media.run=async()=>{const bot=f.store.bots.bot('bot'),settings=bot.settings!;f.runtime.saveBot({...bot,settings:{...settings,tools:settings.tools.filter(tool=>tool!=='bot_voice')}});throw Error('VOICE_FAILED');};
  const second=f.runtime.automation.createJob(scope,'提醒2',{runAt:Date.now()+7200000});assert.equal((await f.runtime.automation.runJob(second)).state,'failed');assert.equal(f.sent.length,0);
});
