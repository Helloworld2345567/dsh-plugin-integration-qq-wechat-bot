import type {DatabaseSync} from 'node:sqlite';

/**
 * Internal accessor for the generic `records` table.
 *
 * Repository adapters pass their own fixed record kind; no application service
 * can reach this class, and no caller ever supplies a runtime record kind.
 */
export class RecordTable {
  constructor(private readonly db: DatabaseSync) {}
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare('SELECT json FROM records WHERE kind=? AND id=?').get(kind, id) as {json:string} | undefined;
    return row ? JSON.parse(row.json) as T : undefined;
  }
  list<T>(kind: string): T[] {
    return (this.db.prepare('SELECT json FROM records WHERE kind=? ORDER BY id').all(kind) as {json:string}[]).map(row => JSON.parse(row.json) as T);
  }
  put(kind: string, id: string, value: unknown): void {
    this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run(kind, id, JSON.stringify(value));
  }
  delete(kind: string, id: string): void {
    this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id);
  }
  count(kind: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) count FROM records WHERE kind=?').get(kind) as {count:number|bigint}).count);
  }
  entries(): {kind:string;id:string;json:string}[] {
    return this.db.prepare('SELECT kind,id,json FROM records').all() as {kind:string;id:string;json:string}[];
  }
}
