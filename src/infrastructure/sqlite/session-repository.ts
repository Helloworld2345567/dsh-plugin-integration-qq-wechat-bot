import {randomUUID} from 'node:crypto';
import type {CallerScope, Delivery, SessionBinding, SessionRecord} from '../../core/types.js';
import {scopeKey} from '../../core/identity.js';
import {idSchema} from '../../core/types.js';
import {decodeCursor, encodeCursor, filterHash} from '../../core/pagination.js';
import type {Page} from '../../core/ports/common.js';
import type {BindingRepository, SessionPageFilter, SessionRepository} from '../../core/ports/session.js';
import type {SqliteDatabase} from './database.js';

/**
 * Channel-identity bindings and their session generation.
 *
 * The binding row and the session record always change in the same call, which
 * is why one adapter owns both tables and the `sessions` revision counter.
 */
export class SqliteSessionRepository implements SessionRepository, BindingRepository {
  constructor(private readonly database: SqliteDatabase) {}
  private get records() {return this.database.records;}

  binding(scope: CallerScope): SessionBinding {
    const key = scopeKey(scope);
    let binding = this.records.get<SessionBinding>('binding', key);
    if (!binding) {
      binding = {key, scope, sessionId:randomUUID(), generation:0, persisted:false, recentSince:Date.now()};
      this.updateSession(binding);
    } else this.recordSession(binding);
    return binding;
  }
  private recordSession(binding: SessionBinding): void {
    const previous = this.records.get<SessionRecord>('session', binding.sessionId);
    if (previous && previous.scopeKey !== binding.key) throw new Error('SESSION_OWNERSHIP_MISMATCH');
    const now = Date.now();
    this.records.put('session', binding.sessionId, {id:binding.sessionId, scopeKey:binding.key, scope:binding.scope, generation:binding.generation, persisted:binding.persisted, createdAt:previous?.createdAt ?? now, updatedAt:now, personaId:binding.personaId, modelOverride:binding.modelOverride, ttsOverride:binding.ttsOverride, stsOverride:binding.stsOverride, recentSince:binding.recentSince} satisfies SessionRecord);
  }
  updateSession(binding: SessionBinding): SessionBinding {
    if (binding.key !== scopeKey(binding.scope)) throw new Error('SESSION_OWNERSHIP_MISMATCH');
    this.recordSession(binding);
    this.records.put('binding', binding.key, binding);
    this.database.bump('sessions');
    return binding;
  }
  markSessionPersisted(binding: SessionBinding): void {
    const current = this.records.get<SessionBinding>('binding', binding.key);
    if (current?.sessionId === binding.sessionId) this.updateSession({...current, persisted:true});
    else {
      const record = this.session(binding.scope, binding.sessionId);
      this.records.put('session', record.id, {...record, persisted:true, updatedAt:Date.now()});
    }
  }
  findBinding(key: string): SessionBinding | undefined {return this.records.get<SessionBinding>('binding', key);}
  bindings(): SessionBinding[] {return this.records.list<SessionBinding>('binding');}
  findSession(id: string): SessionRecord | undefined {return this.records.get<SessionRecord>('session', id);}
  session(scope: CallerScope, id: string): SessionRecord {
    const record = this.findSession(id);
    if (!record || record.scopeKey !== scopeKey(scope)) throw new Error('会话不存在或不属于当前渠道身份');
    return record;
  }
  sessions(scope: CallerScope): SessionRecord[] {
    this.binding(scope);
    return this.records.list<SessionRecord>('session').filter(item => item.scopeKey === scopeKey(scope)).sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));
  }
  sessionsAll(): SessionRecord[] {return this.records.list<SessionRecord>('session');}
  recentSince(key: string): number {return this.records.get<SessionBinding>('binding', key)?.recentSince ?? 0;}
  sessionRecentSince(key: string): number {return this.recentSince(key);}
  reset(scope: CallerScope): SessionBinding {
    const old = this.binding(scope);
    const next = {...old, sessionId:randomUUID(), generation:old.generation + 1, persisted:false, recentSince:Date.now()};
    return this.updateSession(next);
  }
  activateSession(scope: CallerScope, id: string): SessionBinding {
    const old = this.binding(scope), record = this.session(scope, id);
    return this.updateSession({key:old.key, scope, sessionId:id, generation:old.generation + 1, persisted:record.persisted, personaId:record.personaId, modelOverride:record.modelOverride, ttsOverride:record.ttsOverride, stsOverride:record.stsOverride, recentSince:record.recentSince});
  }
  countSessions(): number {return this.records.count('session');}
  countBindings(): number {return this.records.count('binding');}
  pageSessions(filter: SessionPageFilter, limit: number, cursor?: string): Page<SessionRecord> {
    const revision = this.database.revision('sessions'), fingerprint = filterHash(filter), keyset = decodeCursor(cursor, 'sessions', fingerprint, revision), params: Array<string|number> = [];
    let where = '';
    if (filter.scopeKey) { where = ' WHERE json_extract(json,\'$.scopeKey\')=?'; params.push(filter.scopeKey); }
    if (keyset) {
      where += where ? ' AND ' : ' WHERE ';
      where += '(CAST(json_extract(json,\'$.updatedAt\') AS INTEGER)<? OR (CAST(json_extract(json,\'$.updatedAt\') AS INTEGER)=? AND id<?))';
      params.push(keyset.time, keyset.time, keyset.id);
    }
    const rows = this.database.db.prepare(`SELECT id,json FROM records${where}${where ? ' AND' : ' WHERE'} kind='session' ORDER BY CAST(json_extract(json,'$.updatedAt') AS INTEGER) DESC,id DESC LIMIT ?`).all(...params, limit + 1) as {id:string;json:string}[];
    const more = rows.length > limit, items = rows.slice(0, limit).map(row => JSON.parse(row.json) as SessionRecord), last = items.at(-1);
    return {items, nextCursor:more && last ? encodeCursor({v:1, collection:'sessions', filter:fingerprint, revision, time:last.updatedAt, id:last.id}) : null, revision:`sessions:${revision}`};
  }
  /**
   * Rebuild session records from durable evidence at open time.  Delivery rows
   * prove that an old session belongs to an existing channel identity; no
   * global history scan is performed.
   */
  backfill(deliveries: readonly Delivery[]): void {
    const bindings = this.bindings().filter(binding => {
      const scope = binding?.scope;
      if (!scope || !idSchema.safeParse(scope.platform).success || !['private', 'group'].includes(scope.kind)) return false;
      if (![scope.botId, scope.accountId, scope.channelId, scope.senderId, binding.sessionId].every(value => typeof value === 'string' && value.length > 0)) return false;
      return binding.key === scopeKey(scope);
    });
    for (const binding of bindings) this.recordSession(binding);
    for (const delivery of deliveries) {
      if (this.findSession(delivery.sessionId)) continue;
      const owner = bindings.find(binding => binding.key === delivery.scopeKey && binding.scope.botId === delivery.botId);
      if (!owner) continue;
      this.records.put('session', delivery.sessionId, {id:delivery.sessionId, scopeKey:owner.key, scope:owner.scope, generation:0, persisted:true, createdAt:delivery.createdAt ?? 0, updatedAt:delivery.updatedAt ?? delivery.createdAt ?? 0} satisfies SessionRecord);
    }
  }
}
