import type {MemoryRecord, MemoryRepository} from '../../core/ports/memory.js';
import type {InboxRepository} from '../../core/ports/inbox.js';
import {ConflictError} from '../../core/errors.js';
import type {SqliteDatabase} from './database.js';

/**
 * Long-term preferences.  A remembered value must be quoted verbatim from a
 * user message, and forgetting keeps a tombstone so old sources cannot revive.
 */
export class SqliteMemoryRepository implements MemoryRepository {
  constructor(private readonly database: SqliteDatabase, private readonly inbox: () => InboxRepository) {}
  remember(scope: string, key: string, value: string, source: string, quote: string): void {
    if (!key.trim() || key.length > 100 || value.length > 500) throw new Error('记忆长度无效');
    const input = this.inbox().source(scope, source);
    if (!input || !quote.trim() || !input.text.split(/\r?\n/).some(line => line.trim() === quote.trim()) || !/^(?:我(?:喜欢|不喜欢|希望|习惯|偏好|叫|是)|请记住|以后|下次|每次|不要再)/.test(quote.trim()) || /(?:网页|转发|引用|工具结果|以下内容|```|https?:\/\/)/.test(input.text)) throw new Error('记忆必须来自用户本人表达的稳定偏好，并提供完整原文行');
    if (this.database.db.prepare("SELECT 1 FROM forgotten WHERE scope=? AND source=? AND key IN (?, '*')").get(scope, source, key)) throw new Error('该来源的记忆已被删除或更正');
    this.database.db.prepare('INSERT OR IGNORE INTO memory_sources VALUES(?,?,?)').run(scope, key, source);
    this.database.db.prepare('INSERT INTO memory VALUES(?,?,?,?,?,1,0,?) ON CONFLICT(scope,key) DO UPDATE SET value=excluded.value,source=excluded.source,quote=excluded.quote,version=memory.version+1,deleted=0,updated=excluded.updated').run(scope, key, value, source, quote, Date.now());
  }
  memories(scope: string): MemoryRecord[] {
    return this.database.db.prepare('SELECT key,value,source,quote,version,updated FROM memory WHERE scope=? AND deleted=0 ORDER BY updated DESC LIMIT 30').all(scope) as unknown as MemoryRecord[];
  }
  private blockSources(scope: string, key: string): void {
    const rows = this.database.db.prepare('SELECT source FROM memory_sources WHERE scope=? AND key=? UNION SELECT source FROM memory WHERE scope=? AND key=?').all(scope, key, scope, key) as {source:string}[];
    for (const row of rows) this.database.db.prepare('INSERT OR IGNORE INTO forgotten VALUES(?,?,?)').run(scope, row.source, '*');
  }
  correctMemory(scope: string, key: string, value: string, version: number): void {
    this.database.transaction(() => {
      const result = this.database.db.prepare('UPDATE memory SET value=?,version=version+1,updated=? WHERE scope=? AND key=? AND version=? AND deleted=0').run(value, Date.now(), scope, key, version);
      if (result.changes !== 1) throw new ConflictError();
      this.blockSources(scope, key);
    });
  }
  forget(scope: string, key: string): void {
    this.database.transaction(() => {
      this.blockSources(scope, key);
      this.database.db.prepare('UPDATE memory SET deleted=1,updated=? WHERE scope=? AND key=?').run(Date.now(), scope, key);
    });
  }
  countMemories(): number {return Number((this.database.db.prepare('SELECT COUNT(*) count FROM memory').get() as {count:number|bigint}).count);}
  deleteScope(scope: string): void {
    this.database.db.prepare('DELETE FROM memory WHERE scope=?').run(scope);
    this.database.db.prepare('DELETE FROM forgotten WHERE scope=?').run(scope);
    this.database.db.prepare('DELETE FROM memory_sources WHERE scope=?').run(scope);
  }
  deleteKey(scope: string, key: string): void {
    this.database.db.prepare('DELETE FROM memory WHERE scope=? AND key=?').run(scope, key);
    this.database.db.prepare('DELETE FROM forgotten WHERE scope=? AND key=?').run(scope, key);
    this.database.db.prepare('DELETE FROM memory_sources WHERE scope=? AND key=?').run(scope, key);
  }
}
