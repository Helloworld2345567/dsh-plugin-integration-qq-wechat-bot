import type {InboundMessage} from '../../core/types.js';
import {validateInboundMessage} from '../../core/limits.js';
import {scopeKey} from '../../core/identity.js';
import type {InboxRepository} from '../../core/ports/inbox.js';
import type {TurnMetricRepository} from '../../core/ports/telemetry.js';
import type {StatsProjectionRepository} from '../../core/ports/stats.js';
import type {SqliteDatabase} from './database.js';

/** Accepted inbound messages.  Acceptance is idempotent per (scope,id). */
export class SqliteInboxRepository implements InboxRepository {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly metrics: () => TurnMetricRepository,
    private readonly stats: () => StatsProjectionRepository,
  ) {}
  accept(message: InboundMessage): boolean {
    const validation = validateInboundMessage(message);
    if (validation) throw new Error(validation);
    const scope = scopeKey(message.scope);
    const accepted = this.database.db.prepare('INSERT OR IGNORE INTO inbox(scope,id,json) VALUES(?,?,?)').run(scope, message.id, JSON.stringify(message)).changes === 1;
    if (accepted) {
      this.metrics().updateTurnMetric(`inbox:${scope}:${message.id}`, {scopeKey:scope, sourceId:message.id, receivedAt:message.timestamp, state:'received'});
      this.stats().observeReceived(message);
    }
    return accepted;
  }
  messages(scope: string, states: readonly string[] = ['pending']): InboundMessage[] {
    return (this.database.db.prepare(`SELECT json FROM inbox WHERE scope=? AND state IN (${states.map(() => '?').join(',')}) ORDER BY rowid`).all(scope, ...states) as {json:string}[]).map(row => JSON.parse(row.json) as InboundMessage);
  }
  source(scope: string, id: string): InboundMessage | undefined {
    const row = this.database.db.prepare('SELECT json FROM inbox WHERE scope=? AND id=?').get(scope, id) as {json:string} | undefined;
    return row ? JSON.parse(row.json) as InboundMessage : undefined;
  }
  updateMessage(scope: string, message: InboundMessage): void {
    this.database.db.prepare('UPDATE inbox SET json=? WHERE scope=? AND id=?').run(JSON.stringify(message), scope, message.id);
  }
  mark(scope: string, ids: readonly string[], state: string): void {
    for (const id of ids) {
      this.database.db.prepare('UPDATE inbox SET state=? WHERE scope=? AND id=?').run(state, scope, id);
      const metricId = `inbox:${scope}:${id}`, metric = this.metrics().findTurnMetric(metricId);
      if (!metric) continue;
      const metricState = ['received', 'processing', 'complete', 'failed', 'cancelled'].includes(state) ? state as NonNullable<typeof metric.state> : undefined;
      this.metrics().updateTurnMetric(metricId, {...(metricState ? {state:metricState} : {}), queuedAt:metric.queuedAt ?? (state !== 'received' ? Date.now() : undefined)});
    }
  }
  allMessages(states?: readonly string[]): InboundMessage[] {
    const where = states?.length ? ` WHERE state IN (${states.map(() => '?').join(',')})` : '';
    return (this.database.db.prepare(`SELECT json FROM inbox${where} ORDER BY rowid`).all(...(states ?? [])) as {json:string}[]).map(row => JSON.parse(row.json) as InboundMessage);
  }
  scopesWithPending(states: readonly string[] = ['pending']): string[] {
    return (this.database.db.prepare(`SELECT DISTINCT scope FROM inbox WHERE state IN (${states.map(() => '?').join(',')})`).all(...states) as {scope:string}[]).map(row => row.scope);
  }
  countMessages(): number {return Number((this.database.db.prepare('SELECT COUNT(*) count FROM inbox').get() as {count:number|bigint}).count);}
  /** Marks in-flight work as interrupted at recovery time. */
  interruptProcessing(): void {this.database.db.exec("UPDATE inbox SET state='interrupted' WHERE state='processing'");}
  /** Deletes one retained message; returns the number of removed rows. */
  delete(scope: string, id: string): number {return Number(this.database.db.prepare('DELETE FROM inbox WHERE scope=? AND id=?').run(scope, id).changes);}
  stateOf(scope: string, id: string): string | undefined {
    return (this.database.db.prepare('SELECT state FROM inbox WHERE scope=? AND id=?').get(scope, id) as {state:string} | undefined)?.state;
  }
  rows(): {scope:string;id:string;json:string}[] {return this.database.db.prepare('SELECT scope,id,json FROM inbox').all() as {scope:string;id:string;json:string}[];}
  deleteScope(scope: string): void {this.database.db.prepare('DELETE FROM inbox WHERE scope=?').run(scope);}
}
