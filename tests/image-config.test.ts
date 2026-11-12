import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {configSchema,publicPersonaConfig,v4ConfigSchema} from '../src/core/types.js';
import {resolveImageSkill} from '../src/core/image-skill.js';
import {applyImageServiceSettings,imageServiceSettingsSchema} from '../src/core/image-service-config.js';

const image={enabled:true,baseUrl:'https://images.example.invalid/v1',model:'fixture-image',keyEnv:'FIXTURE_IMAGE_KEY'};
const persona=(schemaVersion:4)=>({schemaVersion,id:'image-config',name:'Image configuration',personaPrompt:'Test persona',media:{image}});

async function fixture(t:any){
  await mkdir(path.resolve('.codex'),{recursive:true});
  const root=await mkdtemp(path.resolve('.codex/image-config-')),store=new SqlitePersistence(path.join(root,'store'),path.join(root,'personas'));
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  return store;
}

test('v4 image connection survives persona save, file read, projection and endpoint selection',async t=>{
  const store=await fixture(t),saved=store.personas.saveConfig(persona(4));
  assert.deepEqual(saved.media.image,image);
  assert.deepEqual(store.personas.config(saved.id).media.image,image);
  assert.deepEqual(store.personas.readPersonaDraft(saved.id).config.media.image,image);
  assert.deepEqual(publicPersonaConfig(saved).media.image,image);
  assert.deepEqual(resolveImageSkill(saved,{BOT_IMAGE_BASE_URL:'https://fallback.example.invalid',BOT_IMAGE_KEY_ENV:'FALLBACK_KEY',BOT_IMAGE_MODEL:'fallback'}),{baseUrl:'https://fallback.example.invalid',model:'fallback',keyEnv:'FALLBACK_KEY'});
  assert.deepEqual(resolveImageSkill(saved,{}),{baseUrl:image.baseUrl,model:image.model,keyEnv:image.keyEnv});
  const edited=store.personas.saveConfig({...saved,name:'Edited'},saved.revision);
  assert.deepEqual(edited.media.image,image);
  assert.equal(edited.revision,saved.revision+1);
});

test('image overrides validate HTTPS and variable names without permitting secret fields or other service endpoints',()=>{
  const base=persona(4);
  for(const baseUrl of ['http://images.example.invalid','https://user:password@images.example.invalid','https://images.example.invalid?key=value','https://images.example.invalid#fragment','https://images.example.invalid:8443'])assert.equal(v4ConfigSchema.safeParse({...base,media:{image:{...image,baseUrl}}}).success,false,baseUrl);
  for(const keyEnv of ['', 'lowercase', 'KEY-NAME', 'KEY NAME', '${KEY}', 'sk-fixture-value'])assert.equal(v4ConfigSchema.safeParse({...base,media:{image:{...image,keyEnv}}}).success,false,keyEnv);
  for(const field of ['apiKey','secret','credentials','endpoint','path'])assert.equal(v4ConfigSchema.safeParse({...base,media:{image:{...image,[field]:'not-a-config-field'}}}).success,false,field);
  for(const role of ['asr','video','voice','singing','music'])for(const field of ['baseUrl','keyEnv'])assert.equal(v4ConfigSchema.safeParse({...base,media:{image,[role]:{enabled:false,[field]:field==='baseUrl'?image.baseUrl:image.keyEnv}}}).success,false,`${role}.${field}`);
  assert.equal(v4ConfigSchema.safeParse({...base,media:{image:{enabled:true}}}).success,true);
});

test('ComfyUI image overrides accept loopback HTTP and keep OpenAI validation strict',()=>{
  const base=persona(4);
  const comfy={protocol:'comfyui',baseUrl:'http://127.0.0.1:8188',model:'comfyui',workflowEnv:'BOT_COMFYUI_WORKFLOW'};
  assert.equal(v4ConfigSchema.safeParse({...base,media:{image:comfy}}).success,true);
  assert.equal(v4ConfigSchema.safeParse({...base,media:{image:{...comfy,baseUrl:'http://192.168.1.5:8188'}}}).success,false);
  const endpoint=resolveImageSkill(configSchema.parse({...base,media:{image:comfy}}),{BOT_IMAGE_PROTOCOL:'comfyui',BOT_COMFYUI_BASE_URL:'http://127.0.0.1:8188',BOT_COMFYUI_WORKFLOW:'E:\\COMFYUI\\workflows\\infrastructure-smoke-api.json'});
  assert.equal(endpoint.protocol,'comfyui');
  assert.equal(endpoint.workflowPath,'E:\\COMFYUI\\workflows\\infrastructure-smoke-api.json');
  assert.equal(resolveImageSkill(configSchema.parse({...base,media:{image:{protocol:'comfyui',model:'comfyui'}}}),{}).baseUrl,'http://127.0.0.1:8188');
});

test('operator image settings own OpenAI model and API key environment name',()=>{
  const settings=imageServiceSettingsSchema.parse({imageProtocol:'openai',openAiBaseUrl:'https://images.example.invalid/v1',openAiModel:'fixture-image',openAiKeyEnv:'FIXTURE_IMAGE_KEY'});
  const env:NodeJS.ProcessEnv={};
  applyImageServiceSettings(settings,env);
  assert.equal(env.BOT_IMAGE_PROTOCOL,'openai');
  assert.equal(env.BOT_IMAGE_BASE_URL,settings.openAiBaseUrl);
  assert.equal(env.BOT_IMAGE_MODEL,settings.openAiModel);
  assert.equal(env.BOT_IMAGE_KEY_ENV,settings.openAiKeyEnv);
  assert.equal(env.BOT_COMFYUI_BASE_URL,undefined);
});
