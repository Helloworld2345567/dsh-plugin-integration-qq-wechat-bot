import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {botSchema,botSettingsSchema,botSettingsFromConfig,configSchema,type CallerScope} from '../src/core/types.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime} from '../src/core/runtime.js';
import {freezeTurn,allowedNow} from '../src/core/policy.js';
import {Admin} from '../src/harness/admin.js';
import {BotFeatures} from '../src/core/features.js';
import {ProfileStore} from '../src/core/profile-store.js';
import {fixtureChannels} from './test-channel.js';
import {seedLegacyBot} from './sqlite-fixtures.js';

const scope=(botId='one'):CallerScope=>({botId,platform:'qq',accountId:botId,kind:'private',channelId:'owner',senderId:'owner'});
async function fixture(t:any){
  const home=await mkdtemp(path.resolve('.codex/bot-settings-')),store=new SqlitePersistence(home),assets=new Assets(store.repositories()),profiles=new ProfileStore(store.profiles);
  const runtime=new BotRuntime(store.repositories(),assets,new MediaService(store.repositories(),assets),{
    run:async()=>{throw Error('UNUSED');},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async config=>{if(config.model?.model==='invalid')throw Error('UNKNOWN_MODEL');},
  },fixtureChannels({beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=>''}),{read:async()=>undefined,write:async()=>{},remove:async()=>{}},60000,0,profiles);
  t.after(async()=>{await runtime.close();store.close();await rm(home,{recursive:true,force:true});});
  return {home,store,runtime,profiles};
}

test('bot runtime settings accept only runtime preferences and preserve Profile boundaries',()=>{
  const settings=botSettingsFromConfig(configSchema.parse({id:'p',name:'P',personaPrompt:'Prompt'}));
  assert.equal('personaPrompt' in settings,false);assert.equal('id' in settings,false);assert.equal('revision' in settings,false);
  for(const extra of [{id:'p'},{personaPrompt:'other'},{revision:2},{endpoint:'https://example.invalid'}])assert.throws(()=>botSettingsSchema.parse({...settings,...extra}));
  for(const media of [{voice:{enabled:true,engine:'gpt-sovits',baseUrl:'http://localhost:9880'}},{music:{home:'E:/Music'}},{singing:{singingWeightsPath:'E:/model.pth'}}])assert.throws(()=>botSettingsSchema.parse({...settings,media}));
  assert.equal(botSettingsSchema.parse({...settings,media:{voice:{enabled:true,engine:'gpt-sovits',profileRef:{serviceId:'gpt-sovits',profileId:'speaker'}}}}).media.voice?.profileRef?.profileId,'speaker');
});

test('existing bots snapshot their applied config once and omitted settings never overwrite the snapshot',async t=>{
  const home=await mkdtemp(path.resolve('.codex/bot-settings-migration-'));t.after(()=>rm(home,{recursive:true,force:true}));
  let store=new SqlitePersistence(home);
  try{
    const old=store.personas.config('default');store.personas.saveConfig({...old,model:{provider:'P',model:'original'},progressReply:{enabled:false,intervalSeconds:120}},old.revision);
    seedLegacyBot(store,'one',botSchema.parse({id:'one',name:'One',channel:'qq'}));
    store.close();store=new SqlitePersistence(home);
    const migrated=store.bots.bot('one');assert.equal(migrated.settings?.model?.model,'original');assert.equal(migrated.settings?.progressReply.intervalSeconds,120);
    const persona=store.personas.config('default');store.personas.saveConfig({...persona,model:{provider:'P',model:'later'}},persona.revision);
    const {settings:_,...withoutSettings}=migrated;store.bots.saveBot({...withoutSettings,configId:'sakura',name:'Renamed'});
    assert.deepEqual(store.bots.bot('one').settings,migrated.settings);
    store.close();store=new SqlitePersistence(home);assert.deepEqual(store.bots.bot('one').settings,migrated.settings);
  }finally{store.close();}
});

