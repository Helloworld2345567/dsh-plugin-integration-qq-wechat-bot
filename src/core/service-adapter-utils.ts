import path from 'node:path';
import {ServiceContractError,serviceFailure,toServiceError} from './service-errors.js';
import type {CancelResult,ServiceAdapterJob,ServiceResult} from './service-contract.js';
import type {ServiceShadowComparator} from './service-shadow.js';
import {compareProducedResult} from './service-shadow.js';

export const SERVICE_OPERATION_MAP=Object.freeze({
  musicSearch:'music.search',musicAcquire:'music.acquire',voiceSpeak:'gpt-sovits.speak',breezeSpeak:'breeze-tts.speak',rvcConvert:'rvc.convert',
  legacyMusicSearch:'music_search',legacyMusicAcquire:'music_acquire',legacyVoiceSpeak:'voice_speak',legacyRvcConvert:'singing_convert',
});
export function assertOutputFile(job:ServiceAdapterJob,file:string):string {
  const root=path.resolve(job.outputDirectory),target=path.resolve(file),relative=path.relative(root,target);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||relative.includes(path.sep))serviceFailure({category:'OUTPUT_INVALID',safeDiagnostic:'服务输出不在宿主管理的任务目录中。',retryable:false,blocksService:false});
  return relative;
}
export function providerFailure(error:unknown,providerCode?:string):never {
  const code=providerCode??(error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:undefined);
  const unknown=code?.includes('STATE_UNKNOWN')===true;
  const cancelled=code?.includes('CANCEL')===true;
  const timeout=code?.includes('TIMEOUT')===true||code==='SERVICE_DEADLINE_EXCEEDED';
  const outputInvalid=code?.includes('OUTPUT')===true||code?.includes('PREVIEW')===true||code?.includes('NOT_FULL')===true;
  const mapped=toServiceError(error,{category:unknown?'UNKNOWN_STATE':cancelled?'CANCELLED':timeout?'TIMEOUT':outputInvalid?'OUTPUT_INVALID':'PROVIDER_ERROR',providerCode:code,retryable:false,blocksService:unknown,safeDiagnostic:unknown?'服务执行状态未知，实例保持封锁。':cancelled?'服务任务已取消。':timeout?'服务任务超过截止时间。':outputInvalid?'服务输出未通过完整性校验。':'服务执行失败。'});throw new ServiceContractError(mapped,error);
}
export abstract class IsolatedServiceAdapter {
  protected readonly active=new Map<string,Promise<void>>();
  constructor(readonly serviceId:string,protected readonly shadow?:ServiceShadowComparator){}
  protected async tracked(job:ServiceAdapterJob,run:()=>Promise<ServiceResult>,fixture?:ServiceResult):Promise<ServiceResult>{
    let settle!:()=>void;const settled=new Promise<void>(resolve=>settle=resolve);this.active.set(job.jobId,settled);
    try{const result=await run();await compareProducedResult(this.shadow,this.serviceId,job.operation,result,fixture);return result;}finally{this.active.delete(job.jobId);settle();}
  }
  protected async waitCancelled(jobId:string):Promise<CancelResult>{const settled=this.active.get(jobId);if(settled)await settled.catch(()=>{});return{state:'cancelled'};}
  async dispose():Promise<void>{await Promise.allSettled([...this.active.values()]);}
}
