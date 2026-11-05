import type {MediaJobRecord, MediaJobRepository, MediaQuotaRepository} from '../../core/ports/media.js';
import type {SqliteDatabase} from './database.js';

/** Long-running media worker jobs and their durable journals. */
export class SqliteMediaJobRepository implements MediaJobRepository {
  constructor(private readonly database: SqliteDatabase) {}
  jobs(): readonly MediaJobRecord[] {return this.database.records.list<MediaJobRecord>('job');}
  findJob(id: string): MediaJobRecord | undefined {return this.database.records.get<MediaJobRecord>('job', id);}
  saveJob(id: string, value: unknown): void {this.database.records.put('job', id, value);}
  patchJob(id: string, patch: Readonly<Record<string, unknown>>): MediaJobRecord {
    const next = {...this.findJob(id), ...patch} as MediaJobRecord;
    this.saveJob(id, next);
    return next;
  }
  countJobs(): number {return this.database.records.count('job');}
}

/** Atomic daily media quota.  Reaching the limit never consumes a unit. */
export class SqliteMediaQuotaRepository implements MediaQuotaRepository {
  constructor(private readonly database: SqliteDatabase) {}
  consume(key: string, limit: number): void {
    this.database.transaction(() => {
      const used = this.database.records.get<number>('media-quota', key) ?? 0;
      if (used >= limit) throw Error('MEDIA_DAILY_LIMIT');
      this.database.records.put('media-quota', key, used + 1);
    });
  }
}