test('bots sharing a persona retain independent settings when persona files are applied',async t=>{
  const f=await fixture(t),base=f.store.personas.config('default');
  const configured=await f.runtime.saveConfig({...base,model:{provider:'P',model:'initial'},imageStyle:'initial style'},base.revision);
  for(const id of ['one','two'])f.runtime.saveBot({id,name:id,channel:'qq',enabled:true,trustedUsers:['owner']});
  const one=f.store.bots.bot('one'),two=f.store.bots.bot('two');
  f.runtime.saveBot({...one,settings:{...one.settings!,model:{provider:'P',model:'one'},imageStyle:'one style',progressReply:{enabled:false,intervalSeconds:90}}});
  const {personaPrompt:_,...file}=configured;await writeFile(path.join(f.store.personas.personaDirectory('default'),'config.json'),JSON.stringify({...file,model:{provider:'P',model:'file-only'},imageStyle:'file-only style'}));
  await writeFile(path.join(f.store.personas.personaDirectory('default'),'persona.md'),'New persona prompt');await f.runtime.applyPersonaFiles('default');
  const a=f.runtime.effectiveConfig(f.store.sessions.binding(scope())),b=f.runtime.effectiveConfig(f.store.sessions.binding(scope('two')));
  assert.equal(a.personaPrompt,'New persona prompt');assert.equal(b.personaPrompt,'New persona prompt');assert.equal(a.model?.model,'one');assert.equal(a.imageStyle,'one style');assert.equal(b.model?.model,'initial');assert.deepEqual(f.store.bots.bot('two').settings,two.settings);
});

test('persona switching preserves bot settings and session overrides while frozen turns keep old values',async t=>{
  const f=await fixture(t);const settings=botSettingsSchema.parse({model:{provider:'P',model:'bot'},media:{voice:{enabled:true,protocol:'edge_tts',voice:'zh-CN-XiaoxiaoNeural'},singing:{enabled:true,profileRef:{serviceId:'rvc',profileId:'base'}}}});
  const bot=f.runtime.saveBot({id:'one',name:'One',channel:'qq',enabled:true,trustedUsers:['owner'],settings});
  let binding=f.store.sessions.binding(scope());binding={...binding,modelOverride:{provider:'P',model:'session'},ttsOverride:{kind:'profile',profileRef:{serviceId:'gpt-sovits',profileId:'speaker'}},stsOverride:{profileRef:{serviceId:'rvc',profileId:'song'}}};f.store.sessions.updateSession(binding);
  const snapshot=freezeTurn(f.runtime.effectiveConfig(binding),bot,scope(),[]);
  await f.runtime.switchPersona(scope(),'sakura');const after=f.store.sessions.binding(scope()),effective=f.runtime.effectiveConfig(after);
  assert.equal(after.sessionId,binding.sessionId);assert.deepEqual(after.modelOverride,binding.modelOverride);assert.deepEqual(after.ttsOverride,binding.ttsOverride);assert.deepEqual(after.stsOverride,binding.stsOverride);assert.equal(effective.id,'sakura');assert.equal(effective.model?.model,'session');assert.equal(effective.media.voice?.profileRef?.profileId,'speaker');assert.equal(effective.media.singing?.profileRef?.profileId,'song');assert.deepEqual(f.store.bots.bot('one').settings,settings);
  f.runtime.saveBot({...bot,settings:{...settings,tools:[]}});assert.equal(allowedNow('bot_media',snapshot,f.runtime.effectiveConfig(after),f.store.bots.bot('one'),scope()),false);assert.equal(snapshot.config.id,'default');assert.equal(snapshot.config.model?.model,'session');assert.ok(snapshot.config.tools.includes('bot_media'));
});

test('bot save validates model selections and bot-scoped status reads each bot settings',async t=>{
  const f=await fixture(t);for(const id of ['one','two'])f.runtime.saveBot({id,name:id,channel:'qq',enabled:true});
  const admin=new Admin({} as any,f.runtime,'fixture',async()=>{}),one=f.store.bots.bot('one');
  await assert.rejects(admin.invoke('bot.save',{...one,settings:{...one.settings!,model:{provider:'P',model:'invalid'}}}),/UNKNOWN_MODEL/);assert.deepEqual(f.store.bots.bot('one'),one);
  await admin.invoke('bot.save',{...one,settings:{...one.settings!,media:{image:{enabled:true,protocol:'comfyui'}}}});
  const status:any=await admin.invoke('skill.image.status',{scope:'bots'});assert.equal(status.one.protocol,'comfyui');assert.equal(status.two.protocol,'openai');assert.equal(status.default,undefined);
  const legacy:any=await admin.invoke('skill.image.status',{});assert.ok(legacy.default);assert.equal(legacy.one,undefined);
  const bots:any=await admin.query({version:1,kind:'query',name:'bots.list',input:{}});assert.equal(bots.data.find((bot:any)=>bot.id==='one').settings.media.image.protocol,'comfyui');
});

