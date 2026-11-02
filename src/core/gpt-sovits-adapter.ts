import path from 'node:path';
import {z} from 'zod';
import {ProcessWorker} from '../harness/process-worker.js';
import {MEDIA_WORKER_PROTOCOL,MEDIA_WORKER_PROTOCOL_VERSION,type MediaWorkerJob,type WorkerPort} from './worker-port.js';
import {VoiceServiceQueue} from './voice-service-queue.js';
import {gptSovitsSchema} from './types.js';
import {IsolatedServiceAdapter,assertOutputFile,providerFailure,SERVICE_OPERATION_MAP} from './service-adapter-utils.js';
import {ServiceContractError} from './service-errors.js';
import type {CancelResult,HealthResult,ResolvedServiceProfileRevision,ServiceAdapterJob,ServiceProfileRevision,ServiceResult} from './service-contract.js';
import type {ServiceShadowComparator} from './service-shadow.js';

const profileSchema=gptSovitsSchema.extend({protocol:z.literal('gpt_sovits'),voice:z.string().trim().min(1).max(100),healthPath:z.string().regex(/^\/[A-Za-z0-9/_-]*$/).max(200).optional()}).strict();
const parametersSchema=z.object({text:z.string().trim().min(1).max(32_000),style:z.string().max(8000).optional(),speed:z.number().min(.25).max(4).optional(),format:z.literal('wav').optional(),mode:z.literal('speak').optional()}).strict();
export interface GptSovitsHealthPort {check(config:z.infer<typeof profileSchema>,signal:AbortSignal):Promise<boolean>}
export class FetchGptSovitsHealth implements GptSovitsHealthPort {async check(config:z.infer<typeof profileSchema>,signal:AbortSignal):Promise<boolean>{const response=await fetch(`${config.baseUrl}${config.healthPath??'/'}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),redirect:'error'});return response.ok;}}
type ActiveVoice={phase:'waiting'|'submitted';controller:AbortController;settled:Promise<void>};
export class GptSovitsServiceAdapter extends IsolatedServiceAdapter {
  private readonly queue=new VoiceServiceQueue();private readonly jobs=new Map<string,ActiveVoice>();
  constructor(readonly worker:WorkerPort=new ProcessWorker(),readonly healthPort:GptSovitsHealthPort=new FetchGptSovitsHealth(),shadow?:ServiceShadowComparator){super('gpt-sovits',shadow);}
  async listProfiles(_signal:AbortSignal):Promise<readonly ServiceProfileRevision[]>{return[];}
  async health(profile:ResolvedServiceProfileRevision,signal:AbortSignal):Promise<HealthResult>{const checkedAt=Date.now();try{const config=profileSchema.parse(profile.managedConfig),ready=await this.healthPort.check(config,signal);return{state:ready?'ready':'unavailable',checkedAt,expiresAt:checkedAt+(ready?30_000:5000),safeDiagnostic:ready?'GPT-SoVITS 服务可达；真实合成验收仍需单独记录。':'GPT-SoVITS 服务不可达。'};}catch{return{state:'unavailable',checkedAt,expiresAt:checkedAt+5000,safeDiagnostic:'GPT-SoVITS 服务健康检查失败。'};}}
  async execute(job:ServiceAdapterJob,signal:AbortSignal):Promise<ServiceResult>{return this.tracked(job,async()=>{const config=profileSchema.parse(job.profile.managedConfig),parameters=parametersSchema.parse(job.parameters);if(job.operation!==SERVICE_OPERATION_MAP.voiceSpeak||job.inputs.length)throw new ServiceContractError({category:'INVALID_INPUT',safeDiagnostic:'GPT-SoVITS 请求参数无效。',retryable:false,blocksService:false});
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);let settle!:()=>void;const settled=new Promise<void>(resolve=>settle=resolve);const active:ActiveVoice={phase:'waiting',controller,settled};this.jobs.set(job.jobId,active);let release:(()=>void)|undefined;
    try{release=await this.queue.acquire(config.baseUrl,combined);combined.throwIfAborted();active.phase='submitted';const timeoutMs=Math.max(1000,job.deadline-Date.now()),legacy:MediaWorkerJob={protocol:MEDIA_WORKER_PROTOCOL,protocolVersion:MEDIA_WORKER_PROTOCOL_VERSION,id:job.jobId,scope:job.jobId,operation:SERVICE_OPERATION_MAP.legacyVoiceSpeak,handler:'skill',inputs:[],parameters:{mode:'speak',text:parameters.text,voice:config.voice,format:'wav',...(parameters.style===undefined?{}:{style:parameters.style}),...(parameters.speed===undefined?{}:{speed:parameters.speed})},endpoint:{...config},output:job.outputDirectory,usagePath:path.join(job.outputDirectory,'model-usage.json'),deadline:job.deadline,timeoutMs,quotaUnits:10};const result=await this.worker.run(legacy,combined,{}),assets=result.assets??[];if(assets.length!==1||assets[0].kind!=='audio')throw Error('GPT_SOVITS_OUTPUT_INVALID');return{text:result.text,outputs:[{kind:'audio',handle:assertOutputFile(job,assets[0].path),name:path.basename(assets[0].name)}],observations:{coverage:result.coverage}};
    }catch(error){if(active.phase==='submitted'&&(combined.aborted||/CANCEL|TIMEOUT/i.test(error instanceof Error?error.message:'')))throw new ServiceContractError({category:'UNKNOWN_STATE',providerCode:'GPT_SOVITS_CANCEL_UNKNOWN',safeDiagnostic:'无法确认 GPT-SoVITS 服务端已停止，实例保持封锁。',retryable:false,blocksService:true},error);providerFailure(error);}
    finally{release?.();this.jobs.delete(job.jobId);settle();}
  });}
  async cancel(jobId:string):Promise<CancelResult>{const active=this.jobs.get(jobId);if(!active)return{state:'cancelled'};active.controller.abort(Error('GPT_SOVITS_CANCELLED'));if(active.phase==='submitted')return{state:'unknown',blocksService:true};await active.settled;return{state:'cancelled'};}
}
