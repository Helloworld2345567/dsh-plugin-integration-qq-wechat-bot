import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {RecordTable} from './record-table.js';

/**
 * Single owner of the SQLite connection: file location, pragmas, transactions
 * and the collection revisions used by keyset pagination.
 *
 * Nothing outside `src/infrastructure/sqlite/` may import this module.
 */
export class SqliteDatabase {
  readonly db: DatabaseSync;
  readonly records: RecordTable;
  constructor(readonly home: string, file = 'bots.sqlite') {
    mkdirSync(home, {recursive:true});
    this.db = new DatabaseSync(path.join(home, file));
    this.records = new RecordTable(this.db);
  }
  exec(sql: string): void {this.db.exec(sql);}
  /** Explicit unit of work.  Every nested adapter write joins this transaction. */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** Savepoint that also works inside an already open transaction. */
  savepoint<T>(name: string, fn: () => T): T {
    this.db.exec(`SAVEPOINT ${name}`);
    try { const value = fn(); this.db.exec(`RELEASE ${name}`); return value; }
    catch (error) { this.db.exec(`ROLLBACK TO ${name}`); this.db.exec(`RELEASE ${name}`); throw error; }
  }
  revision(name: string): number {
    const row = this.db.prepare('SELECT revision FROM collection_revisions WHERE name=?').get(name) as {revision:number} | undefined;
    return row?.revision ?? 0;
  }
  bump(name: string): void {
    this.db.prepare('INSERT INTO collection_revisions VALUES(?,1) ON CONFLICT(name) DO UPDATE SET revision=revision+1').run(name);
  }
  close(): void {this.db.close();}
}