test('dormant persona models cannot block persona edits, file application or prompt tools',async t=>{
  const f=await fixture(t),base=f.store.personas.config('default');
  let persona=await f.runtime.saveConfig({...base,model:{provider:'removed',model:'invalid'}},base.revision);
  const bot=f.runtime.saveBot({id:'one',name:'One',channel:'qq',enabled:true,trustedUsers:['owner'],settings:botSettingsSchema.parse({model:{provider:'P',model:'valid'}})});
  const admin=new Admin({} as any,f.runtime,'fixture',async()=>{});
  persona=await admin.invoke('config.save',{config:{...persona,name:'Renamed',personaPrompt:'Edited'},expectedRevision:persona.revision}) as typeof persona;
  await writeFile(path.join(f.store.personas.personaDirectory('default'),'persona.md'),'Applied from file');await f.runtime.applyPersonaFiles('default');
  const binding=f.store.sessions.binding(scope()),features=new BotFeatures(f.runtime),snapshot=freezeTurn(f.runtime.effectiveConfig(binding),bot,scope(),[]);
  await features.execute(binding,snapshot,{action:'persona',content:'Edited by prompt tool'},new AbortController().signal);
  assert.equal(f.store.personas.config('default').personaPrompt,'Edited by prompt tool');assert.equal(f.runtime.effectiveConfig(binding).model?.model,'valid');
});

test('bot-scoped voice and singing statuses never reuse a shared persona acceptance result',async t=>{
  const f=await fixture(t),base=f.store.personas.config('default');
  for(const [serviceId,operation] of [['gpt-sovits','gpt-sovits.speak'],['rvc','rvc.convert']])f.profiles.create({serviceId,profileId:'speaker',state:'ready',capabilities:[operation],displayName:'Speaker',managedConfig:{}});
  await f.runtime.saveConfig({...base,media:{voice:{enabled:true,engine:'gpt-sovits',profileRef:{serviceId:'gpt-sovits',profileId:'speaker'},format:'wav'},singing:{enabled:true,profileRef:{serviceId:'rvc',profileId:'speaker'}}}},base.revision);
  for(const id of ['one','two'])f.runtime.saveBot({id,name:id,channel:'qq',enabled:true});
  const two=f.store.bots.bot('two'),settings=two.settings!;f.runtime.saveBot({...two,settings:{...settings,media:{...settings.media,singing:{...settings.media.singing!,pitchShift:12}}}});
  const services={acceptance:()=>({data:{state:'PASS'}}),healthStatus:()=>({state:'ready'})};
  const admin=new Admin({} as any,f.runtime,'fixture',async()=>{},undefined,services as any);
  for(const [action,field] of [['skill.voice.status','synthesisValidation'],['skill.singing.status','conversionValidation']]){
    const legacy:any=await admin.invoke(action,{}),scoped:any=await admin.invoke(action,{scope:'bots'});
    assert.equal(legacy.default[field].status,'PASS');assert.equal(scoped.one[field].status,'NOT_RUN');assert.equal(scoped.two[field].status,'NOT_RUN');assert.equal(scoped.two.health.state,'ready');
  }
});

test('a bot settings save cannot overwrite changes made while the model is being validated',async t=>{
  const f=await fixture(t),bot=f.runtime.saveBot({id:'one',name:'One',channel:'qq',enabled:true,trustedUsers:['owner']});
  let release!:()=>void,entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  f.runtime.harness.validateModel=async()=>{entered();await new Promise<void>(resolve=>release=resolve);};
  const admin=new Admin({} as any,f.runtime,'fixture',async()=>{}),saving=admin.invoke('bot.save',{...bot,settings:{...bot.settings!,model:{provider:'P',model:'next'}}});
  await started;f.runtime.saveBot({...bot,trustedUsers:['owner','added']});release();await assert.rejects(saving,/配置已被其他操作修改/);
  assert.deepEqual(f.store.bots.bot('one').trustedUsers,['owner','added']);assert.equal(f.store.bots.bot('one').settings?.model,null);
});
