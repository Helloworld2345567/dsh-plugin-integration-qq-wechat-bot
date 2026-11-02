import { z } from 'zod';
import path from 'node:path';
import {normalizeGptSovitsBaseUrl} from './voice-config.js';
import {serviceProfileRefSchema,type ProfileState,type ServiceProfileRef,type TurnServiceSnapshot} from './service-contract.js';

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const channelIdSchema=idSchema;
export const modelSchema = z.object({ provider: z.string().min(1).max(150), model: z.string().min(1).max(200), reasoningEffort: z.string().optional() });
export const skillNameSchema = z.string().max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
export const endpointSchema = z.object({
  baseUrl: z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&(!u.port||u.port==='443');},'媒体 API 必须使用无凭据、查询、片段或非 443 端口的 HTTPS 地址'), model: z.string().min(1), keyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
});
export const imageSkillOverrideSchema=endpointSchema.pick({baseUrl:true,model:true,keyEnv:true}).partial().extend({enabled:z.boolean().default(true)});
export const analysisSkillSchema=z.object({enabled:z.boolean().default(true),provider:z.string().min(1).max(150).optional(),model:z.string().min(1).max(200).optional(),protocol:z.enum(['chat_completions','transcriptions']).default('chat_completions')});
/** v3-only service fields remain readable during the rollback window. */
const voicePathSchema=z.string().trim().min(1).max(4096).refine(value=>!/[\x00-\x1f]/.test(value),'服务端路径不能包含控制字符');
export const gptSovitsModelVersions=['v1','v2','v2Pro','v2ProPlus','v3','v4','v5dev','v5turbo'] as const;
export const gptSovitsLanguages=['auto','en','zh','ja','all_zh','all_ja','auto_yue','yue','ko','all_yue','all_ko'] as const;
export const gptSovitsSchema=z.object({
  baseUrl:z.url().max(2048).refine(value=>{try{normalizeGptSovitsBaseUrl(value);return true;}catch{return false;}},'推理服务须使用无凭据、查询和片段的 HTTP 或 HTTPS 地址').transform(normalizeGptSovitsBaseUrl),
  modelVersion:z.enum(gptSovitsModelVersions),
  gptWeightsPath:voicePathSchema,
  sovitsWeightsPath:voicePathSchema,
  refAudioPath:voicePathSchema,
  promptText:z.string().min(1).max(32000).refine(value=>value.trim().length>0,'请填写参考音频实际说出的文字').refine(value=>new TextEncoder().encode(value).length<=32*1024,'参考文本不能超过 32 KiB'),
  promptLang:z.enum(gptSovitsLanguages),
  textLang:z.enum(gptSovitsLanguages),
}).superRefine((value,ctx)=>{
  if(value.modelVersion==='v1')for(const field of ['promptLang','textLang'] as const){
    if(!['auto','en','zh','ja','all_zh','all_ja'].includes(value[field]))ctx.addIssue({code:'custom',path:[field],message:'v1 仅支持中文、英文和日文语言模式'});
  }
});
export type GptSovitsConfig=z.infer<typeof gptSovitsSchema>;
const edgeTtsVoiceSchema=z.string().trim().min(1).max(100).refine(value=>new TextEncoder().encode(value).length<=128,'Edge TTS 音色名称不能超过 128 字节');
export const edgeTtsSchema=z.object({protocol:z.literal('edge_tts'),voice:edgeTtsVoiceSchema});
export type EdgeTtsConfig=z.infer<typeof edgeTtsSchema>;
export const edgeTtsFallbackSchema=z.object({enabled:z.boolean().default(false),voice:edgeTtsVoiceSchema});
export type EdgeTtsFallbackConfig=z.infer<typeof edgeTtsFallbackSchema>;
export const voiceSkillSchema=z.preprocess(input=>{
  if(input&&typeof input==='object'&&!Array.isArray(input)&&(input as any).protocol==='speech')return{...(input as Record<string,unknown>),protocol:'edge_tts',provider:undefined,model:undefined,format:'mp3'};
  return input;
},z.object({
  enabled:z.boolean().default(false),
  protocol:z.enum(['edge_tts','gpt_sovits']).default('edge_tts'),
  replyMode:z.enum(['on_demand','auto']).default('on_demand'),
  voice:edgeTtsVoiceSchema.optional(),
  edgeTts:edgeTtsFallbackSchema.optional(),
  format:z.enum(['mp3','wav']).optional(),
  gptSovits:gptSovitsSchema.optional(),
}).superRefine((value,ctx)=>{
  if(value.enabled&&value.protocol==='gpt_sovits'){
    if(!value.gptSovits)ctx.addIssue({code:'custom',path:['gptSovits'],message:'请配置 GPT-SoVITS 服务、模型与参考音频'});
    if(value.format==='mp3')ctx.addIssue({code:'custom',path:['format'],message:'GPT-SoVITS 语音输出仅支持 WAV'});
  }
  if(value.enabled&&value.protocol==='edge_tts'&&value.format==='wav')ctx.addIssue({code:'custom',path:['format'],message:'Edge TTS 语音输出仅支持 MP3'});
}).transform(value=>({...value,format:value.format??(value.protocol==='gpt_sovits'?'wav' as const:'mp3' as const)})));
const singingSeparationSchema=z.preprocess(input=>{
  if(input&&typeof input==='object'&&!Array.isArray(input)){
    const value=input as Record<string,unknown>;
    if(!Object.hasOwn(value,'enabled')&&value.status==='unconfigured')return {...value,status:undefined,enabled:false};
    if(!Object.hasOwn(value,'enabled')&&value.status==='configured')return {...value,status:undefined,enabled:true};
  }
  return input;
},z.object({
  enabled:z.boolean().default(false),
  modelId:z.string().trim().min(1).max(120).refine(value=>['vocals','vocals-aggressive'].includes(value),'当前分离 runner 不支持此模型').optional(),
  modelPath:voicePathSchema.optional(),
  instrumentalMix:z.boolean().optional(),
  volume:z.number().min(0).max(2).default(1),
}).superRefine((value,ctx)=>{
  if(value.enabled){
    if(!value.modelId)ctx.addIssue({code:'custom',path:['modelId'],message:'开启人声分离前请配置分离模型'});
    if(!value.modelPath)ctx.addIssue({code:'custom',path:['modelPath'],message:'开启人声分离前请配置分离模型权重路径'});
  }
}).transform(value=>({...value,instrumentalMix:value.instrumentalMix??(value.enabled?true:false),status:(value.enabled&&value.modelId&&value.modelPath?'configured':'unconfigured') as string})));
export type SingingSeparationConfig=z.infer<typeof singingSeparationSchema>;
export const singingSkillSchema=z.object({
  enabled:z.boolean().default(false),
  protocol:z.literal('rvc_http_v1').default('rvc_http_v1'),
  serviceUrl:z.url().max(2048).refine(value=>{try{normalizeGptSovitsBaseUrl(value);return true;}catch{return false;}},'RVC 服务须使用无凭据、查询和片段的 HTTP 或 HTTPS 地址').transform(normalizeGptSovitsBaseUrl).optional(),
  modelVersion:z.enum(['v1','v2']).optional(),
  singingModelId:z.string().trim().min(1).max(100).optional(),
  singingWeightsPath:voicePathSchema.optional(),
  singingIndexPath:voicePathSchema.optional(),
  speakerId:z.number().int().min(0).max(65535).default(0),
  pitchShift:z.number().int().min(-24).max(24).default(0),
  indexRate:z.number().min(0).max(1).optional(),
  defaultOutput:z.enum(['mp3','wav']).default('mp3'),
  separation:singingSeparationSchema.default({enabled:false,instrumentalMix:false,volume:1,status:'unconfigured'}),
}).superRefine((value,ctx)=>{
  if(value.enabled)for(const field of ['serviceUrl','modelVersion','singingModelId','singingWeightsPath'] as const)if(!value[field])ctx.addIssue({code:'custom',path:[field],message:'开启 STS 前请配置 RVC 服务、模型版本、名称与独立角色权重'});
  if(!value.singingIndexPath&&value.indexRate!==undefined&&value.indexRate!==0)ctx.addIssue({code:'custom',path:['indexRate'],message:'未配置 RVC 索引时，检索比例须为 0'});
}).transform(value=>({...value,indexRate:value.indexRate??(value.singingIndexPath?0.75:0)}));
export type SingingConfig=z.infer<typeof singingSkillSchema>;
export const musicSkillSchema=z.object({enabled:z.boolean().default(false),includeLyrics:z.boolean().default(false)});
export type MusicConfig=z.infer<typeof musicSkillSchema>;

