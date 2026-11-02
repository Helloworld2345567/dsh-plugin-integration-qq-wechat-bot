import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {CapabilityRegistry} from './capability-registry.js';
import type {MediaOperationRegistry} from './media-operation-registry.js';
import {OutputValidatorRegistry,type ValidatedOutput} from './output-validator.js';
import type {ProfileStore} from './profile-store.js';
import {cancelResultSchema,serviceJobSchema,serviceResultSchema,type CancelResult,type ServiceJob,type ServiceProfileRef} from './service-contract.js';
import {toServiceError,ServiceContractError} from './service-errors.js';
import type {ServicePluginHost} from './service-plugin-host.js';
import {InMemoryServiceStateRepository,type ServiceJobRecord,type ServiceStateRepository} from './service-state-store.js';

export interface ApprovedServicePolicy {permission:string;concurrency:'parallel'|'global'|'scope'|number;quotaPolicy:string;delivery:'never'|'host_decides'}
export interface ServiceExecutionRequest {operation:string;profile:ServiceProfileRef;profileRevision:number;profileContentHash:string;inputHandles:readonly string[];parameters:Record<string,unknown>;outputDirectory:string;idempotencyKey:string;deadline:number;scopeKey?:string;signal:AbortSignal}
export interface ServiceExecutionResult {text?:string;outputs:readonly ValidatedOutput[];observations?:unknown}
type ActiveJob={serviceId:string;controller:AbortController;settled:Promise<void>};

