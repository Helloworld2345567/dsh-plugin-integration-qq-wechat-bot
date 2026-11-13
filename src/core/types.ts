import {systemDescriptor} from '../i18n/system.js';
import type {SystemLocale} from '../i18n/common.js';
import type {ImageServiceSettings} from './image-service-config.js';
import { z } from 'zod';
import path from 'node:path';
import {edgeTtsVoiceIds,normalizeGptSovitsBaseUrl,normalizeVoiceServiceBaseUrl} from './voice-config.js';
import {serviceProfileRefSchema,type ProfileState,type ServiceProfileRef,type TurnServiceSnapshot} from './service-contract.js';

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const channelIdSchema=idSchema;
export const modelSchema = z.object({ provider: z.string().min(1).max(150), model: z.string().min(1).max(200), reasoningEffort: z.string().optional() });
export const skillNameSchema = z.string().max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
export const endpointSchema = z.object({
  baseUrl: z.url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&(!u.port||u.port==='443');},{message:'媒体 API 必须使用无凭据、查询、片段或非 443 端口的 HTTPS 地址',params:{message:systemDescriptor('mediaApiUrlInvalid')}}), model: z.string().min(1), keyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
});
const imageProtocol=z.enum(['openai','comfyui']);
const imageUrl=z.string().trim().min(1).max(2048).refine(value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash;}catch{return false;}},{message:'图片服务地址无效',params:{message:systemDescriptor('mediaApiUrlInvalid')}});
export const imageEndpointSchema=z.object({protocol:imageProtocol.optional(),baseUrl:imageUrl,model:z.string().min(1).max(256),keyEnv:z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),workflowPath:z.string().trim().min(1).max(4096).refine(value=>path.isAbsolute(value)||path.win32.isAbsolute(value),'workflow path must be absolute').optional()}).strict().superRefine((value,ctx)=>{
  const protocol=value.protocol??'openai',url=new URL(value.baseUrl);
  if(protocol==='openai'&&(url.protocol!=='https:'||url.port&&url.port!=='443'))ctx.addIssue({code:'custom',path:['baseUrl'],message:'OpenAI 图片服务须使用 HTTPS',params:{message:systemDescriptor('mediaApiUrlInvalid')}});
  if(protocol==='comfyui'&&url.protocol==='http:'&&!['localhost','127.0.0.1','::1'].includes(url.hostname.toLowerCase()))ctx.addIssue({code:'custom',path:['baseUrl'],message:'ComfyUI HTTP 服务须使用本机地址',params:{message:systemDescriptor('mediaApiUrlInvalid')}});
  if(protocol==='comfyui'&&value.keyEnv!==undefined)ctx.addIssue({code:'custom',path:['keyEnv'],message:'ComfyUI 不使用 OpenAI API Key'});
  if(protocol!=='comfyui'&&value.workflowPath!==undefined)ctx.addIssue({code:'custom',path:['workflowPath'],message:'工作流设置仅适用于 ComfyUI',params:{message:systemDescriptor('mediaApiUrlInvalid')}});
});
export const imageSkillOverrideSchema=z.object({protocol:imageProtocol.optional(),enabled:z.boolean().default(true)}).strict();
/** Private inference parameters used by service adapters. */
const voicePathSchema=z.string().trim().min(1).max(4096).refine(value=>!/[\x00-\x1f]/.test(value),{message:'服务端路径不能包含控制字符',params:{message:systemDescriptor('servicePathInvalid')}});
export const gptSovitsModelVersions=['v1','v2','v2Pro','v2ProPlus','v3','v4','v5dev','v5turbo'] as const;
export const gptSovitsLanguages=['auto','en','zh','ja','all_zh','all_ja','auto_yue','yue','ko','all_yue','all_ko'] as const;
export const gptSovitsSchema=z.object({
  baseUrl:z.url().max(2048).refine(value=>{try{normalizeGptSovitsBaseUrl(value);return true;}catch{return false;}},{message:'推理服务须使用无凭据、查询和片段的 HTTP 或 HTTPS 地址',params:{message:systemDescriptor('inferenceUrlInvalid')}}).transform(normalizeGptSovitsBaseUrl),
  modelVersion:z.enum(gptSovitsModelVersions),
  gptWeightsPath:voicePathSchema,
  sovitsWeightsPath:voicePathSchema,
  refAudioPath:voicePathSchema,
  promptText:z.string().min(1).max(32000).refine(value=>value.trim().length>0,{message:'请填写参考音频实际说出的文字',params:{message:systemDescriptor('referenceTextRequired')}}).refine(value=>new TextEncoder().encode(value).length<=32*1024,{message:'参考文本不能超过 32 KiB',params:{message:systemDescriptor('referenceTextTooLong')}}),
  promptLang:z.enum(gptSovitsLanguages),
  textLang:z.enum(gptSovitsLanguages),
}).superRefine((value,ctx)=>{
  if(value.modelVersion==='v1')for(const field of ['promptLang','textLang'] as const){
    if(!['auto','en','zh','ja','all_zh','all_ja'].includes(value[field]))ctx.addIssue({code:'custom',path:[field],message:'v1 仅支持中文、英文和日文语言模式',params:{message:systemDescriptor('v1LanguageUnsupported')}});
  }
});
export type GptSovitsConfig=z.infer<typeof gptSovitsSchema>;
const breezeVoiceSchema=z.string().trim().min(1).max(100).refine(value=>/^[a-z0-9][a-z0-9_-]*$/.test(value),{message:'Breeze 音色 ID 无效',params:{message:systemDescriptor('breezeVoiceIdInvalid')}});
export const breezeTtsSchema=z.object({
  protocol:z.literal('breeze_tts'),
  baseUrl:z.url().max(2048).refine(value=>{try{normalizeVoiceServiceBaseUrl(value);return true;}catch{return false;}},{message:'Breeze TTS 服务须使用无凭据、查询和片段的 HTTP 或 HTTPS 地址',params:{message:systemDescriptor('breezeUrlInvalid')}}).transform(normalizeVoiceServiceBaseUrl),
  voice:breezeVoiceSchema,
}).strict();
export type BreezeTtsConfig=z.infer<typeof breezeTtsSchema>;
const edgeTtsVoiceSchema=z.string().trim().min(1).max(100).refine(value=>new TextEncoder().encode(value).length<=128,{message:'Edge TTS 音色名称不能超过 128 字节',params:{message:systemDescriptor('edgeVoiceTooLong')}});
export const edgeTtsVoiceIdSchema=z.enum(edgeTtsVoiceIds);
export type EdgeTtsVoiceId= z.infer<typeof edgeTtsVoiceIdSchema>;
export const edgeTtsSchema=z.object({protocol:z.literal('edge_tts'),voice:edgeTtsVoiceSchema});
export type EdgeTtsConfig=z.infer<typeof edgeTtsSchema>;
export const edgeTtsFallbackSchema=z.object({enabled:z.boolean().default(false),voice:edgeTtsVoiceSchema});
export type EdgeTtsFallbackConfig=z.infer<typeof edgeTtsFallbackSchema>;
const commonConfigFields={
  id:idSchema,name:z.string().trim().min(1).max(100),revision:z.number().int().positive().default(1),
  personaPrompt:z.string().min(1).max(32000),model:modelSchema.nullable().default(null),
  tools:z.array(z.string().max(100)).max(100).default(['bot_media','bot_voice','bot_send_file','bot_remember','bot_forget_memory','bot_read_social']),
  skills:z.array(skillNameSchema).max(100).refine(value=>new Set(value).size===value.length,{message:'技能名称不得重复',params:{message:systemDescriptor('duplicateSkills')}}).default(['image-generation','media-analysis','voice-generation']),
  skillVersions:z.record(skillNameSchema,z.string().regex(/^[a-f0-9]{64}$/)).default({}),
  allowHostTools:z.boolean().default(true),hostTools:z.array(z.string().max(100)).max(100).default([]),
  imageStyle:z.string().max(4000).default(''),
  /** Private-chat heartbeat while a foreground task is still running. */
  progressReply:z.object({enabled:z.boolean().default(true),intervalSeconds:z.number().int().min(10).max(3600).default(60)}).strict().default({enabled:true,intervalSeconds:60}),
  archived:z.boolean().default(false),
};

