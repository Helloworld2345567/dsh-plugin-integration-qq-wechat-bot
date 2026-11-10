import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {ProfileStore} from '../src/core/profile-store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {botSchema,configSchema,type CallerScope,type InboundMessage,type ChannelAdapter} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';
import {managementCommand} from '../src/core/command-bus.js';

const scope=(senderId='alice',kind:'private'|'group'='private'):CallerScope=>({botId:'one',platform:'qq',accountId:'one',kind,channelId:kind==='group'?'room':senderId,senderId});
let sequence=0;
const message=(text:string,current=scope()):InboundMessage=>({id:`voice-${++sequence}`,scope:current,text,attachments:[],reply:{target:current.channelId},timestamp:Date.now()});

async function fixture(t:any){
  const home=await mkdtemp(path.resolve('.codex/voice-command-')),store=new SqlitePersistence(home),profiles=new ProfileStore(store.profiles);
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true,trustedUsers:['alice']}));
  const previous=store.personas.config('default');
  const config=configSchema.parse({...previous,name:'Default',personaPrompt:'P',tools:['bot_voice','bot_sing'],skills:['voice-generation','singing-conversion'],media:{voice:{enabled:true,protocol:'edge_tts',voice:'zh-CN-XiaoxiaoNeural',replyMode:'on_demand',format:'mp3'},singing:{enabled:true,defaultOutput:'mp3'}}});
  store.personas.saveConfig(config,previous.revision);
  profiles.create({serviceId:'gpt-sovits',profileId:'first',state:'ready',capabilities:['gpt-sovits.speak'],displayName:'First voice',managedConfig:{baseUrl:'http://127.0.0.1:9880',modelVersion:'v4'}});
  profiles.create({serviceId:'rvc',profileId:'first',state:'ready',capabilities:['rvc.convert'],displayName:'Singer',managedConfig:{weights:'private.pth'}});
  const assets=new Assets(store.repositories()),media=new MediaService(store.repositories(),assets),sent:string[]=[];
  const harness:HarnessPort={run:async(binding,messages)=>({turnId:'turn',outputs:[],snapshot:freezeTurn(store.personas.effectiveConfig(binding),store.bots.bot('one'),binding.scope,messages.map(item=>item.id))}),cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.from('media'),send:async(_bot,_credential,delivery)=>{sent.push(delivery.output.text??'asset');return'receipt';}};
  const runtime=new BotRuntime(store.repositories(),assets,media,harness,createChannelRegistry([{id:'qq',displayName:'QQ',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}}]),{read:async()=>({accountId:'one'}),write:async()=>{},remove:async()=>{}},0,0,profiles);
  t.after(async()=>{await runtime.close();store.close();await rm(home,{recursive:true,force:true});});
  return{store,profiles,runtime,sent};
}

test('voice commands parse role and exact IDs',()=>{
  assert.deepEqual(managementCommand({name:'tts',args:'set gpt-sovits/first'}),{kind:'voice',role:'tts',action:'set',ref:'gpt-sovits/first'});
  assert.deepEqual(managementCommand({name:'sts',args:'list'}),{kind:'voice',role:'sts',action:'list'});
  assert.deepEqual(managementCommand({name:'tts',args:'reset'}),{kind:'voice',role:'tts',action:'reset'});
});

test('voice profile and Edge overrides affect only the current session and reset',async t=>{
  const f=await fixture(t),binding=()=>f.store.sessions.binding(scope());
  await f.runtime.receive(message('/tts set gpt-sovits/first'));
  assert.deepEqual(binding().ttsOverride,{kind:'profile',profileRef:{serviceId:'gpt-sovits',profileId:'first'}});
  assert.equal(f.runtime.effectiveConfig(binding()).media.voice?.engine,'gpt-sovits');
  await f.runtime.receive(message('/sts set rvc/first'));
  assert.deepEqual(binding().stsOverride,{profileRef:{serviceId:'rvc',profileId:'first'}});
  assert.equal(f.runtime.effectiveConfig(binding()).media.singing?.profileRef?.profileId,'first');
  await f.runtime.receive(message('/tts reset'));
  assert.equal(binding().ttsOverride,undefined);
  assert.equal(f.runtime.effectiveConfig(binding()).media.voice?.protocol,'edge_tts');
  assert.ok(f.sent.some(text=>text.includes('下一轮生效')));
});

test('voice commands enforce trusted private callers and enabled roles',async t=>{
  const f=await fixture(t);
  await f.runtime.receive(message('/tts set edge/en-US-AriaNeural',scope('alice','group')));
  assert.equal(f.store.sessions.binding(scope('alice','group')).ttsOverride,undefined);
  const config=f.store.personas.config('default');f.store.personas.saveConfig({...config,media:{...config.media,voice:{...config.media.voice!,enabled:false}}},config.revision);
  await f.runtime.receive(message('/tts set edge/en-US-AriaNeural'));
  assert.equal(f.store.sessions.binding(scope()).ttsOverride,undefined);
  assert.ok(f.sent.some(text=>text.includes('可信私聊')||text.includes('未启用 TTS')));
});

test('voice lists hide profiles whose latest revision is no longer usable',async t=>{
  const f=await fixture(t);
  const tts=f.profiles.create({serviceId:'gpt-sovits',profileId:'stale',state:'ready',capabilities:['gpt-sovits.speak'],displayName:'Stale voice',managedConfig:{baseUrl:'http://127.0.0.1:9880',modelVersion:'v4'}});
  f.profiles.transition({serviceId:'gpt-sovits',profileId:tts.profileId},'missing');
  const sts=f.profiles.create({serviceId:'rvc',profileId:'stale',state:'ready',capabilities:['rvc.convert'],displayName:'Stale singer',managedConfig:{weights:'private.pth'}});
  f.profiles.transition({serviceId:'rvc',profileId:sts.profileId},'blocked');
  await f.runtime.receive(message('/tts list'));
  await f.runtime.receive(message('/sts list'));
  assert.equal(f.sent.some(text=>text.includes('gpt-sovits/stale')),false);
  assert.equal(f.sent.some(text=>text.includes('rvc/stale')),false);
  assert.ok(f.sent.some(text=>text.includes('gpt-sovits/first')));
  assert.ok(f.sent.some(text=>text.includes('rvc/first')));
});