const commonConfigFields={
  id:idSchema,name:z.string().trim().min(1).max(100),revision:z.number().int().positive().default(1),
  personaPrompt:z.string().min(1).max(32000),model:modelSchema.nullable().default(null),
  tools:z.array(z.string().max(100)).max(100).default(['bot_media','bot_voice','bot_send_file','bot_remember','bot_forget_memory','bot_read_social']),
  skills:z.array(skillNameSchema).max(100).refine(value=>new Set(value).size===value.length,'技能名称不得重复').default(['image-generation','media-analysis','voice-generation']),
  skillVersions:z.record(skillNameSchema,z.string().regex(/^[a-f0-9]{64}$/)).default({}),
  allowHostTools:z.boolean().default(true),hostTools:z.array(z.string().max(100)).max(100).default([]),
  imageStyle:z.string().max(4000).default(''),archived:z.boolean().default(false),
};

export const legacyConfigSchema=z.object({
  schemaVersion:z.literal(3).default(3),...commonConfigFields,
  media:z.object({image:imageSkillOverrideSchema.optional(),asr:analysisSkillSchema.optional(),video:analysisSkillSchema.optional(),voice:voiceSkillSchema.optional(),singing:singingSkillSchema.optional(),music:musicSkillSchema.optional()}).default({}),
});

