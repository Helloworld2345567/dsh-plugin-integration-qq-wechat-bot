import type {ProfileRecord, ProfileRepository} from '../../core/ports/service.js';
import type {SqliteDatabase} from './database.js';

const recordKey = (serviceId: string, profileId: string, revision: number) => `${serviceId}/${profileId}@${revision}`;

/**
 * Immutable service profile revisions.  Saving an existing revision fails
 * instead of silently overwriting published content.
 */
export class SqliteProfileRepository implements ProfileRepository {
  constructor(private readonly database: SqliteDatabase) {}
  get(serviceId: string, profileId: string, revision: number): ProfileRecord | undefined {
    return this.database.records.get<ProfileRecord>('service-profile', recordKey(serviceId, profileId, revision));
  }
  latest(serviceId: string, profileId: string): ProfileRecord | undefined {
    return this.list(serviceId).filter(record => record.profileId === profileId).sort((a, b) => b.revision - a.revision)[0];
  }
  list(serviceId?: string): readonly ProfileRecord[] {
    return this.database.records.list<ProfileRecord>('service-profile').filter(record => !serviceId || record.serviceId === serviceId).sort((a, b) => a.serviceId.localeCompare(b.serviceId) || a.profileId.localeCompare(b.profileId) || a.revision - b.revision);
  }
  save(record: ProfileRecord): void {
    const key = recordKey(record.serviceId, record.profileId, record.revision);
    if (this.database.records.get('service-profile', key)) throw new Error('PROFILE_REVISION_IMMUTABLE');
    this.database.records.put('service-profile', key, record);
  }
}
