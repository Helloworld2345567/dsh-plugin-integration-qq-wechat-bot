import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {NativeHarness} from '../src/harness/bridge.js';
import {Store} from '../src/core/store.js';
import {Assets} from '../src/core/media.js';
import {botSchema,configSchema,type CallerScope,type Delivery} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';

async function fixture(t:TestContext){
  const home=await mkdtemp(path.resolve('.codex/delivery-tool-')),store=new Store(home,path.join(home,'personas'));
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  const config=configSchema.parse({schemaVersion:3,id:'voice-test',name:'Voice',personaPrompt:'Test',tools:['bot_media','bot_voice','bot_sing','bot_music','bot_send_file'],skills:['voice-generation','singing-conversion','music-download'],media:{voice:{enabled:true,protocol:'edge_tts'},music:{enabled:true},singing:{enabled:true,serviceUrl:'http://rvc.invalid',modelVersion:'v2',singingModelId:'test',singingWeightsPath:'test.pth'}}});store.put('config',config.id,config);store.put('config-version',`${config.id}:${config.revision}`,config);
  const bot=store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',configId:config.id,enabled:true}));
  const scope:CallerScope={botId:bot.id,platform:'qq',accountId:'fixture',kind:'private',channelId:'fixture',senderId:'fixture'};
  const binding=store.binding(scope),assets=new Assets(store);assets.workspace=async()=>path.join(home,'workspace');
  const audio=await assets.save(binding.key,{kind:'audio',name:'generated.mp3',mime:'audio/mpeg'},Buffer.from('fixture bytes'),'generated-job');
  const tools=new Map<string,any>(),agent={id:'test-agent'};let generated=0;
  const ctx:any={on:()=>{},agents:{list:()=>[agent]},tools:{guard:()=>{},register:(tool:any)=>{tools.set(tool.name,tool);return()=>tools.delete(tool.name);}}};
  const media:any={run:async()=>{generated++;return{text:'已生成 AI 语音。',assetIds:[audio.id],music:{track:{source:'MiguMusicClient',id:'test-song',title:'Test song',artist:'Test artist',format:'mp3'}}};}};
  const bridge=new NativeHarness(ctx,store,assets,media,{skills:{} as any});
  const live:any={binding,snapshot:freezeTurn(config,bot,scope,['request']),assets:[],voice:{attempted:false},singing:{attempted:false},images:{inFlight:false,completed:false},skills:{},cwd:path.join(home,'workspace')};
  (bridge as any).scoped.set(agent,live);(bridge as any).tools(ctx,live);
  const call=async(name:string,args:any)=>JSON.parse(await tools.get(name).execute(args,{agent,signal:new AbortController().signal}));
  const claim=(state:Delivery['state'])=>{store.enqueue(binding,'request','original-turn',[{type:'asset',assetId:audio.id}],{});const delivery=store.deliveries()[0];store.deliveryState(delivery,state,state==='sent'?'receipt':undefined);return delivery;};
  return{store,binding,audio,live,call,claim,generated:()=>generated};
}

test('voice success reports registration before any durable delivery and send_file reuses its generated asset',async t=>{
  const f=await fixture(t),voice=await f.call('bot_voice',{text:'The complete long reading'});
  assert.equal(voice.registeredForDelivery,true);assert.equal(voice.deliveryState,'registered');assert.equal(voice.platformSent,false);
  assert.equal(f.store.deliveries().length,0);assert.equal(f.live.assets.length,1);assert.equal(f.generated(),1);
  const file=await f.call('bot_send_file',{assetId:f.audio.id});assert.equal(file.queued,true);assert.equal(file.deliveryState,'registered');assert.equal(file.platformSent,false);
  assert.equal(f.live.assets.length,1);assert.equal(f.generated(),1);assert.equal(f.store.deliveries().length,0);
});

for(const state of ['pending','sending','unknown','failed','sent'] as const)test(`send_file reports ${state} without turning an existing claim into a new send`,async t=>{
  const f=await fixture(t),delivery=f.claim(state),result=await f.call('bot_send_file',{assetId:f.audio.id});
  assert.equal(result.deliveryId,delivery.id);assert.equal(result.deliveryState,state);assert.equal(result.state,state);
  assert.equal(result.platformSent,state==='sent');assert.equal(result.alreadySent,state==='sent');assert.equal(result.queued,false);
  assert.equal(result.needsResend,state==='unknown'||state==='failed');assert.equal(f.store.deliveries().length,1);assert.equal(f.live.assets.length,0);assert.equal(f.generated(),0);
});

test('send_file requires a nonempty receipt before treating a sent marker as platform confirmation',async t=>{
  const f=await fixture(t),delivery=f.claim('sent');
  for(const receipt of [undefined,'','   ']){
    f.store.deliveryState(delivery,'sent',receipt);
    const result=await f.call('bot_send_file',{assetId:f.audio.id});
    assert.equal(result.state,'sent');assert.equal(result.deliveryState,'sent');assert.equal(result.platformSent,false);assert.equal(result.alreadySent,false);assert.equal(result.queued,false);
  }
  assert.equal(f.store.deliveries().length,1);assert.equal(f.live.assets.length,0);assert.equal(f.generated(),0);
});

for(const state of ['unknown','failed'] as const)test(`explicit ${state} retry returns pending and preserves the audio without generating again`,async t=>{
  const f=await fixture(t),delivery=f.claim(state),result=await f.call('bot_send_file',{assetId:f.audio.id,resend:true});
  assert.equal(result.queued,true);assert.equal(result.reused,true);assert.equal(result.resend,true);assert.equal(result.deliveryState,'pending');assert.equal(result.platformSent,false);
  assert.equal(result.deliveryId,delivery.id);assert.equal(f.store.deliveries().length,1);assert.equal(f.store.deliveries()[0].output.assetId,f.audio.id);assert.equal(f.store.deliveries()[0].state,'pending');assert.equal(f.generated(),0);
});

test('resending a previously sent asset registers a new intent without reusing its old success claim',async t=>{
  const f=await fixture(t),delivery=f.claim('sent'),result=await f.call('bot_send_file',{assetId:f.audio.id,resend:true});
  assert.equal(result.newIntent,true);assert.equal(result.previousDeliveryId,delivery.id);assert.equal(result.deliveryState,'registered');assert.equal(result.platformSent,false);
  assert.deepEqual(f.live.assets,[{type:'asset',assetId:f.audio.id,resend:true}]);assert.equal(f.store.deliveries().length,1);assert.equal(f.generated(),0);
});

test('registered music and RVC tool results retain their behavior without claiming platform delivery',async t=>{
  const f=await fixture(t),music=await f.call('bot_music',{action:'download',song:'Test song',artist:'Test artist'});
  assert.equal(music.status,'succeeded');assert.equal(music.registeredForDelivery,true);assert.equal(music.deliveryState,'registered');assert.equal(music.platformSent,false);
  const prepared=await f.call('bot_sing',{action:'prepare',inputs:[f.audio.id]});assert.equal(prepared.deliveryState,undefined);
  const singing=await f.call('bot_sing',{action:'convert',candidateSet:prepared.candidateSet,candidate:1,sourceType:'vocals'});
  assert.equal(singing.status,'succeeded');assert.equal(singing.deliveryState,'registered');assert.equal(singing.platformSent,false);assert.equal(f.store.deliveries().length,0);
});