const v4ImageSchema=z.object({enabled:z.boolean().default(true),baseUrl:z.never().optional(),model:z.never().optional(),keyEnv:z.never().optional()}).strict();
const v4AnalysisSchema=z.object({enabled:z.boolean().default(true),protocol:z.enum(['chat_completions','transcriptions']).default('chat_completions'),provider:z.never().optional(),model:z.never().optional(),baseUrl:z.never().optional(),keyEnv:z.never().optional()}).strict();
const v4VoiceSchema=z.object({
  enabled:z.boolean().default(false),profileRef:serviceProfileRefSchema.optional(),replyMode:z.enum(['on_demand','auto']).default('on_demand'),format:z.enum(['mp3','wav']).default('mp3'),
  // Edge TTS is a built-in provider without an operator endpoint, path or credential.
  protocol:z.literal('edge_tts').optional(),voice:edgeTtsVoiceSchema.optional(),edgeTts:edgeTtsFallbackSchema.optional(),
  gptSovits:z.never().optional(),baseUrl:z.never().optional(),endpoint:z.never().optional(),credentials:z.never().optional(),
}).strict().superRefine((value,ctx)=>{if(value.protocol==='edge_tts'&&value.profileRef)ctx.addIssue({code:'custom',path:['profileRef'],message:'内置 Edge TTS 不使用服务 Profile'});if(value.protocol==='edge_tts'&&value.format==='wav')ctx.addIssue({code:'custom',path:['format'],message:'Edge TTS 语音输出仅支持 MP3'});});
const v4SingingSeparationSchema=z.object({
  enabled:z.boolean().default(false),instrumentalMix:z.boolean().default(false),volume:z.number().min(0).max(2).default(1),status:z.literal('unconfigured').default('unconfigured'),
  modelId:z.never().optional(),modelPath:z.never().optional(),weightsPath:z.never().optional(),
}).strict();
const v4SingingSchema=z.object({
  enabled:z.boolean().default(false),profileRef:serviceProfileRefSchema.optional(),speakerId:z.number().int().min(0).max(65535).default(0),pitchShift:z.number().int().min(-24).max(24).default(0),indexRate:z.number().min(0).max(1).default(0),defaultOutput:z.enum(['mp3','wav']).default('mp3'),separation:v4SingingSeparationSchema.default({enabled:false,instrumentalMix:false,volume:1,status:'unconfigured'}),
  protocol:z.never().optional(),serviceUrl:z.never().optional(),modelVersion:z.never().optional(),singingModelId:z.never().optional(),singingWeightsPath:z.never().optional(),singingIndexPath:z.never().optional(),endpoint:z.never().optional(),credentials:z.never().optional(),
}).strict();
const v4MusicSchema=z.object({enabled:z.boolean().default(false),profileRef:serviceProfileRefSchema.optional(),includeLyrics:z.boolean().default(false),home:z.never().optional(),sources:z.never().optional(),endpoint:z.never().optional(),credentials:z.never().optional(),locator:z.never().optional()}).strict();