// Older personas and bot settings stored connection details here. Service
// settings now own them; discard only these retired fields when reading.
const v4ImageSchema=z.preprocess(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  const {baseUrl:_baseUrl,model:_model,keyEnv:_keyEnv,workflowEnv:_workflowEnv,...current}=value as Record<string,unknown>;
  return current;
},imageSkillOverrideSchema);
const v4AnalysisSchema=z.object({enabled:z.boolean().default(true),protocol:z.enum(['chat_completions','transcriptions']).default('chat_completions'),provider:z.never().optional(),model:z.never().optional(),baseUrl:z.never().optional(),keyEnv:z.never().optional()}).strict();
const v4VoiceSchema=z.object({
  enabled:z.boolean().default(false),engine:z.enum(['edge_tts','gpt-sovits','breeze-tts']).optional(),profileRef:serviceProfileRefSchema.optional(),replyMode:z.enum(['on_demand','auto']).default('on_demand'),format:z.enum(['mp3','wav']).default('mp3'),
  // Edge TTS is a built-in provider without an operator endpoint, path or credential.
  protocol:z.literal('edge_tts').optional(),voice:edgeTtsVoiceSchema.optional(),edgeTts:edgeTtsFallbackSchema.optional(),
  gptSovits:z.never().optional(),baseUrl:z.never().optional(),endpoint:z.never().optional(),credentials:z.never().optional(),
}).strict().superRefine((value,ctx)=>{if(value.protocol==='edge_tts'&&value.profileRef)ctx.addIssue({code:'custom',path:['profileRef'],message:'内置 Edge TTS 不使用服务 Profile',params:{message:systemDescriptor('edgeProfileInvalid')}});if(value.protocol==='edge_tts'&&value.engine&&value.engine!=='edge_tts')ctx.addIssue({code:'custom',path:['engine'],message:'Edge TTS 引擎标识不匹配',params:{message:systemDescriptor('edgeEngineMismatch')}});if(value.engine==='edge_tts'&&value.protocol!=='edge_tts')ctx.addIssue({code:'custom',path:['engine'],message:'Edge TTS 需要 edge_tts 协议',params:{message:systemDescriptor('edgeProtocolRequired')}});if(value.engine&&value.engine!=='edge_tts'&&value.profileRef&&value.profileRef.serviceId!==value.engine)ctx.addIssue({code:'custom',path:['engine'],message:'语音引擎与服务 Profile 不匹配',params:{message:systemDescriptor('voiceEngineProfileMismatch')}});if(value.protocol==='edge_tts'&&value.format==='wav')ctx.addIssue({code:'custom',path:['format'],message:'Edge TTS 语音输出仅支持 MP3',params:{message:systemDescriptor('edgeMp3Required')}});});
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
  schemaVersion:z.literal(4).default(4),...commonConfigFields,
  media:z.object({image:v4ImageSchema.optional(),asr:v4AnalysisSchema.optional(),video:v4AnalysisSchema.optional(),voice:v4VoiceSchema.optional(),singing:v4SingingSchema.optional(),music:v4MusicSchema.optional()}).strict().default({}),
}).strict().superRefine((value,ctx)=>{const found=forbiddenV4Path(value);if(found)ctx.addIssue({code:'custom',path:found.split('.'),message:'v4 人格不得保存服务地址、端口、路径、权重、凭据或 locator',params:{message:systemDescriptor('personaPrivateServiceFields')}});});

