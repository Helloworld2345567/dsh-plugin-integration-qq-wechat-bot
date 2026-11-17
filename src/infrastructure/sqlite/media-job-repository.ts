import type {MediaJobRecord, MediaJobRepository} from '../../core/ports/media.js';
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
