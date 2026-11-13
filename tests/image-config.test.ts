import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {botSchema,botSettingsSchema,configSchema,publicPersonaConfig,v4ConfigSchema} from '../src/core/types.js';
import {resolveImageSkill} from '../src/core/image-skill.js';
import {imageServiceSettingsFromRecord,imageServiceSettingsSchema} from '../src/core/image-service-config.js';
import {Assets,MediaService} from '../src/core/media.js';
import {freezeTurn} from '../src/core/policy.js';
import {VoiceModelLibrary} from '../src/core/voice-model-library.js';
import {ProfileStore} from '../src/core/profile-store.js';

const legacyImage={enabled:true,protocol:'openai',baseUrl:'https://images.example.invalid/v1',model:'fixture-image',keyEnv:'FIXTURE_IMAGE_KEY',workflowEnv:'OLD_WORKFLOW'};
const persona=()=>({schemaVersion:4,id:'image-config',name:'Image configuration',personaPrompt:'Test persona',media:{image:legacyImage}});

async function fixture(t:any){
  await mkdir(path.resolve('.codex'),{recursive:true});
  const root=await mkdtemp(path.resolve('.codex/image-config-')),store=new SqlitePersistence(path.join(root,'store'),path.join(root,'personas'));
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  return {store,root};
}

test('retired image connection fields are removed from persona files and bot settings',async t=>{
  const {store}=await fixture(t),saved=store.personas.saveConfig(persona()),current={enabled:true,protocol:'openai'};
  assert.deepEqual(saved.media.image,current);
  assert.deepEqual(store.personas.config(saved.id).media.image,current);
  assert.deepEqual(store.personas.readPersonaDraft(saved.id).config.media.image,current);
  assert.deepEqual(publicPersonaConfig(saved).media.image,current);
  assert.deepEqual(botSettingsSchema.parse({media:{image:legacyImage}}).media.image,current);
  assert.deepEqual(resolveImageSkill(saved),{protocol:'openai',baseUrl:'https://api.openai.com/v1',model:'gpt-image-2',keyEnv:'OPENAI_API_KEY'});
});

test('image service settings validate endpoints and retain configurable credential variable names',()=>{
  for(const openAiBaseUrl of ['http://images.example.invalid','https://user:password@images.example.invalid','https://images.example.invalid?key=value','https://images.example.invalid#fragment','https://images.example.invalid:8443'])assert.equal(imageServiceSettingsSchema.safeParse({openAiBaseUrl}).success,false,openAiBaseUrl);
  assert.equal(imageServiceSettingsSchema.safeParse({comfyUiBaseUrl:'http://127.0.0.1:8188'}).success,true);
  assert.equal(imageServiceSettingsSchema.safeParse({comfyUiBaseUrl:'http://192.168.1.5:8188'}).success,false);
  assert.equal(imageServiceSettingsSchema.safeParse({openAiKeyEnv:'CUSTOM_KEY'}).success,true);
  assert.equal(imageServiceSettingsSchema.safeParse({openAiKeyEnv:'not a variable'}).success,false);
  assert.equal(imageServiceSettingsSchema.parse({}).openAiKeyEnv,'OPENAI_API_KEY');
  for(const field of ['apiKey','secret','credentials','endpoint','path'])assert.equal(v4ConfigSchema.safeParse({...persona(),media:{image:{enabled:true,[field]:'not-a-config-field'}}}).success,false,field);
  const settings=imageServiceSettingsFromRecord({openAiModel:'saved-model',openAiKeyEnv:'OLD_KEY'});
  assert.equal(settings.openAiModel,'saved-model');assert.equal(settings.openAiKeyEnv,'OLD_KEY');
});

test('ComfyUI receives explicit workflow configuration and persona protocol selection',()=>{
  const settings=imageServiceSettingsSchema.parse({imageProtocol:'openai',comfyUiBaseUrl:'http://127.0.0.1:8188',comfyUiWorkflowPath:'E:\\COMFYUI\\workflows\\fixture.json'});
  const config=configSchema.parse({...persona(),media:{image:{protocol:'comfyui'}}});
  assert.deepEqual(resolveImageSkill(config,settings),{protocol:'comfyui',baseUrl:'http://127.0.0.1:8188',model:'comfyui',workflowPath:'E:\\COMFYUI\\workflows\\fixture.json'});
});

test('saved image service settings preserve their chosen credential variable',async t=>{
  const {store,root}=await fixture(t);
  store.voiceLibrarySettings.write({modelsRoot:'',gptSovitsUrl:'http://127.0.0.1:9880',openAiModel:'saved-model',openAiKeyEnv:'OLD_KEY'});
  const library=new VoiceModelLibrary(store.voiceLibrarySettings,root,new ProfileStore(),{scan:async()=>({models:[]})});
  assert.equal(library.view().openAiModel,'saved-model');assert.equal(library.view().openAiKeyEnv,'OLD_KEY');
});

test('image settings and the selected credential variable stay frozen through a turn',async t=>{
  const {store}=await fixture(t),config=store.personas.saveConfig(persona());
  const bot=botSchema.parse({id:'image',name:'Image',channel:'qq',configId:config.id,enabled:true});store.bots.saveBot(bot);
  const binding=store.sessions.binding({botId:bot.id,platform:'qq',accountId:bot.id,kind:'private',channelId:'room',senderId:'person'});
  let settings=imageServiceSettingsSchema.parse({openAiBaseUrl:'https://images.example.invalid/v1',openAiModel:'before',openAiKeyEnv:'FIXTURE_IMAGE_KEY'});
  const calls:any[]=[],assets=new Assets(store.repositories()),media=new MediaService(store.repositories(),assets,undefined,undefined,{run:async(job,_signal,credentials)=>{calls.push({job,credentials});return{};}},undefined,undefined,undefined,()=>settings);
  const snapshot=freezeTurn(config,bot,binding.scope,[],undefined,'zh',media.imageSettings());
  settings={...settings,openAiModel:'after',openAiKeyEnv:'OPENAI_API_KEY'};
  const previous=process.env.FIXTURE_IMAGE_KEY,previousDefault=process.env.OPENAI_API_KEY;process.env.FIXTURE_IMAGE_KEY='fixture-only-key';delete process.env.OPENAI_API_KEY;
  t.after(()=>{if(previous===undefined)delete process.env.FIXTURE_IMAGE_KEY;else process.env.FIXTURE_IMAGE_KEY=previous;if(previousDefault===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousDefault;});
  await media.run(binding.key,'image_generate',config,[],{prompt:'fixture'},new AbortController().signal,undefined,snapshot);
  assert.equal(calls[0].job.endpoint.model,'before');assert.equal(calls[0].job.endpoint.keyEnv,'FIXTURE_IMAGE_KEY');
  assert.deepEqual(calls[0].credentials,{FIXTURE_IMAGE_KEY:'fixture-only-key'});
  assert.equal(media.imageEndpoint(config).model,'after');
  const next=freezeTurn(config,bot,binding.scope,[],undefined,'zh',media.imageSettings());
  assert.equal(media.imageEndpoint(config,next).model,'after');
  await assert.rejects(media.run(binding.key,'image_generate',config,[],{prompt:'fixture'},new AbortController().signal,undefined,next),/MISSING_PROVIDER_KEY: OPENAI_API_KEY/);
  assert.equal(calls.length,1);
});
