import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {botSchema,v4ConfigSchema,type CallerScope} from '../src/core/types.js';
import {ProfileStore} from '../src/core/profile-store.js';
import {allowedNow,freezeTurn,permissionsRevoked} from '../src/core/policy.js';
import {DurableDeliveryWorker} from '../src/core/delivery-worker.js';
import {Assets,MediaService} from '../src/core/media.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {seedAppliedConfig} from './sqlite-fixtures.js';

const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};

async function fixture(t:any){const home=await mkdtemp(path.resolve('.codex/profile-turn-')),store=new SqlitePersistence(home),profiles=new ProfileStore(store.profiles);t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});return{store,profiles};}

function serviceConfig(revision=1){return v4ConfigSchema.parse({schemaVersion:4,id:'services',name:'Services',revision,personaPrompt:'A',tools:['bot_voice','bot_sing','bot_music'],skills:['voice-generation','singing-conversion','music-download'],media:{voice:{enabled:true,profileRef:{serviceId:'voice',profileId:'default'},replyMode:'auto',format:'wav'},singing:{enabled:true,profileRef:{serviceId:'rvc',profileId:'default'}},music:{enabled:true,profileRef:{serviceId:'music',profileId:'default'},includeLyrics:false}}});}
function addProfiles(profiles:ProfileStore){return{
  voice:profiles.create({serviceId:'voice',profileId:'default',state:'ready',capabilities:['voice.speak'],displayName:'Voice',managedConfig:{endpoint:'private'}}),
  rvc:profiles.create({serviceId:'rvc',profileId:'default',state:'ready',capabilities:['rvc.convert'],displayName:'RVC',managedConfig:{weights:'private'}}),
  music:profiles.create({serviceId:'music',profileId:'default',state:'ready',capabilities:['music.search'],displayName:'Music',managedConfig:{root:'private'}}),
};}

test('strict v4 rejects endpoint, port, model path, weight path, credentials and locator fields',()=>{
  const base=serviceConfig();const candidates=[
    {...base,media:{...base.media,music:{...base.media.music!,endpoint:'http://127.0.0.1'}}},
    {...base,media:{...base.media,music:{...base.media.music!,port:9880}}},
    {...base,media:{...base.media,singing:{...base.media.singing!,modelPath:'models/private.pth'}}},
    {...base,media:{...base.media,singing:{...base.media.singing!,weightPath:'models/private.pth'}}},
    {...base,media:{...base.media,voice:{...base.media.voice!,credentials:{token:'secret'}}}},
    {...base,media:{...base.media,music:{...base.media.music!,locator:'private'}}},
  ];
  for(const value of candidates)assert.throws(()=>v4ConfigSchema.parse(value));
});

test('turn snapshots freeze persona and profile revisions; ready updates affect only the next turn',async t=>{
  const {store,profiles}=await fixture(t),first=addProfiles(profiles),config=serviceConfig();seedAppliedConfig(store,config,false);const bot=store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true,configId:config.id,trustedUsers:['owner']}));
  const turn=freezeTurn(config,bot,scope,['source'],profiles);assert.equal(turn.personaId,config.id);assert.equal(turn.personaRevision,1);assert.equal(turn.services.voice?.snapshot?.profileRevision,first.voice.revision);assert.equal(turn.services.voice?.snapshot?.profileContentHash,first.voice.contentHash);assert.equal(Object.isFrozen(turn.services),true);
  const nextProfile=profiles.create({serviceId:'voice',profileId:'default',state:'ready',capabilities:['voice.speak'],displayName:'Voice 2',managedConfig:{endpoint:'changed'}});const nextConfig={...config,revision:2};seedAppliedConfig(store,nextConfig,false);
  assert.equal(profiles.assertExecutable(turn.services.voice!.snapshot!).revision,1);assert.equal(turn.personaRevision,1);assert.equal(turn.config.revision,1);
  const next=freezeTurn(nextConfig,bot,scope,['next'],profiles);assert.equal(next.personaRevision,2);assert.equal(next.services.voice?.snapshot?.profileRevision,nextProfile.revision);assert.notEqual(next.services.voice?.snapshot?.profileContentHash,turn.services.voice?.snapshot?.profileContentHash);
});

