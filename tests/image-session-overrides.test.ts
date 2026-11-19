import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {botSchema,botSettingsFromConfig,configSchema,type CallerScope} from '../src/core/types.js';
import {imageProtocolSchema,imageServiceSettingsSchema} from '../src/core/image-service-config.js';
import {imageSkillEnabled,resolveImageSkill} from '../src/core/image-skill.js';

const scope=(senderId='alice',botId='one'):CallerScope=>({botId,platform:'qq',accountId:botId,kind:'private',channelId:senderId,senderId});

async function fixture(t:TestContext){
  await mkdir(path.resolve('.codex'),{recursive:true});
  const home=await mkdtemp(path.resolve('.codex/image-session-'));
  let store=new SqlitePersistence(home);
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true,trustedUsers:['alice']}));
  return{get store(){return store;},reopen(){store.close();store=new SqlitePersistence(home);return store;}};
}

test('image selection uses session, bot, then global defaults and survives reopen',async t=>{
  const state=await fixture(t),store=state.store;
  const original=store.personas.config('default');
  const configured=configSchema.parse({...original,media:{...original.media,image:{protocol:'openai'}}});
  store.bots.saveBot({...store.bots.bot('one'),settings:botSettingsFromConfig(configured)});
  const global=imageServiceSettingsSchema.parse({imageProtocol:'google'});
  let binding=store.sessions.binding(scope());
  assert.equal(resolveImageSkill(store.personas.effectiveConfig(binding),global).protocol,'openai');
  for(const protocol of imageProtocolSchema.options){
    binding=store.sessions.updateSession({...binding,imageProtocolOverride:protocol});
    assert.equal(resolveImageSkill(store.personas.effectiveConfig(binding),global).protocol,protocol);
    assert.equal(store.sessions.session(scope(),binding.sessionId).imageProtocolOverride,protocol);
  }
  assert.equal(store.bots.bot('one').settings?.media.image?.protocol,'openai');
  assert.deepEqual(store.personas.config('default'),original);
  binding=store.sessions.updateSession({...binding,imageProtocolOverride:undefined});
  assert.equal(resolveImageSkill(store.personas.effectiveConfig(binding),global).protocol,'openai');
  store.bots.saveBot({...store.bots.bot('one'),settings:botSettingsFromConfig(configSchema.parse({...configured,media:{}}))});
  assert.equal(resolveImageSkill(store.personas.effectiveConfig(binding),global).protocol,'google');
  binding=store.sessions.updateSession({...binding,imageProtocolOverride:'comfyui'});
  const reopened=state.reopen(),restored=reopened.sessions.binding(scope());
  assert.equal(restored.imageProtocolOverride,'comfyui');
  assert.equal(reopened.sessions.session(scope(),restored.sessionId).imageProtocolOverride,'comfyui');
  assert.equal(resolveImageSkill(reopened.personas.effectiveConfig(restored),global).protocol,'comfyui');
});

test('new sessions retain image selection and history restores its own saved selection',async t=>{
  const {store}=await fixture(t),legacy=store.sessions.binding(scope());
  store.sessions.markSessionPersisted(legacy);
  const first=store.sessions.updateSession({...store.sessions.reset(scope()),imageProtocolOverride:'google'});
  store.sessions.markSessionPersisted(first);
  const next=store.sessions.reset(scope());
  assert.notEqual(next.sessionId,first.sessionId);
  assert.equal(next.imageProtocolOverride,'google');
  assert.equal(next.persisted,false);
  const second=store.sessions.updateSession({...next,imageProtocolOverride:'comfyui'});
  store.sessions.markSessionPersisted(second);
  assert.equal(store.sessions.activateSession(scope(),first.sessionId).imageProtocolOverride,'google');
  assert.equal(store.sessions.activateSession(scope(),second.sessionId).imageProtocolOverride,'comfyui');
  assert.equal(store.sessions.activateSession(scope(),legacy.sessionId).imageProtocolOverride,undefined);
  assert.equal(store.sessions.reset(scope()).imageProtocolOverride,undefined);
});

test('image overrides stay with their channel identity and survive persona selection',async t=>{
  const {store}=await fixture(t);
  const original=store.personas.config('default');
  store.personas.saveConfig(configSchema.parse({...original,id:'other',name:'Other',media:{image:{protocol:'comfyui'}}}));
  store.bots.saveBot(botSchema.parse({id:'two',name:'Two',channel:'qq',accountId:'two',enabled:true}));
  const binding=store.sessions.updateSession({...store.sessions.binding(scope()),imageProtocolOverride:'google'});
  const switched=store.sessions.updateSession({...binding,personaId:'other'});
  assert.equal(store.personas.effectiveConfig(switched).media.image?.protocol,'google');
  for(const other of [scope('bob'),scope('alice','two')]){
    const independent=store.sessions.binding(other);
    assert.equal(independent.imageProtocolOverride,undefined);
    assert.equal(store.personas.effectiveConfig(independent).media.image?.protocol,store.bots.bot(other.botId).settings?.media.image?.protocol);
  }
});

test('image overrides do not enable disabled image capability or its tool and skill permissions',async t=>{
  const {store}=await fixture(t),original=store.personas.config('default');
  const binding=store.sessions.updateSession({...store.sessions.binding(scope()),imageProtocolOverride:'google'});
  for(const configured of [
    configSchema.parse({...original,media:{image:{enabled:false,protocol:'openai'}}}),
    configSchema.parse({...original,media:{},skills:original.skills.filter(name=>name!=='image-generation')}),
    configSchema.parse({...original,media:{},tools:original.tools.filter(name=>name!=='bot_media')}),
  ]){
    store.bots.saveBot({...store.bots.bot('one'),settings:botSettingsFromConfig(configured)});
    const effective=store.personas.effectiveConfig(binding);
    assert.equal(effective.media.image?.protocol,'google');
    assert.equal(imageSkillEnabled(effective),false);
    assert.deepEqual(effective.tools,configured.tools);
    assert.deepEqual(effective.skills,configured.skills);
    if(configured.media.image?.enabled===false)assert.equal(effective.media.image.enabled,false);
  }
});
