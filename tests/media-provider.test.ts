import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Context} from '@deepseek-ai/cordis';
import {HarnessMediaProvider} from '../src/harness/media-provider.js';
import {configSchema,botSchema} from '../src/core/types.js';
import {allowedNow,freezeTurn,mediaConfigNow} from '../src/core/policy.js';
import {MediaService,type Assets} from '../src/core/media.js';
import type {Store} from '../src/core/store.js';

function fixture(){
  let secret='stored-key';let reference='CHAT_KEY';let api='openai-completions';
  const reads:string[]=[];const profile={baseURL:'https://example.invalid/v1',apiKeyEnv:'CHAT_KEY',api};
  const services={llm:{listConfigurableProviders:()=>[{provider:'chat',settingsNs:'llm-test',settingsPath:['providers','chat']}],listModels:async()=>[{id:'chat-model'},{id:'av-model'}]},settings:{describe:(options:any)=>{assert.equal(options.redactSecrets,true);return[{ns:'llm-test',value:{providers:{chat:{...profile,apiKeyEnv:reference,api}}}}];}},credentials:{resolve:async(ref:string)=>{reads.push(ref);return secret?{value:secret}:undefined;}}};
  return{resolver:new HarnessMediaProvider(services as unknown as Context),reads,profile,setSecret:(s:string)=>secret=s,setApi:(s:string)=>api=s,setReference:(s:string)=>reference=s};
}
const config=()=>configSchema.parse({id:'test',name:'Test',personaPrompt:'A',model:{provider:'chat',model:'chat-model'}});
test('analysis inherits native provider URL and live credentials; model override does not duplicate connection settings',async()=>{
  const f=fixture();const first=await f.resolver.resolve(config(),'asr');assert.equal(first.endpoint.baseUrl,f.profile.baseURL);assert.equal(first.endpoint.model,'chat-model');assert.equal(first.apiKey,'stored-key');assert.deepEqual(f.reads,['CHAT_KEY']);
  f.setSecret('rotated-key');const second=await f.resolver.resolve(configSchema.parse({...config(),media:{video:{model:'av-model'}}}),'video');assert.equal(second.apiKey,'rotated-key');assert.equal(second.endpoint.model,'av-model');assert.ok(!JSON.stringify(second.endpoint).includes('rotated-key'));
  f.setSecret('');await assert.rejects(f.resolver.resolve(config(),'asr'),/MEDIA_PROVIDER_KEY_NOT_CONFIGURED/);
});
test('tts resolves the same native provider with the speech protocol and voice override',async()=>{
  const f=fixture();
  const voice=configSchema.parse({...config(),skills:['voice-generation'],tools:['bot_voice'],media:{voice:{enabled:true,protocol:'speech',format:'wav',voice:'alloy'}}});
  const result=await f.resolver.resolve(voice,'tts');
  assert.equal(result.endpoint.protocol,'speech');
  assert.equal(result.endpoint.model,'chat-model');
  assert.equal(result.apiKey,'stored-key');
  assert.ok(!JSON.stringify(result.endpoint).includes('stored-key'));
});
test('invalid analysis model, incompatible provider and disabled skill fail before provider I/O',async()=>{
  const f=fixture();await assert.rejects(f.resolver.resolve(configSchema.parse({...config(),media:{asr:{model:'unknown'}}}),'asr'),/UNKNOWN_MEDIA_MODEL/);assert.equal(f.reads.length,0);
  f.setApi('anthropic-messages');await assert.rejects(f.resolver.resolve(config(),'video'),/MEDIA_REQUIRES_OPENAI_COMPATIBLE_PROVIDER/);
  await assert.rejects(f.resolver.resolve({...config(),skills:[]},'asr'),/MEDIA_ANALYSIS_DISABLED/);
});
test('analysis model stays frozen during turn; permission additions wait and role revocation applies immediately',()=>{
  const c=config();const owner=botSchema.parse({id:'one',name:'One',channel:'qq',enabled:true});const scope={botId:'one',accountId:'one',platform:'qq' as const,kind:'private' as const,channelId:'alice',senderId:'alice'};
  const snapshot=freezeTurn(c,owner,scope,[]);const next=configSchema.parse({...c,media:{asr:{model:'av-model'}}});assert.equal(mediaConfigNow(snapshot,next).media.asr,undefined);
  assert.equal(allowedNow('media_analysis',snapshot,next,owner,scope),true);assert.equal(allowedNow('media_analysis',snapshot,{...next,skills:['image-generation']},owner,scope),false);
  const disabled=configSchema.parse({...next,media:{asr:{enabled:false},video:{enabled:false}}});assert.equal(allowedNow('media_analysis',snapshot,disabled,owner,scope),false);assert.equal(mediaConfigNow(snapshot,disabled).media.asr?.enabled,false);
});
test('media status reports readiness without leaking resolved secrets or provider endpoint',async()=>{
  const f=fixture();const media=new MediaService({} as Store,{} as Assets,undefined,f.resolver);
  const status=await media.analysisStatus(config(),'video');assert.equal(status.keyConfigured,true);assert.equal(status.model,'chat-model');const json=JSON.stringify(status);assert.ok(!json.includes('stored-key'));assert.ok(!json.includes('https://'));
  const disabled=await media.analysisStatus({...config(),skills:[]},'video');assert.equal(disabled.enabled,false);assert.equal(disabled.keyConfigured,false);
});