export type BotConfig=z.infer<typeof v4ConfigSchema>;
export type V4BotConfig=BotConfig;
export const configSchema=v4ConfigSchema;
export const botSettingsSchema=z.object({
  model:commonConfigFields.model,progressReply:commonConfigFields.progressReply,
  media:v4ConfigSchema.shape.media,imageStyle:commonConfigFields.imageStyle,
  tools:commonConfigFields.tools,skills:commonConfigFields.skills,skillVersions:commonConfigFields.skillVersions,
  allowHostTools:commonConfigFields.allowHostTools,hostTools:commonConfigFields.hostTools,
}).strict().superRefine((value,ctx)=>{const found=forbiddenV4Path(value);if(found)ctx.addIssue({code:'custom',path:found.split('.'),message:'机器人运行配置不得保存服务路径、权重或凭据',params:{message:systemDescriptor('botPrivateServiceFields')}});});
export type BotSettings=z.infer<typeof botSettingsSchema>;
export function botSettingsFromConfig(config:BotConfig):BotSettings {
  const {model,progressReply,media,imageStyle,tools,skills,skillVersions,allowHostTools,hostTools}=config;
  return botSettingsSchema.parse({model,progressReply,media,imageStyle,tools,skills,skillVersions,allowHostTools,hostTools});
}
export function configWithBotSettings(config:BotConfig,settings:BotSettings):BotConfig {
  return configSchema.parse({...config,...settings});
}
export const voiceSkillSchema=v4VoiceSchema;
export const singingSkillSchema=v4SingingSchema;
export const musicSkillSchema=v4MusicSchema;
export function configForWrite(input:unknown):BotConfig {return configSchema.parse(input);}

