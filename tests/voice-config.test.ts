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

test('persona saves reject incompatible reference cache keys on the same service',async t=>{
  const home=await mkdtemp(path.resolve('.codex/voice-config-'));const store=new Store(home);t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  store.saveConfig(persona('first'));
  assert.throws(()=>store.saveConfig(persona('second',{baseUrl:'http://TTS.invalid:9880',promptText:'\n参考语音。\n',promptLang:'all_ja'})),/GPT_SOVITS_REFERENCE_CONFLICT.*first/);
  assert.throws(()=>store.saveConfig(persona('second',{modelVersion:'v1'})),/GPT_SOVITS_REFERENCE_CONFLICT.*first/);
  assert.equal(store.configs().some(config=>config.id==='second'),false);
  assert.equal(store.saveConfig(persona('compatible',{modelVersion:'v5turbo'})).id,'compatible');
  assert.equal(store.saveConfig(persona('another-service',{baseUrl:'http://other.invalid',modelVersion:'v1'})).id,'another-service');
  assert.equal(store.saveConfig(persona('another-transcript',{promptText:'另一段实际参考文本',promptLang:'all_ja'})).id,'another-transcript');
});

test('archived references do not block saves and edits cannot introduce conflicts',async t=>{
  const home=await mkdtemp(path.resolve('.codex/voice-config-'));const store=new Store(home);t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  const first=store.saveConfig(persona('first'));const second=store.saveConfig(persona('second',{promptText:'另一段'}));
  assert.throws(()=>store.saveConfig({...second,media:{voice:{...second.media.voice,gptSovits:{...reference,modelVersion:'v1'}}}},second.revision),/GPT_SOVITS_REFERENCE_CONFLICT/);
  store.saveConfig({...first,archived:true},first.revision);
  assert.equal(store.saveConfig({...second,media:{voice:{...second.media.voice,gptSovits:{...reference,modelVersion:'v1'}}}},second.revision).media.voice?.gptSovits?.modelVersion,'v1');
});