const forbiddenV4Key=/^(?:endpoint|port|baseurl|url|home|root|path|.*path|.*weights?|credentials?|credentialref|locator|token|secret|apikey|keyenv)$/i;
function forbiddenV4Path(value:unknown,segments:string[]=[]):string|undefined {
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){for(let index=0;index<value.length;index++){const found=forbiddenV4Path(value[index],[...segments,String(index)]);if(found)return found;}return;}
  for(const [key,child] of Object.entries(value as Record<string,unknown>)){
    if(forbiddenV4Key.test(key))return[...segments,key].join('.');
    const found=forbiddenV4Path(child,[...segments,key]);if(found)return found;
  }
}
export const v4ConfigSchema=z.object({
  schemaVersion:z.literal(4),...commonConfigFields,
  media:z.object({image:v4ImageSchema.optional(),asr:v4AnalysisSchema.optional(),video:v4AnalysisSchema.optional(),voice:v4VoiceSchema.optional(),singing:v4SingingSchema.optional(),music:v4MusicSchema.optional()}).strict().default({}),
}).strict().superRefine((value,ctx)=>{const found=forbiddenV4Path(value);if(found)ctx.addIssue({code:'custom',path:found.split('.'),message:'v4 人格不得保存服务地址、端口、路径、权重、凭据或 locator'});});

const configUnion=z.discriminatedUnion('schemaVersion',[legacyConfigSchema,v4ConfigSchema]);
const parsedConfigSchema=z.preprocess(input=>input&&typeof input==='object'&&!Array.isArray(input)&&!Object.hasOwn(input,'schemaVersion')?{...(input as Record<string,unknown>),schemaVersion:3}:input,configUnion);
export type LegacyBotConfig=z.infer<typeof legacyConfigSchema>;
export type V4BotConfig=z.infer<typeof v4ConfigSchema>;
type CommonBotConfig=Omit<LegacyBotConfig,'schemaVersion'|'media'>;
interface TransitionalVoiceConfig {enabled:boolean;profileRef?:ServiceProfileRef;protocol?:'edge_tts'|'gpt_sovits';replyMode:'on_demand'|'auto';voice?:string;edgeTts?:EdgeTtsFallbackConfig;format:'mp3'|'wav';gptSovits?:GptSovitsConfig}
interface TransitionalSeparationConfig {enabled:boolean;modelId?:string;modelPath?:string;instrumentalMix:boolean;volume:number;status:string}
interface TransitionalSingingConfig {enabled:boolean;profileRef?:ServiceProfileRef;protocol?:'rvc_http_v1';serviceUrl?:string;modelVersion?:'v1'|'v2';singingModelId?:string;singingWeightsPath?:string;singingIndexPath?:string;speakerId:number;pitchShift:number;indexRate:number;defaultOutput:'mp3'|'wav';separation:TransitionalSeparationConfig}
/** Structural view used by the existing runtime while strict schemas coexist. */
export type BotConfig=CommonBotConfig&{schemaVersion:3|4;media:{
  image?:{enabled:boolean;baseUrl?:string;model?:string;keyEnv?:string};
  asr?:{enabled:boolean;provider?:string;model?:string;protocol:'chat_completions'|'transcriptions'};
  video?:{enabled:boolean;provider?:string;model?:string;protocol:'chat_completions'|'transcriptions'};
  voice?:TransitionalVoiceConfig;
  singing?:TransitionalSingingConfig;
  music?:{enabled:boolean;profileRef?:ServiceProfileRef;includeLyrics:boolean};
}};