const ttsProfileRefSchema=z.union([
  serviceProfileRefSchema.extend({serviceId:z.literal('gpt-sovits')}),
  serviceProfileRefSchema.extend({serviceId:z.literal('breeze-tts')}),
]);
export const ttsOverrideSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('edge'),voice:edgeTtsVoiceIdSchema}).strict(),
  z.object({kind:z.literal('profile'),profileRef:ttsProfileRefSchema}).strict(),
]);
export type TtsOverride=z.infer<typeof ttsOverrideSchema>;
export const stsOverrideSchema=z.object({profileRef:serviceProfileRefSchema.extend({serviceId:z.literal('rvc')})}).strict();
export type StsOverride=z.infer<typeof stsOverrideSchema>;
/** Persona projections contain only V4 configuration. */
export function publicPersonaConfig(config:BotConfig):BotConfig {return configSchema.parse(structuredClone(config));}
/** Parse persona config.json together with persona.md without weakening either schema. */
export function parsePersonaSettings(input:unknown,personaPrompt:string):BotConfig {return configSchema.parse({...input as Record<string,unknown>,personaPrompt}) as BotConfig;}

export const botSchema = z.object({
  id: idSchema, name: z.string().trim().min(1).max(100), channel: channelIdSchema,
  accountId: z.string().max(200).default(''), configId: idSchema.default('default'),
  enabled: z.boolean().default(false), archived: z.boolean().default(false),
  trustedUsers: z.array(z.string().min(1).max(200)).max(200).default([]),
  workingDirectory:z.string().trim().max(32767).refine(value=>!value||path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value),{message:'工作目录须为绝对路径',params:{message:systemDescriptor('workspaceAbsoluteRequired')}}).transform(value=>value||undefined).optional(),
  settings:botSettingsSchema.optional(),
});
export type BotInstance = z.infer<typeof botSchema>;
export interface CallerScope { botId: string; platform: string; accountId: string; kind: 'private' | 'group'; channelId: string; senderId: string }
export interface MediaInput {kind:'image'|'audio'|'video'|'file';name:string;mime:string;url?:string;bytes?:string;handle?:string;transcript?:string;remote?:{query?:string;key?:string;fullUrl?:string}}
export interface ChannelReplyEnvelope { channelId:string; version:number; payload:Record<string,string> }
export interface InboundMessage {id:string;scope:CallerScope;text:string;attachments:MediaInput[];quoted?:{id?:string;text?:string;attachments?:MediaInput[]};reply:Record<string,string>;replyEnvelope?:ChannelReplyEnvelope;timestamp:number}
export interface SessionBinding { key:string;scope:CallerScope;sessionId:string;generation:number;persisted:boolean;personaId?:string;modelOverride?:z.infer<typeof modelSchema>;ttsOverride?:TtsOverride;stsOverride?:StsOverride;recentSince?:number }
export interface SessionRecord { id:string;scopeKey:string;scope:CallerScope;generation:number;persisted:boolean;createdAt:number;updatedAt:number;personaId?:string;modelOverride?:z.infer<typeof modelSchema>;ttsOverride?:TtsOverride;stsOverride?:StsOverride;recentSince?:number }
export type ServiceProfileRole='voice'|'singing'|'music';
export type TurnServiceState=ProfileState|'disabled';
export interface TurnServiceSelection {role:ServiceProfileRole;enabled:boolean;profileRef?:ServiceProfileRef;state:TurnServiceState;snapshot?:TurnServiceSnapshot}
export interface TurnSnapshot {systemLocale?:SystemLocale;config:Readonly<BotConfig>;imageServiceSettings?:Readonly<ImageServiceSettings>;personaId:string;personaRevision:number;services:Readonly<Partial<Record<ServiceProfileRole,Readonly<TurnServiceSelection>>>>;botId:string;trusted:boolean;sourceIds:string[];startedAt:number}
export interface Asset { id:string;scopeKey:string;name:string;mime:string;path:string;size:number;kind:MediaInput['kind'];createdAt:number;jobId?:string;sessionId?:string;workspace?:string;origin?:'received'|'generated'|'sent' }
export type DeliveryAttemptPhase='prepare'|'upload'|'commit';
export interface DeliveryAttempt {number:number;phase:DeliveryAttemptPhase;assetId?:string;fileKey?:string;uploadQuery?:string;aesKey?:string;encryptedSize?:number;fileInfo?:string;fileInfoExpiresAt?:number;startedAt?:number;lastError?:string;causeCode?:string;causeMessage?:string;httpStatus?:number;platformCode?:string;platformMessage?:string;platformTraceId?:string;autoRetryCount?:number}
export interface Output {type:'text'|'asset';text?:string;assetId?:string;resend?:boolean;asFile?:boolean}
export interface Delivery {purpose?:'result'|'progress';progress?:{runId:string;generation:number;expiresAt:number};replySequence?:number;id:string;scopeKey:string;botId:string;sessionId:string;sessionGeneration?:number;sourceId:string;turnId:string;index:number;output:Output;reply:Record<string,string>;replyEnvelope?:ChannelReplyEnvelope;state:'pending'|'sending'|'sent'|'unknown'|'failed'|'cancelled';receipt?:string;error?:string;attempt?:DeliveryAttempt;createdAt?:number;updatedAt?:number;sentAt?:number}
export interface TurnMetric {id:string;scopeKey:string;sourceId:string;sessionId?:string;turnId?:string;receivedAt:number;queuedAt?:number;attachmentsStartedAt?:number;attachmentsCompletedAt?:number;modelStartedAt?:number;modelFirstFeedbackAt?:number;modelCompletedAt?:number;deliveryStartedAt?:number;sentAt?:number;state?:'received'|'processing'|'complete'|'failed'|'cancelled'}
export interface Credential { accountId:string;token?:string;appSecret?:string;baseUrl?:string }
export interface LoginState { status:'pending'|'confirmed'|'expired'|'denied';qr?:string;ticket?:string;credential?:Credential }
export interface ChannelOutboundContext {binding:SessionBinding;outputs:Output[];signal:AbortSignal;authorize:()=>void}
export interface ChannelAdapter {beginLogin(signal?:AbortSignal):Promise<LoginState>;pollLogin(ticket:string,signal?:AbortSignal):Promise<LoginState>;connect(bot:BotInstance,credential:Credential,receive:(message:InboundMessage)=>Promise<void>,signal:AbortSignal,status:(state:string)=>void):Promise<void>;materialize(input:MediaInput,signal:AbortSignal):Promise<Buffer>;prepareOutbound?(context:ChannelOutboundContext):Promise<Output[]>;send(bot:BotInstance,credential:Credential,delivery:Delivery,asset:Asset|undefined,signal:AbortSignal):Promise<string>}