/** Host-owned bridge from the immutable plugin catalog into runtime policy and output validation. */
export class ServiceRuntime {
  private accepting=true;
  private readonly active=new Map<string,ActiveJob>();
  constructor(readonly host:ServicePluginHost,readonly profiles:ProfileStore,readonly validators:OutputValidatorRegistry,readonly policies:ReadonlyMap<string,ApprovedServicePolicy>,readonly state:ServiceStateRepository=new InMemoryServiceStateRepository()){
    for(const entry of host.catalog.list())for(const descriptor of entry.capabilities)if(!policies.has(descriptor.operation))throw new Error(`SERVICE_OPERATION_POLICY_MISSING: ${descriptor.operation}`);
  }
  registerCapabilities(registry:CapabilityRegistry):readonly (()=>void)[]{
    const disposers:(()=>void)[]=[];
    for(const entry of this.host.catalog.list())for(const descriptor of entry.capabilities){const policy=this.policies.get(descriptor.operation)!;disposers.push(registry.register({name:descriptor.operation,operation:descriptor.operation,permission:policy.permission,schema:descriptor.parameterSchema.schema,concurrency:policy.concurrency,execute:(arguments_:unknown,context)=>this.execute({...arguments_ as Omit<ServiceExecutionRequest,'operation'|'signal'>,operation:descriptor.operation,signal:context.signal})}));}
    return disposers;
  }
  assertApprovedMediaOperations(registry:MediaOperationRegistry):void {for(const entry of this.host.catalog.list())for(const capability of entry.capabilities)if(registry.hasServiceOperation(capability.operation)){const descriptor=registry.getServiceOperation(capability.operation);if(descriptor.serviceOperation!==capability.operation)throw new Error(`SERVICE_OPERATION_MAPPING_INVALID: ${capability.operation}`);}}
  stopAccepting():void{this.accepting=false;this.host.stopAccepting();}
  private save(record:ServiceJobRecord,state:ServiceJobRecord['state']):ServiceJobRecord{const next={...record,state,updatedAt:Date.now()};this.state.saveJob(next);return next;}
  async execute(request:ServiceExecutionRequest):Promise<ServiceExecutionResult>{
    if(!this.accepting)throw new ServiceContractError({category:'DEPENDENCY_UNAVAILABLE',safeDiagnostic:'服务宿主正在关闭。',retryable:true,blocksService:false});
    request.signal.throwIfAborted();const catalog=this.host.catalog.requireOperation(request.operation),fence=this.state.fence(catalog.serviceId);if(fence?.state==='blocked_unknown')throw new ServiceContractError({category:'UNKNOWN_STATE',safeDiagnostic:fence.safeDiagnostic??'服务实例状态未知，等待健康确认。',retryable:false,blocksService:true});
    const previous=this.state.findByIdempotency(catalog.serviceId,request.idempotencyKey);if(previous&&!['cancelled','failed'].includes(previous.state))throw new ServiceContractError({category:previous.state==='unknown'?'UNKNOWN_STATE':'INVALID_INPUT',safeDiagnostic:'该幂等请求已存在，不会重复执行。',retryable:false,blocksService:previous.state==='unknown'});
    const profile=this.profiles.require(request.profile,request.profileRevision);if(profile.contentHash!==request.profileContentHash)throw new ServiceContractError({category:'INVALID_INPUT',safeDiagnostic:'Profile revision 与内容摘要不匹配。',retryable:false,blocksService:false});
    if(!['ready','partial'].includes(profile.state))throw new ServiceContractError({category:profile.state==='missing'?'NOT_CONFIGURED':'DEPENDENCY_UNAVAILABLE',safeDiagnostic:'所选服务 Profile 当前不可执行。',retryable:false,blocksService:profile.state==='blocked'});
    if(!profile.capabilities.includes(request.operation)||profile.serviceId!==catalog.serviceId)throw new ServiceContractError({category:'INVALID_INPUT',safeDiagnostic:'Profile 不支持请求的 operation。',retryable:false,blocksService:false});
    const job=serviceJobSchema.parse({jobId:randomUUID(),operation:request.operation,profile:this.profiles.publicProjection(profile),inputHandles:request.inputHandles,parameters:request.parameters,outputDirectory:path.resolve(request.outputDirectory),idempotencyKey:request.idempotencyKey,deadline:request.deadline}) satisfies ServiceJob;
    let record:ServiceJobRecord={jobId:job.jobId,serviceId:catalog.serviceId,operation:job.operation,profileId:profile.profileId,profileRevision:profile.revision,profileContentHash:profile.contentHash,idempotencyKey:job.idempotencyKey,state:'queued',createdAt:Date.now(),updatedAt:Date.now()};this.state.saveJob(record);
    const controller=new AbortController(),signal=AbortSignal.any([request.signal,controller.signal,AbortSignal.timeout(Math.max(1,request.deadline-Date.now()))]);let settle!:()=>void;const settled=new Promise<void>(resolve=>settle=resolve);this.active.set(job.jobId,{serviceId:catalog.serviceId,controller,settled});
    try{record=this.save(record,'running');const result=serviceResultSchema.parse(await this.host.adapter(catalog.serviceId).execute(job,signal));const outputs:ValidatedOutput[]=[];for(const output of result.outputs)outputs.push(await this.validators.validate({kind:output.kind,jobDirectory:job.outputDirectory,file:output.handle,signal}));this.save(record,'succeeded');return{text:result.text,outputs,observations:result.observations};}
    catch(error){const mapped=toServiceError(error);this.save(record,mapped.category==='CANCELLED'?'cancelled':mapped.category==='UNKNOWN_STATE'?'unknown':'failed');if(mapped.blocksService||mapped.category==='UNKNOWN_STATE')this.state.saveFence({serviceId:catalog.serviceId,state:'blocked_unknown',jobId:job.jobId,updatedAt:Date.now(),safeDiagnostic:mapped.safeDiagnostic});throw new ServiceContractError(mapped,error);}
    finally{this.active.delete(job.jobId);settle();}
  }
  async cancel(jobId:string):Promise<CancelResult>{const active=this.active.get(jobId),record=this.state.job(jobId);if(!active||!record)return{state:'cancelled'};this.save(record,'cancel_requested');active.controller.abort(new Error('SERVICE_JOB_CANCELLED'));const result=cancelResultSchema.parse(await this.host.lifecycleAdapter(active.serviceId).cancel(jobId));if(result.state==='unknown')this.state.saveFence({serviceId:active.serviceId,state:'blocked_unknown',jobId,updatedAt:Date.now(),safeDiagnostic:'服务取消状态未知，实例保持封锁。'});return result;}
  async cancelAndDrain():Promise<void>{
    this.stopAccepting();const jobs=[...this.active.entries()];const results=await Promise.allSettled(jobs.map(async([jobId,item])=>{const record=this.state.job(jobId);if(record)this.save(record,'cancel_requested');item.controller.abort(new Error('SERVICE_HOST_SHUTDOWN'));const result=cancelResultSchema.parse(await this.host.lifecycleAdapter(item.serviceId).cancel(jobId));if(result.state==='unknown')this.state.saveFence({serviceId:item.serviceId,state:'blocked_unknown',jobId,updatedAt:Date.now(),safeDiagnostic:'服务任务停止状态未知，实例保持封锁。'});return result;}));await Promise.allSettled(jobs.map(([,item])=>item.settled));const unknown=results.find(result=>result.status==='fulfilled'&&result.value.state==='unknown');if(unknown)throw new ServiceContractError({category:'UNKNOWN_STATE',safeDiagnostic:'服务任务停止状态未知，实例保持封锁。',retryable:false,blocksService:true});
  }
  confirmServiceIdle(serviceId:string):void{this.state.saveFence({serviceId,state:'available',updatedAt:Date.now()});}
}