export const configSchema: z.ZodType<BotConfig>=parsedConfigSchema as z.ZodType<BotConfig>;
export function isV4Config(config:BotConfig):config is V4BotConfig{return config.schemaVersion===4;}
/** Every mutation crosses this boundary; v3 service details are deliberately not copied. */
export function configForWrite(input:unknown):V4BotConfig {
  const parsed=configSchema.parse(input) as BotConfig;if(parsed.schemaVersion===4)return v4ConfigSchema.parse(parsed);
  const voice=parsed.media.voice,singing=parsed.media.singing,music=parsed.media.music;
  return v4ConfigSchema.parse({...parsed,schemaVersion:4,media:{
    ...(parsed.media.image?{image:{enabled:parsed.media.image.enabled}}:{}),
    ...(parsed.media.asr?{asr:{enabled:parsed.media.asr.enabled,protocol:parsed.media.asr.protocol}}:{}),
    ...(parsed.media.video?{video:{enabled:parsed.media.video.enabled,protocol:parsed.media.video.protocol}}:{}),
    ...(voice?{voice:voice.protocol==='edge_tts'?{enabled:voice.enabled,protocol:'edge_tts' as const,replyMode:voice.replyMode,voice:voice.voice,edgeTts:voice.edgeTts,format:voice.format}:{enabled:voice.enabled,replyMode:voice.replyMode,format:voice.format}}:{}),
    ...(singing?{singing:{enabled:singing.enabled,speakerId:singing.speakerId,pitchShift:singing.pitchShift,indexRate:singing.indexRate,defaultOutput:singing.defaultOutput,separation:{enabled:singing.separation.enabled,instrumentalMix:singing.separation.instrumentalMix,volume:singing.separation.volume,status:'unconfigured'}}}:{}),
    ...(music?{music:{enabled:music.enabled,includeLyrics:music.includeLyrics}}:{}),
  }});
}
/** Management and model-facing projections never expose v3 private service fields. */
export function publicPersonaConfig(config:BotConfig):V4BotConfig {return config.schemaVersion===4?v4ConfigSchema.parse(structuredClone(config)):configForWrite(config);}
/** Parse persona config.json together with persona.md without weakening either schema. */
export function parsePersonaSettings(input:unknown,personaPrompt:string):BotConfig {return configSchema.parse({...input as Record<string,unknown>,personaPrompt}) as BotConfig;}

