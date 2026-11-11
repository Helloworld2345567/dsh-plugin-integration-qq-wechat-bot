import {diagnostic} from '../i18n/diagnostics.js';
import {z} from 'zod';
import {normalizeGptSovitsBaseUrl} from './voice-config.js';
const voicePathSchema=z.string().trim().min(1).max(4096).refine(value=>!/[\x00-\x1f]/.test(value));
/** Private HTTP worker payload; never accepted in persona configuration. */
const singingSeparationSchema=z.object({
  enabled:z.boolean().default(false),
  modelId:z.string().trim().min(1).max(120).refine(value=>['vocals','vocals-aggressive'].includes(value),{message:'当前分离 runner 不支持此模型',params:{message:diagnostic('separationModelUnsupported')}}).optional(),
  modelPath:voicePathSchema.optional(),
  instrumentalMix:z.boolean().optional(),
  volume:z.number().min(0).max(2).default(1),
}).superRefine((value,ctx)=>{
  if(value.enabled){
    if(!value.modelId)ctx.addIssue({code:'custom',path:['modelId'],message:'开启人声分离前请配置分离模型',params:{message:diagnostic('separationModelRequired')}});
    if(!value.modelPath)ctx.addIssue({code:'custom',path:['modelPath'],message:'开启人声分离前请配置分离模型权重路径',params:{message:diagnostic('separationWeightsRequired')}});
  }
}).transform(value=>({...value,instrumentalMix:value.instrumentalMix??(value.enabled?true:false),status:(value.enabled&&value.modelId&&value.modelPath?'configured':'unconfigured') as string}));
export const rvcWorkerConfigSchema=z.object({
  enabled:z.boolean().default(false),
  protocol:z.literal('rvc_http_v1').default('rvc_http_v1'),
  serviceUrl:z.url().max(2048).refine(value=>{try{normalizeGptSovitsBaseUrl(value);return true;}catch{return false;}},{message:'RVC 服务须使用无凭据、查询和片段的 HTTP 或 HTTPS 地址',params:{message:diagnostic('rvcUrlInvalid')}}).transform(normalizeGptSovitsBaseUrl).optional(),
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
  if(value.enabled)for(const field of ['serviceUrl','modelVersion','singingModelId','singingWeightsPath'] as const)if(!value[field])ctx.addIssue({code:'custom',path:[field],message:'开启 STS 前请配置 RVC 服务、模型版本、名称与独立角色权重',params:{message:diagnostic('rvcConfigurationRequired')}});
  if(!value.singingIndexPath&&value.indexRate!==undefined&&value.indexRate!==0)ctx.addIssue({code:'custom',path:['indexRate'],message:'未配置 RVC 索引时，检索比例须为 0',params:{message:diagnostic('rvcIndexRateInvalid')}});
}).transform(value=>({...value,indexRate:value.indexRate??(value.singingIndexPath?0.75:0)}));
