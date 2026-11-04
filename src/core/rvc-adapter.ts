import {RvcCliServiceAdapter} from './rvc-cli-adapter.js';
import {RvcHttpCompatibilityAdapter} from './rvc-http-adapter.js';
import {ServiceContractError} from './service-errors.js';
import type {CancelResult,HealthResult,ResolvedServiceProfileRevision,ServiceAdapter,ServiceAdapterJob,ServiceProfileRevision,ServiceResult} from './service-contract.js';

type Delegate='cli'|'http';
export class RvcServiceAdapter implements ServiceAdapter {
  readonly serviceId='rvc';private readonly active=new Map<string,Delegate>();
  constructor(readonly cli:RvcCliServiceAdapter,readonly http:RvcHttpCompatibilityAdapter){}
  private delegate(profile:ResolvedServiceProfileRevision):{kind:Delegate;adapter:RvcCliServiceAdapter|RvcHttpCompatibilityAdapter}{const protocol=profile.managedConfig.protocol;return protocol==='rvc_cli_v1'?{kind:'cli',adapter:this.cli}:protocol==='rvc_http_v1'?{kind:'http',adapter:this.http}:(()=>{throw new ServiceContractError({category:'NOT_CONFIGURED',safeDiagnostic:'RVC Profile 未声明受支持的固定协议。',retryable:false,blocksService:false});})();}
  async listProfiles(signal:AbortSignal):Promise<readonly ServiceProfileRevision[]>{signal.throwIfAborted();return[];}
  health(profile:ResolvedServiceProfileRevision,signal:AbortSignal):Promise<HealthResult>{return this.delegate(profile).adapter.health(profile,signal);}
  async execute(job:ServiceAdapterJob,signal:AbortSignal):Promise<ServiceResult>{const selected=this.delegate(job.profile);this.active.set(job.jobId,selected.kind);try{return await selected.adapter.execute(job,signal);}finally{this.active.delete(job.jobId);}}
  cancel(jobId:string,signal?:AbortSignal):Promise<CancelResult>{signal?.throwIfAborted();const selected=this.active.get(jobId);return selected==='http'?this.http.cancel(jobId):selected==='cli'?this.cli.cancel(jobId):Promise.resolve({state:'cancelled'});}
  async dispose():Promise<void>{await Promise.allSettled([this.cli.dispose(),this.http.dispose()]);}
}
