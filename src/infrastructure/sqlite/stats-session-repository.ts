import type {StatsSessionOwner} from '../../core/usage.js';
import type {StatsSessionRepository} from '../../core/ports/stats.js';
import type {SqliteDatabase} from './database.js';

/** Per-session statistics ownership and native journal start positions. */
export class SqliteStatsSessionRepository implements StatsSessionRepository {
  constructor(private readonly database: SqliteDatabase) {}
  sessionExists(id: string): boolean {return Boolean(this.database.records.get('stats-session', id));}
  ownedStart(id: string): number {return this.database.records.get<number>('stats-owned-start', id) ?? 0;}
  saveOwnedStart(id: string, value: number): void {this.database.records.put('stats-owned-start', id, value);}
  listOwners(): readonly StatsSessionOwner[] {return this.database.records.list<StatsSessionOwner>('stats-session');}
}
