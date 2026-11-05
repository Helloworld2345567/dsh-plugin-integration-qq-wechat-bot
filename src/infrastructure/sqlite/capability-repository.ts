import type {CapabilityAcceptance} from '../../core/service-contract.js';
import type {CapabilityAcceptanceRepository, CapabilityStatusRecord, ServiceHealthRecord, ServiceHealthRepository} from '../../core/ports/service.js';
import type {SqliteDatabase} from './database.js';

/** Operator capability facts and the health cache keyed by profile revision. */
export class SqliteCapabilityRepository implements CapabilityAcceptanceRepository, ServiceHealthRepository {
  constructor(private readonly database: SqliteDatabase) {}
  statuses(): readonly CapabilityStatusRecord[] {return this.database.records.list<CapabilityStatusRecord>('capability-status');}
  saveStatus(id: string, value: CapabilityStatusRecord): void {this.database.records.put('capability-status', id, value);}
  acceptance(key: string): CapabilityAcceptance | undefined {return this.database.records.get<CapabilityAcceptance>('capability-acceptance', key);}
  findAcceptance(predicate: (record: CapabilityAcceptance) => boolean): CapabilityAcceptance | undefined {
    return this.database.records.list<CapabilityAcceptance>('capability-acceptance').find(predicate);
  }
  allAcceptances(): readonly CapabilityAcceptance[] {return this.database.records.list<CapabilityAcceptance>('capability-acceptance');}
  saveAcceptance(key: string, record: CapabilityAcceptance): void {this.database.records.put('capability-acceptance', key, record);}
  health(key: string): ServiceHealthRecord | undefined {return this.database.records.get<ServiceHealthRecord>('service-health', key);}
  saveHealth(key: string, record: ServiceHealthRecord): void {this.database.records.put('service-health', key, record);}
}
