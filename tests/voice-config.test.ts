import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configSchema,voiceSkillSchema,gptSovitsSchema} from '../src/core/types.js';
import {normalizeGptSovitsBaseUrl,normalizeGptSovitsPromptText} from '../src/core/voice-config.js';
const reference={baseUrl:'http://tts.invalid:9880/',modelVersion:'v4',gptWeightsPath:'models/voice.ckpt',sovitsWeightsPath:'models/voice.pth',refAudioPath:'references/voice.wav',promptText:'参考语音',promptLang:'all_zh',textLang:'all_zh'};
test('V4 voice uses a Profile or built-in Edge TTS and rejects inline inference configuration',()=>{
 assert.equal(voiceSkillSchema.parse({}).enabled,false);
 assert.equal(voiceSkillSchema.parse({enabled:true,profileRef:{serviceId:'gpt-sovits',profileId:'voice'},format:'wav'}).format,'wav');
 assert.throws(()=>voiceSkillSchema.parse({enabled:true,protocol:'speech'}));
 assert.throws(()=>voiceSkillSchema.parse({enabled:true,protocol:'gpt_sovits',gptSovits:reference}));
 assert.throws(()=>voiceSkillSchema.parse({protocol:'edge_tts',format:'wav'}));
 assert.throws(()=>voiceSkillSchema.parse({voice:'中'.repeat(43)}),/128 字节/);
 assert.throws(()=>configSchema.parse({schemaVersion:3,id:'voice',name:'Voice',personaPrompt:'A'}));
});
test('private GPT-SoVITS model configuration still validates model versions, references and endpoints',()=>{
 assert.equal(gptSovitsSchema.parse(reference).baseUrl,'http://tts.invalid:9880');
 assert.throws(()=>gptSovitsSchema.parse({...reference,baseUrl:'http://user:pass@tts.invalid'}),/无凭据/);
 assert.throws(()=>gptSovitsSchema.parse({...reference,modelVersion:'v1',promptLang:'ko'}),/v1 仅支持/);
 assert.throws(()=>gptSovitsSchema.parse({...reference,promptText:'中'.repeat(12000)}),/32 KiB/);
 assert.equal(gptSovitsSchema.parse({...reference,modelVersion:'v3'}).modelVersion,'v3');
});
test('service and prompt identities match inference cache conventions',()=>{
 assert.equal(normalizeGptSovitsBaseUrl('HTTP://TTS.INVALID:80/api///'),'http://tts.invalid/api');
 assert.throws(()=>normalizeGptSovitsBaseUrl('http://tts.invalid/api?token=x'),/ENDPOINT_INVALID/);
 assert.equal(normalizeGptSovitsPromptText('hello','en'),'hello.');
});
