import type {ServiceInstanceFence,ServiceJobRecord,ServiceStateRepository} from './ports/service.js';

export type {ServiceInstanceFence,ServiceJobRecord,ServiceStateRepository};
export class InMemoryServiceStateRepository implements ServiceStateRepository {
  private readonly fences=new Map<string,ServiceInstanceFence>();private readonly jobs=new Map<string,ServiceJobRecord>();
  fence(serviceId:string):ServiceInstanceFence|undefined{return this.fences.get(serviceId);}
  saveFence(record:ServiceInstanceFence):void{this.fences.set(record.serviceId,Object.freeze({...record}));}
  job(jobId:string):ServiceJobRecord|undefined{return this.jobs.get(jobId);}
  findByIdempotency(serviceId:string,idempotencyKey:string):ServiceJobRecord|undefined{return[...this.jobs.values()].find(record=>record.serviceId===serviceId&&record.idempotencyKey===idempotencyKey);}
  saveJob(record:ServiceJobRecord):void{this.jobs.set(record.jobId,Object.freeze({...record}));}
}
