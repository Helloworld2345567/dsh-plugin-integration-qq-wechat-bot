import type {ServiceInstanceFence, ServiceJobRecord, ServiceStateRepository} from '../../core/ports/service.js';
import type {SqliteDatabase} from './database.js';

/**
 * Crash-visible service fence and idempotent jobs.  A fence blocks a service
 * until an operator resolves the unknown outcome; it is never cleared by retry.
 */
export class SqliteServiceStateRepository implements ServiceStateRepository {
  constructor(private readonly database: SqliteDatabase) {}
  fence(serviceId: string): ServiceInstanceFence | undefined {return this.database.records.get<ServiceInstanceFence>('service-fence', serviceId);}
  saveFence(record: ServiceInstanceFence): void {this.database.records.put('service-fence', record.serviceId, record);}
  job(jobId: string): ServiceJobRecord | undefined {return this.database.records.get<ServiceJobRecord>('service-job', jobId);}
  findByIdempotency(serviceId: string, idempotencyKey: string): ServiceJobRecord | undefined {
    return this.database.records.list<ServiceJobRecord>('service-job').find(record => record.serviceId === serviceId && record.idempotencyKey === idempotencyKey);
  }
  saveJob(record: ServiceJobRecord): void {this.database.records.put('service-job', record.jobId, record);}
}