export const botSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(100), channel: channelIdSchema,
  accountId: z.string().max(200).default(''), configId: idSchema.default('default'),
  enabled: z.boolean().default(false), archived: z.boolean().default(false),
  trustedUsers: z.array(z.string().min(1).max(200)).max(200).default([]),
  workingDirectory:z.string().trim().max(32767).refine(value=>!value||path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value),'工作目录须为绝对路径').transform(value=>value||undefined).optional(),
});
export type BotInstance = z.infer<typeof botSchema>;
export interface CallerScope { botId: string; platform: string; accountId: string; kind: 'private' | 'group'; channelId: string; senderId: string }
export interface MediaInput {kind:'image'|'audio'|'video'|'file';name:string;mime:string;url?:string;bytes?:string;handle?:string;transcript?:string;remote?:{query?:string;key?:string;fullUrl?:string}}
export interface ChannelReplyEnvelope { channelId:string; version:number; payload:Record<string,string> }
export interface InboundMessage {id:string;scope:CallerScope;text:string;attachments:MediaInput[];quoted?:{id?:string;text?:string;attachments?:MediaInput[]};reply:Record<string,string>;replyEnvelope?:ChannelReplyEnvelope;timestamp:number}
export interface SessionBinding { key:string;scope:CallerScope;sessionId:string;generation:number;persisted:boolean;personaId?:string;modelOverride?:z.infer<typeof modelSchema>;recentSince?:number }
export interface SessionRecord { id:string;scopeKey:string;scope:CallerScope;generation:number;persisted:boolean;createdAt:number;updatedAt:number;personaId?:string;modelOverride?:z.infer<typeof modelSchema>;recentSince?:number }
export type ServiceProfileRole='voice'|'singing'|'music';
export type TurnServiceState=ProfileState|'disabled';
export interface TurnServiceSelection {role:ServiceProfileRole;enabled:boolean;profileRef?:ServiceProfileRef;state:TurnServiceState;snapshot?:TurnServiceSnapshot}
export interface TurnSnapshot {config:Readonly<BotConfig>;personaId:string;personaRevision:number;services:Readonly<Partial<Record<ServiceProfileRole,Readonly<TurnServiceSelection>>>>;botId:string;trusted:boolean;sourceIds:string[];startedAt:number}
export interface DeliveryTurnContext {personaId:string;personaRevision:number;trusted:boolean;serviceSnapshots:readonly TurnServiceSnapshot[]}
export interface Asset { id:string;scopeKey:string;name:string;mime:string;path:string;size:number;kind:MediaInput['kind'];createdAt:number;jobId?:string;sessionId?:string;workspace?:string;origin?:'received'|'generated'|'sent';serviceSnapshot?:TurnServiceSnapshot }
export type DeliveryAttemptPhase='prepare'|'upload'|'commit';
export interface DeliveryAttempt {number:number;phase:DeliveryAttemptPhase;assetId?:string;fileKey?:string;uploadQuery?:string;aesKey?:string;encryptedSize?:number;fileInfo?:string;fileInfoExpiresAt?:number;startedAt?:number;lastError?:string;causeCode?:string;causeMessage?:string;httpStatus?:number;platformCode?:string;platformMessage?:string;platformTraceId?:string;autoRetryCount?:number}
export interface Output {type:'text'|'asset';text?:string;assetId?:string;resend?:boolean;asFile?:boolean}
export interface Delivery {purpose?:'result'|'progress';progress?:{runId:string;generation:number;expiresAt:number};replySequence?:number;id:string;scopeKey:string;botId:string;sessionId:string;sessionGeneration?:number;sourceId:string;turnId:string;index:number;output:Output;reply:Record<string,string>;replyEnvelope?:ChannelReplyEnvelope;turnContext?:DeliveryTurnContext;state:'pending'|'sending'|'sent'|'unknown'|'failed'|'cancelled';receipt?:string;error?:string;attempt?:DeliveryAttempt;createdAt?:number;updatedAt?:number;sentAt?:number}
export interface TurnMetric {id:string;scopeKey:string;sourceId:string;sessionId?:string;turnId?:string;receivedAt:number;queuedAt?:number;attachmentsStartedAt?:number;attachmentsCompletedAt?:number;modelStartedAt?:number;modelFirstFeedbackAt?:number;modelCompletedAt?:number;deliveryStartedAt?:number;sentAt?:number;state?:'received'|'processing'|'complete'|'failed'|'cancelled'}
export interface Credential { accountId:string;token?:string;appSecret?:string;baseUrl?:string }
export interface LoginState { status:'pending'|'confirmed'|'expired'|'denied';qr?:string;ticket?:string;credential?:Credential }
export interface ChannelOutboundContext {binding:SessionBinding;outputs:Output[];signal:AbortSignal;authorize:()=>void}
export interface ChannelAdapter {beginLogin(signal?:AbortSignal):Promise<LoginState>;pollLogin(ticket:string,signal?:AbortSignal):Promise<LoginState>;connect(bot:BotInstance,credential:Credential,receive:(message:InboundMessage)=>Promise<void>,signal:AbortSignal,status:(state:string)=>void):Promise<void>;materialize(input:MediaInput,signal:AbortSignal):Promise<Buffer>;prepareOutbound?(context:ChannelOutboundContext):Promise<Output[]>;send(bot:BotInstance,credential:Credential,delivery:Delivery,asset:Asset|undefined,signal:AbortSignal):Promise<string>}
