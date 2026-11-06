import {createHash} from 'node:crypto';
import {parseServicePluginManifest,type ServicePluginManifest} from './service-contract.js';

const schema=(properties:Record<string,unknown>={},required:string[]=[])=>({dialect:'https://json-schema.org/draft/2020-12/schema' as const,schema:{type:'object',additionalProperties:false,properties,...required}});
const hash=(id:string)=>createHash('sha256').update(`builtin-service-adapter:${id}:1.0.0`).digest('hex');
const capability=(operation:string,tool:string|undefined,permission:string,parameters:ReturnType<typeof schema>,inputKinds:string[]=[],outputKinds:string[]=['audio'])=>({operation,inputKinds,outputKinds,parameterSchema:parameters,permission,...(tool?{tool}:{}),quotaPolicy:'host.media',concurrencyPolicy:'host.service',deliveryPolicy:'host_decides' as const});
const manifest=(serviceId:string,capabilities:unknown[],protocols:string[]):ServicePluginManifest=>parseServicePluginManifest({manifestVersion:1,serviceId,packageId:`builtin-${serviceId}-adapter`,version:'1.0.0',hostApiRange:'^1.0.0',entry:'builtin',protocols,capabilities,profileSchema:schema(),dependencies:[],credentialRefs:[],artifactSha256:hash(serviceId)});
export const BUILTIN_SERVICE_MANIFESTS=Object.freeze({
  music:manifest('music',[
    capability('music.search','bot_music','music.use',schema({song:{type:'string'},artist:{type:'string'}},['song']),[],[]),
    capability('music.acquire','bot_music','music.use',schema({song:{type:'string'},artist:{type:'string'},selection:{type:'object'},includeLyrics:{type:'boolean'}}),[],['audio','file']),
  ],['musicdl_json_v1@1']),
  voice:manifest('gpt-sovits',[capability('gpt-sovits.speak','bot_voice','voice.use',schema({text:{type:'string'},style:{type:'string'},speed:{type:'number'},format:{const:'wav'}},['text']))],['gpt_sovits@1']),
  breeze:manifest('breeze-tts',[capability('breeze-tts.speak',undefined,'voice.use.breeze',schema({text:{type:'string'},style:{type:'string'},speed:{type:'number'},format:{const:'wav'}},['text']))],['breeze_tts@1']),
  rvc:manifest('rvc',[capability('rvc.convert','bot_sing','rvc.use',schema({sourceType:{enum:['vocals','mixed']},format:{enum:['wav','mp3']}},['sourceType']),['audio','file'])],['rvc_cli_v1@1','rvc_http_v1@1']),
});
export const BUILTIN_SERVICE_POLICIES=new Map([
  ['music.search',{permission:'bot_music',concurrency:'scope' as const,quotaPolicy:'host.media',delivery:'host_decides' as const}],
  ['music.acquire',{permission:'bot_music',concurrency:'scope' as const,quotaPolicy:'host.media',delivery:'host_decides' as const}],
  ['gpt-sovits.speak',{permission:'bot_voice',concurrency:'global' as const,quotaPolicy:'host.media',delivery:'host_decides' as const}],
  ['breeze-tts.speak',{permission:'voice.use.breeze',concurrency:'global' as const,quotaPolicy:'host.media',delivery:'host_decides' as const}],
  ['rvc.convert',{permission:'bot_sing',concurrency:'global' as const,quotaPolicy:'host.media',delivery:'host_decides' as const}],
]);
