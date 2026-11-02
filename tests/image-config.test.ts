import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/core/store.js';
import {ProfileStore,StoreProfileRepository} from '../src/core/profile-store.js';
import {ServiceProfileMigration} from '../src/core/service-migration.js';
import {configSchema,publicPersonaConfig,v4ConfigSchema} from '../src/core/types.js';
import {resolveImageSkill} from '../src/core/image-skill.js';

const image={enabled:true,baseUrl:'https://images.example.invalid/v1',model:'fixture-image',keyEnv:'FIXTURE_IMAGE_KEY'};
const persona=(schemaVersion:3|4)=>({schemaVersion,id:'image-config',name:'Image configuration',personaPrompt:'Test persona',media:{image}});

async function fixture(t:any){
  await mkdir(path.resolve('.codex'),{recursive:true});
  const root=await mkdtemp(path.resolve('.codex/image-config-')),store=new Store(path.join(root,'store'),path.join(root,'personas'));
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  return store;
}

test('v4 image connection survives persona save, file read, projection and endpoint selection',async t=>{
  const store=await fixture(t),saved=store.saveConfig(persona(4));
  assert.deepEqual(saved.media.image,image);
  assert.deepEqual(store.config(saved.id).media.image,image);
  assert.deepEqual(store.readPersonaDraft(saved.id).config.media.image,image);
  assert.deepEqual(publicPersonaConfig(saved).media.image,image);
  assert.deepEqual(resolveImageSkill(saved,{BOT_IMAGE_BASE_URL:'https://fallback.example.invalid',BOT_IMAGE_KEY_ENV:'FALLBACK_KEY',BOT_IMAGE_MODEL:'fallback'}),{baseUrl:image.baseUrl,model:image.model,keyEnv:image.keyEnv});
  const edited=store.saveConfig({...saved,name:'Edited'},saved.revision);
  assert.deepEqual(edited.media.image,image);
  assert.equal(edited.revision,saved.revision+1);
});

test('saving a legacy persona preserves its image connection while writing v4',async t=>{
  const store=await fixture(t),legacy=configSchema.parse(persona(3));
  store.personas.publish(legacy,digest=>store.transaction(()=>{store.put('config',legacy.id,legacy);store.put('config-version',`${legacy.id}:${legacy.revision}`,legacy);store.put('persona-files',legacy.id,{digest});}));
  const saved=store.saveConfig({...legacy,name:'Saved legacy'},legacy.revision);
  assert.equal(saved.schemaVersion,4);
  assert.deepEqual(saved.media.image,image);
  assert.deepEqual(store.readPersonaDraft(saved.id).config.media.image,image);
});

test('service migration keeps an existing image connection in the activated persona',async t=>{
  const store=await fixture(t),legacy=configSchema.parse(persona(3));
  store.personas.publish(legacy,digest=>store.transaction(()=>{store.put('config',legacy.id,legacy);store.put('config-version',`${legacy.id}:${legacy.revision}`,legacy);store.put('persona-files',legacy.id,{digest});}));
  const profiles=new ProfileStore(new StoreProfileRepository(store)),migration=new ServiceProfileMigration(store,profiles,{health:async()=>{throw Error('Image migration needs no Profile health request');}},{accept:async()=>{throw Error('Image migration needs no Profile acceptance request');}},[]);
  const prepared=migration.prepare(legacy.id),result=await migration.execute(prepared.journal.id,{confirmed:true,signal:new AbortController().signal});
  assert.equal(result.state,'activated');
  assert.equal(store.config(legacy.id).schemaVersion,4);
  assert.deepEqual(store.config(legacy.id).media.image,image);
  assert.deepEqual(store.readPersonaDraft(legacy.id).config.media.image,image);
});

test('image overrides validate HTTPS and variable names without permitting secret fields or other service endpoints',()=>{
  const base=persona(4);
  for(const baseUrl of ['http://images.example.invalid','https://user:password@images.example.invalid','https://images.example.invalid?key=value','https://images.example.invalid#fragment','https://images.example.invalid:8443'])assert.equal(v4ConfigSchema.safeParse({...base,media:{image:{...image,baseUrl}}}).success,false,baseUrl);
  for(const keyEnv of ['', 'lowercase', 'KEY-NAME', 'KEY NAME', '${KEY}', 'sk-fixture-value'])assert.equal(v4ConfigSchema.safeParse({...base,media:{image:{...image,keyEnv}}}).success,false,keyEnv);
  for(const field of ['apiKey','secret','credentials','endpoint','path'])assert.equal(v4ConfigSchema.safeParse({...base,media:{image:{...image,[field]:'not-a-config-field'}}}).success,false,field);
  for(const role of ['asr','video','voice','singing','music'])for(const field of ['baseUrl','keyEnv'])assert.equal(v4ConfigSchema.safeParse({...base,media:{image,[role]:{enabled:false,[field]:field==='baseUrl'?image.baseUrl:image.keyEnv}}}).success,false,`${role}.${field}`);
  assert.equal(v4ConfigSchema.safeParse({...base,media:{image:{enabled:true}}}).success,true);
});
