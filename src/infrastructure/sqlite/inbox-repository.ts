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
    const accepted = this.database.db.prepare('INSERT OR IGNORE INTO inbox(scope,id,received_at,direct_image,json) VALUES(?,?,?,?,?)')
      .run(scope, message.id, message.timestamp, message.directImageCommand ? 1 : 0, JSON.stringify(message)).changes === 1;
    if (accepted) {
      this.metrics().updateTurnMetric(`inbox:${scope}:${message.id}`, {scopeKey:scope, sourceId:message.id, receivedAt:message.timestamp, state:'received'});
      this.stats().observeReceived(message);
    }
    return accepted;
  }
  messages(scope: string, states: readonly string[] = ['pending']): InboundMessage[] {
    return (this.database.db.prepare(`SELECT json FROM inbox WHERE scope=? AND state IN (${states.map(() => '?').join(',')}) ORDER BY rowid`).all(scope, ...states) as {json:string}[]).map(row => JSON.parse(row.json) as InboundMessage);
  }
  nextBatch(scope: string, limit: number, deferredSince: number): InboundMessage[] {
    const db=this.database.db;
    const pending=db.prepare("SELECT rowid pos,direct_image FROM inbox WHERE scope=? AND state='pending' ORDER BY rowid LIMIT ?")
      .all(scope,limit) as {pos:number;direct_image:number}[];
    if(!pending.length)return [];
    const first=pending[0].pos;
    const materials=db.prepare(`SELECT rowid pos FROM inbox WHERE scope=? AND state='deferred' AND rowid<?
      AND received_at>? ORDER BY rowid DESC LIMIT ?`).all(scope,first,deferredSince,limit-1) as {pos:number}[];
    // Older overflow and expired material belong to this instruction. A later
    // instruction must not silently pick them up after the selected rows finish.
    const obsolete=db.prepare(`SELECT id FROM inbox WHERE scope=? AND state='deferred' AND rowid<?
      AND (rowid<? OR received_at<=?)`).all(scope,first,materials.at(-1)?.pos??first,deferredSince) as {id:string}[];
    this.mark(scope,obsolete.map(row=>row.id),'cancelled');
    const selected=pending.slice(0,limit-materials.length);
    const direct=selected.findIndex(row=>row.direct_image===1);
    if(direct!==-1)selected.length=direct||1;
    const nextMaterial=db.prepare(`SELECT rowid pos FROM inbox WHERE scope=? AND state='deferred' AND rowid>? AND rowid<?
      AND received_at>? ORDER BY rowid LIMIT 1`).get(scope,first,selected.at(-1)!.pos,deferredSince);
    const instructions=nextMaterial?selected.filter(row=>row.pos<Number(nextMaterial.pos)):selected;
    const positions=[...materials,...instructions].map(row=>row.pos);
    const rows=db.prepare(`SELECT json FROM inbox WHERE rowid IN (${positions.map(()=>'?').join(',')}) ORDER BY rowid`).all(...positions) as {json:string}[];
    return rows.map(row=>JSON.parse(row.json) as InboundMessage);
  }
  pendingWindow(scope: string, limit: number): {count:number;hasDirectImage:boolean} {
    const row=this.database.db.prepare(`SELECT COUNT(*) count, MAX(direct_image) direct
      FROM (SELECT direct_image FROM inbox WHERE scope=? AND state='pending' ORDER BY rowid LIMIT ?)`).get(scope,limit)!;
    return {count:Number(row.count),hasDirectImage:!!row.direct};
  }
  source(scope: string, id: string): InboundMessage | undefined {
    const row = this.database.db.prepare('SELECT json FROM inbox WHERE scope=? AND id=?').get(scope, id) as {json:string} | undefined;
    return row ? JSON.parse(row.json) as InboundMessage : undefined;
  }
  updateMessage(scope: string, message: InboundMessage): void {
    this.database.db.prepare('UPDATE inbox SET json=?,received_at=?,direct_image=? WHERE scope=? AND id=?')
      .run(JSON.stringify(message), message.timestamp, message.directImageCommand ? 1 : 0, scope, message.id);
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
  /** Deletes one retained message; returns the number of removed rows. */
  delete(scope: string, id: string): number {return Number(this.database.db.prepare('DELETE FROM inbox WHERE scope=? AND id=?').run(scope, id).changes);}
  stateOf(scope: string, id: string): string | undefined {
    return (this.database.db.prepare('SELECT state FROM inbox WHERE scope=? AND id=?').get(scope, id) as {state:string} | undefined)?.state;
  }
  rows(): {scope:string;id:string;json:string}[] {return this.database.db.prepare('SELECT scope,id,json FROM inbox').all() as {scope:string;id:string;json:string}[];}
  deleteScope(scope: string): void {this.database.db.prepare('DELETE FROM inbox WHERE scope=?').run(scope);}
}
