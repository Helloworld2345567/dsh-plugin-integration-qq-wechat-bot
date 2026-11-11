import {diagnosticFields} from '../i18n/diagnostics.js';
import {createWriteStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {z} from 'zod';
import {breezeTtsSchema} from './types.js';
import {IsolatedServiceAdapter,assertOutputFile,providerFailure,SERVICE_OPERATION_MAP} from './service-adapter-utils.js';
import {ServiceContractError} from './service-errors.js';
import {VoiceServiceQueue} from './voice-service-queue.js';
import type {CancelResult,HealthResult,ResolvedServiceProfileRevision,ServiceAdapterJob,ServiceProfileRevision,ServiceResult} from './service-contract.js';
import type {ServiceShadowComparator} from './service-shadow.js';

const profileSchema=breezeTtsSchema;
const parametersSchema=z.object({text:z.string().trim().min(1).max(32_000),style:z.string().max(8000).optional(),speed:z.number().min(.25).max(4).optional(),format:z.literal('wav').optional(),mode:z.literal('speak').optional()}).strict();

export interface BreezeTtsHealthPort {check(config:z.infer<typeof profileSchema>,signal:AbortSignal):Promise<boolean>}

export class FetchBreezeTtsHealth implements BreezeTtsHealthPort {
  async check(config:z.infer<typeof profileSchema>,signal:AbortSignal):Promise<boolean>{
    const response=await fetch(`${config.baseUrl}/health`,{signal:AbortSignal.any([signal,AbortSignal.timeout(5000)]),redirect:'error'});
    if(!response.ok)return false;
    const value=await response.json().catch(()=>undefined) as {status?:unknown;sample_rate?:unknown}|undefined;
    return value?.status==='ok'&&value.sample_rate===24000;
  }
}

type ActiveVoice={phase:'waiting'|'submitted';controller:AbortController;settled:Promise<void>};

/** Adapter for the local Breeze-TTS-2.cpp OpenAI-compatible HTTP endpoint. */
export class BreezeTtsServiceAdapter extends IsolatedServiceAdapter {
  private readonly queue=new VoiceServiceQueue();
  private readonly jobs=new Map<string,ActiveVoice>();
  constructor(readonly healthPort:BreezeTtsHealthPort=new FetchBreezeTtsHealth(),shadow?:ServiceShadowComparator){super('breeze-tts',shadow);}
  async listProfiles(_signal:AbortSignal):Promise<readonly ServiceProfileRevision[]>{return[];}
  async health(profile:ResolvedServiceProfileRevision,signal:AbortSignal):Promise<HealthResult>{
    const checkedAt=Date.now();
    try{
      const config=profileSchema.parse(profile.managedConfig),ready=await this.healthPort.check(config,signal);
      return{state:ready?'ready':'unavailable',checkedAt,expiresAt:checkedAt+(ready?30_000:5000),...diagnosticFields(ready?"breezeReachable":"breezeUnreachable")};
    }catch{return{state:'unavailable',checkedAt,expiresAt:checkedAt+5000,...diagnosticFields("breezeHealthFailed")};}
  }
  async execute(job:ServiceAdapterJob,signal:AbortSignal):Promise<ServiceResult>{return this.tracked(job,async()=>{
    const config=profileSchema.parse(job.profile.managedConfig),parameters=parametersSchema.parse(job.parameters);
    if(job.operation!==SERVICE_OPERATION_MAP.breezeSpeak||job.inputs.length)throw new ServiceContractError({category:'INVALID_INPUT',...diagnosticFields("breezeInvalidRequest"),retryable:false,blocksService:false});
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);let settle!:()=>void;const settled=new Promise<void>(resolve=>settle=resolve);const active:ActiveVoice={phase:'waiting',controller,settled};this.jobs.set(job.jobId,active);let release:(()=>void)|undefined;
    try{
      release=await this.queue.acquire(config.baseUrl,combined);combined.throwIfAborted();
      const timeoutMs=Math.max(1000,job.deadline-Date.now());active.phase='submitted';const response=await fetch(`${config.baseUrl}/v1/audio/speech`,{method:'POST',redirect:'error',signal:AbortSignal.any([combined,AbortSignal.timeout(timeoutMs)]),headers:{'content-type':'application/json'},body:JSON.stringify({model:'tts-1',input:parameters.text,voice:config.voice,response_format:'wav',...(parameters.style===undefined?{}:{instructions:parameters.style})})});
      if(!response.ok){await response.arrayBuffer().catch(()=>{});throw Error(`BREEZE_TTS_HTTP_${response.status}`);}
      const contentType=response.headers.get('content-type')??'';if(!/^audio\/wav(?:;|$)/i.test(contentType))throw Error('BREEZE_TTS_OUTPUT_FORMAT_INVALID');
      if(!response.body)throw Error('BREEZE_TTS_OUTPUT_EMPTY');
      const output=path.join(job.outputDirectory,'breeze.wav');await pipeline(Readable.fromWeb(response.body as any),createWriteStream(output),{signal:combined});
      if((await stat(output)).size<=44)throw Error('BREEZE_TTS_OUTPUT_EMPTY');
      return{outputs:[{kind:'audio',handle:assertOutputFile(job,output),name:'breeze.wav'}],observations:{coverage:parameters.speed===undefined?'VOICE_SYNTHESIS':'VOICE_SYNTHESIS_DEGRADED',speedUnsupported:parameters.speed!==undefined}};
    }catch(error){
      if(active.phase==='submitted'&&(combined.aborted||/CANCEL|TIMEOUT|ABORT/i.test(error instanceof Error?error.message:'')))throw new ServiceContractError({category:'UNKNOWN_STATE',providerCode:'BREEZE_TTS_CANCEL_UNKNOWN',...diagnosticFields("breezeStopUnknown"),retryable:false,blocksService:true},error);
      providerFailure(error);
    }finally{release?.();this.jobs.delete(job.jobId);settle();}
  });}
  async cancel(jobId:string):Promise<CancelResult>{const active=this.jobs.get(jobId);if(!active)return{state:'cancelled'};active.controller.abort(Error('BREEZE_TTS_CANCELLED'));if(active.phase==='submitted')return{state:'unknown',blocksService:true};await active.settled;return{state:'cancelled'};}
}