test('missing, blocked, disabled and revoked profiles never fall back and immediately revoke old turns',async t=>{
  const {profiles}=await fixture(t),existing=addProfiles(profiles),config=serviceConfig(),bot=botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true,trustedUsers:['owner']});
  const active=freezeTurn(config,bot,scope,[],profiles);assert.equal(allowedNow('bot_voice',active,config,bot,scope),true);
  const missing=freezeTurn({...config,media:{...config.media,voice:{...config.media.voice!,profileRef:{serviceId:'voice',profileId:'absent'}}}},bot,scope,[],profiles);assert.equal(missing.services.voice?.state,'missing');assert.equal(allowedNow('bot_voice',missing,config,bot,scope),false);
  const disabled=freezeTurn({...config,media:{...config.media,voice:{...config.media.voice!,enabled:false}}},bot,scope,[],profiles);assert.equal(disabled.services.voice?.state,'disabled');assert.equal(allowedNow('bot_voice',disabled,config,bot,scope),false);
  for(const state of ['blocked','disabled','revoked','missing'] as const){const local=new ProfileStore();const first=local.create({serviceId:'voice',profileId:'default',state:'ready',capabilities:['voice.speak'],displayName:'Voice',managedConfig:{value:state}});const snapshot={serviceId:first.serviceId,profileId:first.profileId,profileRevision:first.revision,profileContentHash:first.contentHash};local.transition({serviceId:'voice',profileId:'default'},state);assert.equal(local.snapshotStatus(snapshot).state,state);assert.throws(()=>local.assertExecutable(snapshot),new RegExp(`PROFILE_${state.toUpperCase()}`));}
  profiles.transition({serviceId:'voice',profileId:'default'},'revoked');assert.equal(permissionsRevoked(active,config,bot,scope),false);assert.equal(allowedNow('bot_voice',active,config,bot,scope),true,'tool visibility remains frozen; the media operation handles its own Profile availability');profiles.create({serviceId:'voice',profileId:'default',state:'ready',capabilities:['voice.speak'],displayName:'Restored',managedConfig:{endpoint:'restored'}});assert.equal(profiles.snapshotStatus(active.services.voice!.snapshot!).state,'revoked','a future ready revision cannot revive an older revoked turn');assert.equal(existing.voice.revision,1);
});

test('v4 external profiles never fall back to legacy media workers',async t=>{
  const {store,profiles}=await fixture(t);addProfiles(profiles);const config=serviceConfig(),assets=new Assets(store.repositories()),media=new MediaService(store.repositories(),assets);for(const operation of ['voice_speak','singing_convert','music_search'] as const)await assert.rejects(()=>media.run('scope',operation,config,[],{},new AbortController().signal,undefined,freezeTurn(config,botSchema.parse({id:'bot',name:'Bot',channel:'qq',enabled:true}),scope,[],profiles)),/PROFILE_ADAPTER_REQUIRED/);
});

test('text delivery is not coupled to unused service profiles',async t=>{const {store,profiles}=await fixture(t);addProfiles(profiles);const config=serviceConfig();seedAppliedConfig(store,config,false);store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true,configId:config.id}));const binding=store.sessions.binding(scope);store.deliveries.enqueue(binding,'source','turn',[{type:'text',text:'core reply'}],{});profiles.transition({serviceId:'voice',profileId:'default'},'revoked');let sends=0;const channels=createChannelRegistry([{id:'qq',displayName:'QQ',capabilities:{conversations:['private'],login:[],groupSupport:'unsupported'},adapter:{beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=>{sends++;return'receipt';}}}]);await new DurableDeliveryWorker(store.repositories(),channels,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},async()=>{},profiles).flush();assert.equal(sends,1);assert.equal(store.deliveries.deliveries()[0].state,'sent');});

test('materialized audio delivery does not recheck session, permission or Profile state',async t=>{
  for(const change of ['session','bot','profile','permission'] as const){const {store,profiles}=await fixture(t),created=addProfiles(profiles),config=serviceConfig();seedAppliedConfig(store,config);const bot=store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true,configId:config.id,trustedUsers:['owner']})),binding=store.sessions.binding(scope);let sends=0;
    store.assets.saveAsset({id:'asset',scopeKey:binding.key,sessionId:binding.sessionId,name:'voice.wav',mime:'audio/wav',path:'unused',size:1,kind:'audio',createdAt:1});store.deliveries.enqueue(binding,'source','turn',[{type:'asset',assetId:'asset'}],{});
    if(change==='session')store.sessions.reset(scope);if(change==='bot')store.bots.saveBot({...bot,enabled:false});if(change==='profile')profiles.transition({serviceId:'voice',profileId:'default'},'revoked');if(change==='permission')seedAppliedConfig(store,{...config,revision:2,tools:config.tools.filter(tool=>tool!=='bot_voice')},false);
    const channels=createChannelRegistry([{id:'qq',displayName:'QQ',capabilities:{conversations:['private'],login:[],groupSupport:'unsupported'},adapter:{beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=>{sends++;return'receipt';}}}]);const worker=new DurableDeliveryWorker(store.repositories(),channels,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},async()=>{},profiles);await worker.flush();assert.equal(sends,1,change);assert.equal(store.deliveries.deliveries()[0].state,'sent');assert.equal(created.voice.revision,1);
  }
});
