import {diagnosticFields} from '../i18n/diagnostics.js';
import {randomUUID} from 'node:crypto';
import {mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import type {CapabilityRegistry} from './capability-registry.js';
import type {MediaOperationRegistry} from './media-operation-registry.js';
import {OutputValidatorRegistry,type ValidatedOutput} from './output-validator.js';
import type {ProfileStore} from './profile-store.js';
import {cancelResultSchema,healthResultSchema,serviceJobSchema,serviceResultSchema,type CancelResult,type HealthResult,type ServiceAdapterJob,type ServiceInputHandle,type ServiceJob,type ServiceProfileRef} from './service-contract.js';
import {toServiceError,ServiceContractError} from './service-errors.js';
import type {ServicePluginHost} from './service-plugin-host.js';
import {InMemoryServiceStateRepository,type ServiceJobRecord,type ServiceStateRepository} from './service-state-store.js';

export interface ApprovedServicePolicy {permission:string;concurrency:'parallel'|'global'|'scope'|number;quotaPolicy:string;delivery:'never'|'host_decides'}
export interface ServiceExecutionRequest {operation:string;profile:ServiceProfileRef;profileRevision:number;profileContentHash:string;inputHandles:readonly string[];resolvedInputs?:readonly ServiceInputHandle[];parameters:Record<string,unknown>;outputDirectory:string;idempotencyKey:string;deadline:number;scopeKey?:string;signal:AbortSignal;authorize?:()=>void}
export interface ServiceCapabilityBinding {profile:ServiceProfileRef;profileRevision:number;profileContentHash:string;inputHandles:readonly string[];resolvedInputs?:readonly ServiceInputHandle[];outputDirectory:string;idempotencyKey:string;deadline:number;scopeKey?:string;authorize?:()=>void}
export type ServiceCapabilityBinder=(operation:string,parameters:Record<string,unknown>,context:{signal:AbortSignal;scopeKey?:string})=>ServiceCapabilityBinding|Promise<ServiceCapabilityBinding>;
export interface ServiceExecutionResult {text?:string;outputs:readonly ValidatedOutput[];observations?:unknown}
type ActiveJob={serviceId:string;controller:AbortController;settled:Promise<void>};

/** Host-owned bridge from the immutable plugin catalog into runtime policy and output validation. */
export class ServiceRuntime {
  private accepting=true;
  private readonly active=new Map<string,ActiveJob>();
  constructor(readonly host:ServicePluginHost,readonly profiles:ProfileStore,readonly validators:OutputValidatorRegistry,readonly policies:ReadonlyMap<string,ApprovedServicePolicy>,readonly state:ServiceStateRepository=new InMemoryServiceStateRepository(),readonly healthRoot=path.resolve('.runtime','service-health')){
    for(const entry of host.catalog.list())for(const descriptor of entry.capabilities)if(!policies.has(descriptor.operation))throw new Error(`SERVICE_OPERATION_POLICY_MISSING: ${descriptor.operation}`);
  }
  registerCapabilities(registry:CapabilityRegistry,binder?:ServiceCapabilityBinder):readonly (()=>void)[]{
    const services=this.host.catalog.list();if(services.length&&!binder)throw new Error('SERVICE_CAPABILITY_BINDER_REQUIRED');const disposers:(()=>void)[]=[];
    for(const entry of services)for(const descriptor of entry.capabilities){const policy=this.policies.get(descriptor.operation)!;disposers.push(registry.register({name:descriptor.operation,operation:descriptor.operation,permission:policy.permission,schema:descriptor.parameterSchema.schema,concurrency:policy.concurrency,execute:async(arguments_:unknown,context)=>{const parameters=arguments_ as Record<string,unknown>,binding=await binder!(descriptor.operation,parameters,{signal:context.signal,scopeKey:context.scopeKey});return this.execute({...binding,operation:descriptor.operation,parameters,signal:context.signal});}}));}
    return disposers;
  }
  assertApprovedMediaOperations(registry:MediaOperationRegistry):void {for(const entry of this.host.catalog.list())for(const capability of entry.capabilities)if(registry.hasServiceOperation(capability.operation)){const descriptor=registry.getServiceOperation(capability.operation);if(!registry.isServiceOperationAlias(capability.operation)&&descriptor.serviceOperation!==capability.operation)throw new Error(`SERVICE_OPERATION_MAPPING_INVALID: ${capability.operation}`);}}
  async health(ref:ServiceProfileRef,signal:AbortSignal):Promise<HealthResult>{
    signal.throwIfAborted();this.host.catalog.require(ref.serviceId);const profile=this.profiles.get(ref);if(!profile)throw new ServiceContractError({category:'NOT_CONFIGURED',...diagnosticFields("profileProbeMissing"),retryable:false,blocksService:false});if(['missing','disabled','revoked','blocked'].includes(profile.state)){const state:HealthResult['state']=profile.state==='missing'?'unavailable':profile.state==='revoked'?'blocked':profile.state as 'disabled'|'blocked';return{state,checkedAt:Date.now(),expiresAt:Date.now(),...diagnosticFields("profileNotProbeable")};}const outputDirectory=path.join(this.healthRoot,randomUUID());await mkdir(outputDirectory,{recursive:true});try{return healthResultSchema.parse(await this.host.adapter(ref.serviceId).health(profile,signal,{outputDirectory}));}finally{await rm(outputDirectory,{recursive:true,force:true});}
  }
  stopAccepting():void{this.accepting=false;this.host.stopAccepting();}
  private save(record:ServiceJobRecord,state:ServiceJobRecord['state']):ServiceJobRecord{const next={...record,state,updatedAt:Date.now()};this.state.saveJob(next);return next;}
  async execute(request:ServiceExecutionRequest):Promise<ServiceExecutionResult>{
    if(!this.accepting)throw new ServiceContractError({category:'DEPENDENCY_UNAVAILABLE',...diagnosticFields("serviceHostClosing"),retryable:true,blocksService:false});
    request.signal.throwIfAborted();request.authorize?.();const catalog=this.host.catalog.requireOperation(request.operation),fence=this.state.fence(catalog.serviceId);if(fence?.state==='blocked_unknown')throw new ServiceContractError({category:'UNKNOWN_STATE',safeDiagnostic:fence.safeDiagnostic??diagnosticFields('serviceAwaitingHealth').safeDiagnostic,message:fence.message??diagnosticFields('serviceAwaitingHealth').message,retryable:false,blocksService:true});
    const previous=this.state.findByIdempotency(catalog.serviceId,request.idempotencyKey);if(previous)throw new ServiceContractError({category:previous.state==='unknown'?'UNKNOWN_STATE':'INVALID_INPUT',...diagnosticFields("duplicateRequest"),retryable:false,blocksService:previous.state==='unknown'});
    const frozen={serviceId:request.profile.serviceId,profileId:request.profile.profileId,profileRevision:request.profileRevision,profileContentHash:request.profileContentHash};
    let profile;try{profile=this.profiles.assertExecutable(frozen);}catch(error){const state=this.profiles.snapshotStatus(frozen).state;throw new ServiceContractError({category:state==='missing'?'NOT_CONFIGURED':'DEPENDENCY_UNAVAILABLE',...diagnosticFields("profileNotExecutable"),retryable:false,blocksService:['blocked','revoked'].includes(state)},error);}
    if(profile.contentHash!==request.profileContentHash)throw new ServiceContractError({category:'INVALID_INPUT',...diagnosticFields("profileDigestMismatch"),retryable:false,blocksService:false});
    if(!profile.capabilities.includes(request.operation)||profile.serviceId!==catalog.serviceId)throw new ServiceContractError({category:'INVALID_INPUT',...diagnosticFields("profileOperationUnsupported"),retryable:false,blocksService:false});
    const job=serviceJobSchema.parse({jobId:randomUUID(),operation:request.operation,profile:this.profiles.publicProjection(profile),inputHandles:request.inputHandles,parameters:request.parameters,outputDirectory:path.resolve(request.outputDirectory),idempotencyKey:request.idempotencyKey,deadline:request.deadline}) satisfies ServiceJob;
    const resolvedInputs=Object.freeze((request.resolvedInputs??[]).map(input=>Object.freeze({...input})));if(resolvedInputs.length!==job.inputHandles.length||resolvedInputs.some((input,index)=>input.handle!==job.inputHandles[index]))throw new ServiceContractError({category:'INVALID_INPUT',...diagnosticFields("inputNotResolved"),retryable:false,blocksService:false});
    const adapterJob=Object.freeze({...job,profile,inputs:resolvedInputs}) satisfies ServiceAdapterJob;
    let record:ServiceJobRecord={jobId:job.jobId,serviceId:catalog.serviceId,operation:job.operation,profileId:profile.profileId,profileRevision:profile.revision,profileContentHash:profile.contentHash,idempotencyKey:job.idempotencyKey,state:'queued',createdAt:Date.now(),updatedAt:Date.now()};this.state.saveJob(record);
    const controller=new AbortController(),signal=AbortSignal.any([request.signal,controller.signal,AbortSignal.timeout(Math.max(1,request.deadline-Date.now()))]);let settle!:()=>void;const settled=new Promise<void>(resolve=>settle=resolve);this.active.set(job.jobId,{serviceId:catalog.serviceId,controller,settled});
    try{record=this.save(record,'running');signal.throwIfAborted();request.authorize?.();this.profiles.assertExecutable(frozen);const rawResult=await this.host.adapter(catalog.serviceId).execute(adapterJob,signal);const parsedResult=serviceResultSchema.safeParse(rawResult);if(!parsedResult.success)throw new ServiceContractError({category:'OUTPUT_INVALID',providerCode:'SERVICE_RESULT_INVALID',...diagnosticFields("resultContractInvalid"),retryable:false,blocksService:false},parsedResult.error);const result=parsedResult.data;signal.throwIfAborted();request.authorize?.();this.profiles.assertExecutable(frozen);const outputs:ValidatedOutput[]=[];for(const output of result.outputs){signal.throwIfAborted();request.authorize?.();this.profiles.assertExecutable(frozen);outputs.push(await this.validators.validate({kind:output.kind,jobDirectory:job.outputDirectory,file:output.handle,signal}));}signal.throwIfAborted();request.authorize?.();this.profiles.assertExecutable(frozen);this.save(record,'succeeded');return{text:result.text,outputs,observations:result.observations};}
    catch(error){const mapped=toServiceError(error);this.save(record,mapped.category==='CANCELLED'?'cancelled':mapped.category==='UNKNOWN_STATE'?'unknown':'failed');if(mapped.blocksService||mapped.category==='UNKNOWN_STATE')this.state.saveFence({serviceId:catalog.serviceId,state:'blocked_unknown',jobId:job.jobId,updatedAt:Date.now(),safeDiagnostic:mapped.safeDiagnostic,message:mapped.message});throw new ServiceContractError(mapped,error);}
    finally{this.active.delete(job.jobId);settle();}
  }
  async cancel(jobId:string):Promise<CancelResult>{const active=this.active.get(jobId),record=this.state.job(jobId);if(!active||!record)return{state:'cancelled'};this.save(record,'cancel_requested');active.controller.abort(new Error('SERVICE_JOB_CANCELLED'));const result=cancelResultSchema.parse(await this.host.lifecycleAdapter(active.serviceId).cancel(jobId));if(result.state==='unknown')this.state.saveFence({serviceId:active.serviceId,state:'blocked_unknown',jobId,updatedAt:Date.now(),...diagnosticFields("cancellationUnknown")});return result;}
  async cancelAndDrain():Promise<void>{
    this.stopAccepting();const jobs=[...this.active.entries()];const results=await Promise.allSettled(jobs.map(async([jobId,item])=>{const record=this.state.job(jobId);if(record)this.save(record,'cancel_requested');item.controller.abort(new Error('SERVICE_HOST_SHUTDOWN'));const result=cancelResultSchema.parse(await this.host.lifecycleAdapter(item.serviceId).cancel(jobId));if(result.state==='unknown')this.state.saveFence({serviceId:item.serviceId,state:'blocked_unknown',jobId,updatedAt:Date.now(),...diagnosticFields("stopUnknown")});return result;}));await Promise.allSettled(jobs.map(([,item])=>item.settled));const unknown=results.find(result=>result.status==='fulfilled'&&result.value.state==='unknown');if(unknown)throw new ServiceContractError({category:'UNKNOWN_STATE',...diagnosticFields("stopUnknown"),retryable:false,blocksService:true});
  }
  confirmServiceIdle(serviceId:string):void{this.state.saveFence({serviceId,state:'available',updatedAt:Date.now()});}
}
