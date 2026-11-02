import type {Store} from './store.js';
import type {ServiceJobState} from './service-contract.js';

export interface ServiceInstanceFence {serviceId:string;state:'available'|'blocked_unknown';jobId?:string;updatedAt:number;safeDiagnostic?:string}
export interface ServiceJobRecord {jobId:string;serviceId:string;operation:string;profileId:string;profileRevision:number;profileContentHash:string;idempotencyKey:string;state:ServiceJobState;createdAt:number;updatedAt:number}
export interface ServiceStateRepository {
  fence(serviceId:string):ServiceInstanceFence|undefined;
  saveFence(record:ServiceInstanceFence):void;
  job(jobId:string):ServiceJobRecord|undefined;
  findByIdempotency(serviceId:string,idempotencyKey:string):ServiceJobRecord|undefined;
  saveJob(record:ServiceJobRecord):void;
}
export class InMemoryServiceStateRepository implements ServiceStateRepository {
  private readonly fences=new Map<string,ServiceInstanceFence>();private readonly jobs=new Map<string,ServiceJobRecord>();
  fence(serviceId:string):ServiceInstanceFence|undefined{return this.fences.get(serviceId);}
  saveFence(record:ServiceInstanceFence):void{this.fences.set(record.serviceId,Object.freeze({...record}));}
  job(jobId:string):ServiceJobRecord|undefined{return this.jobs.get(jobId);}
  findByIdempotency(serviceId:string,idempotencyKey:string):ServiceJobRecord|undefined{return[...this.jobs.values()].find(record=>record.serviceId===serviceId&&record.idempotencyKey===idempotencyKey);}
  saveJob(record:ServiceJobRecord):void{this.jobs.set(record.jobId,Object.freeze({...record}));}
}
export class StoreServiceStateRepository implements ServiceStateRepository {
  constructor(private readonly store:Store){}
  fence(serviceId:string):ServiceInstanceFence|undefined{return this.store.get<ServiceInstanceFence>('service-fence',serviceId);}
  saveFence(record:ServiceInstanceFence):void{this.store.put('service-fence',record.serviceId,record);}
  job(jobId:string):ServiceJobRecord|undefined{return this.store.get<ServiceJobRecord>('service-job',jobId);}
  findByIdempotency(serviceId:string,idempotencyKey:string):ServiceJobRecord|undefined{return this.store.list<ServiceJobRecord>('service-job').find(record=>record.serviceId===serviceId&&record.idempotencyKey===idempotencyKey);}
  saveJob(record:ServiceJobRecord):void{this.store.put('service-job',record.jobId,record);}
}
