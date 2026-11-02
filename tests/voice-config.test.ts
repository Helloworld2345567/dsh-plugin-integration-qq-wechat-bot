import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {configSchema,voiceSkillSchema} from '../src/core/types.js';
import {Store} from '../src/core/store.js';
import {normalizeGptSovitsBaseUrl,normalizeGptSovitsPromptText} from '../src/core/voice-config.js';

const reference={baseUrl:'http://tts.invalid:9880/',modelVersion:'v4',gptWeightsPath:'models/voice.ckpt',sovitsWeightsPath:'models/voice.pth',refAudioPath:'references/voice.wav',promptText:'参考语音',promptLang:'all_zh',textLang:'all_zh'};
const persona=(id:string,patch:Record<string,unknown>={})=>configSchema.parse({id,name:id,personaPrompt:'A',media:{voice:{enabled:true,protocol:'gpt_sovits',gptSovits:{...reference,...patch}}}});

test('voice defaults use Edge TTS and choose WAV for configured GPT-SoVITS',()=>{
  assert.deepEqual(voiceSkillSchema.parse({}),{enabled:false,protocol:'edge_tts',replyMode:'on_demand',format:'mp3'});
  const config=persona('voice');assert.equal(config.media.voice?.format,'wav');assert.equal(config.media.voice?.gptSovits?.baseUrl,'http://tts.invalid:9880');
  assert.throws(()=>voiceSkillSchema.parse({enabled:true,protocol:'gpt_sovits'}),/请配置/);
  assert.throws(()=>voiceSkillSchema.parse({enabled:true,protocol:'gpt_sovits',gptSovits:reference,format:'mp3'}),/仅支持 WAV/);
  assert.throws(()=>persona('voice',{baseUrl:'http://user:pass@tts.invalid'}),/无凭据/);
  assert.throws(()=>persona('voice',{modelVersion:'v1',promptLang:'ko'}),/v1 仅支持/);
  assert.throws(()=>persona('voice',{promptText:'中'.repeat(12000)}),/32 KiB/);
  assert.throws(()=>voiceSkillSchema.parse({voice:'中'.repeat(43)}),/128 字节/);
  assert.equal(persona('voice',{modelVersion:'v2ProPlus',promptLang:'all_ko'}).media.voice?.gptSovits?.modelVersion,'v2ProPlus');
});

test('service and prompt identities match the inference service cache conventions',()=>{
  assert.equal(normalizeGptSovitsBaseUrl('HTTP://TTS.INVALID:80/api///'),'http://tts.invalid/api');
  assert.throws(()=>normalizeGptSovitsBaseUrl('http://tts.invalid/api?token=x'),/ENDPOINT_INVALID/);
  assert.equal(normalizeGptSovitsPromptText('\nhello\n','en'),'hello.');
  assert.equal(normalizeGptSovitsPromptText('你好！\n','all_zh'),'你好！');
  assert.equal(normalizeGptSovitsPromptText(' hello ','en'),' hello .');
  assert.equal(normalizeGptSovitsPromptText('你好:','ja'),'你好:');
});

test('legacy GPT-SoVITS personas remain readable and the next save removes private service identity',async t=>{
  const home=await mkdtemp(path.resolve('.codex/voice-config-'));const store=new Store(home);t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  const first=persona('first');store.put('config',first.id,first);store.put('config-version',`${first.id}:${first.revision}`,first);
  assert.equal(store.config('first').media.voice?.gptSovits?.modelVersion,'v4');
  const saved=store.saveConfig({...first,name:'Saved'},first.revision);assert.equal(saved.schemaVersion,4);assert.equal(saved.media.voice?.gptSovits,undefined);assert.doesNotMatch(JSON.stringify(saved),/tts\.invalid|voice\.ckpt|voice\.pth|refAudioPath/);
  const second=store.saveConfig(persona('second',{modelVersion:'v1'}));assert.equal(second.schemaVersion,4);assert.equal(second.media.voice?.gptSovits,undefined);
});

test('v4 edits cannot reintroduce GPT-SoVITS endpoint or weight fields',async t=>{
  const home=await mkdtemp(path.resolve('.codex/voice-config-'));const store=new Store(home);t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  const saved=store.saveConfig(persona('voice'));
  assert.throws(()=>store.saveConfig({...saved,media:{voice:{...saved.media.voice,gptSovits:{...reference,modelVersion:'v1'}}}},saved.revision),/expected never|v4 人格不得保存/);
  const archived=store.saveConfig({...saved,archived:true},saved.revision);assert.equal(archived.schemaVersion,4);assert.equal(archived.media.voice?.gptSovits,undefined);
});
