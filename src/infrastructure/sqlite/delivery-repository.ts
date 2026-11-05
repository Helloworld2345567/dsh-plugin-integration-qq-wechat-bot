import {createHash} from 'node:crypto';
import type {ChannelReplyEnvelope, Delivery, Output, SessionBinding, TurnSnapshot} from '../../core/types.js';
import {decodeCursor, encodeCursor, filterHash} from '../../core/pagination.js';
import type {Page} from '../../core/ports/common.js';
import type {DeliveryPageRequest, DeliveryRepository, DeliveryState} from '../../core/ports/delivery.js';
import type {TurnMetricRepository} from '../../core/ports/telemetry.js';
import type {StatsProjectionRepository} from '../../core/ports/stats.js';
import type {AssetRepository} from '../../core/ports/media.js';
import type {SqliteDatabase} from './database.js';

export interface SqliteDeliveryDependencies {
  database: SqliteDatabase;
  metrics: () => TurnMetricRepository;
  stats: () => StatsProjectionRepository;
  assets: () => AssetRepository;
}

/**
 * Outbound delivery intents.
 *
 * Ordering, the asset claim, reply sequencing and the `deliveries` revision are
 * all owned here so a retry can never fork an intent or reorder a turn.
 */
export class SqliteDeliveryRepository implements DeliveryRepository {
  private readonly database: SqliteDatabase;
  constructor(private readonly deps: SqliteDeliveryDependencies) {this.database = deps.database;}
  private decode(rows: {json:string;state:DeliveryState}[]): Delivery[] {return rows.map(row => ({...JSON.parse(row.json), state:row.state} as Delivery));}

  deliveries(states?: readonly string[]): Delivery[] {
    const where = states?.length ? ` WHERE state IN (${states.map(() => '?').join(',')})` : '';
    return (this.database.db.prepare(`SELECT json,state FROM deliveries${where} ORDER BY rowid`).all(...(states ?? [])) as {json:string;state:DeliveryState}[]).map(row => ({...JSON.parse(row.json), state:row.state} as Delivery));
  }
  find(id: string, state?: DeliveryState): Delivery | undefined {
    const row = this.database.db.prepare(`SELECT json,state FROM deliveries WHERE id=?${state ? ' AND state=?' : ''}`).get(id, ...(state ? [state] : [])) as {json:string;state:DeliveryState} | undefined;
    return row ? this.decode([row])[0] : undefined;
  }
  findByAsset(scopeKey: string, assetId: string, states?: readonly DeliveryState[]): readonly Delivery[] {
    const selected = states?.length ? states : ['pending', 'sending', 'unknown', 'failed', 'sent'] as const;
    if (!selected.length) return [];
    const placeholders = selected.map(() => '?').join(',');
    return this.decode(this.database.db.prepare(`SELECT json,state FROM deliveries WHERE scope=? AND json_extract(json,'$.output.type')='asset' AND json_extract(json,'$.output.assetId')=? AND state IN (${placeholders}) ORDER BY created_at,id`).all(scopeKey, assetId, ...selected) as {json:string;state:DeliveryState}[]);
  }
  nextSendable(botId: string, limit: number): readonly Delivery[] {
    return this.decode(this.database.db.prepare(`SELECT json,state FROM deliveries pending WHERE bot_id=? AND state='pending' AND NOT EXISTS(SELECT 1 FROM deliveries blocker WHERE blocker.scope=pending.scope AND blocker.turn_id=pending.turn_id AND blocker.output_index<pending.output_index AND blocker.state IN ('pending','sending')) ORDER BY created_at,id LIMIT ?`).all(botId, limit) as {json:string;state:DeliveryState}[]);
  }
  pendingBotIds(): readonly string[] {
    return (this.database.db.prepare("SELECT DISTINCT bot_id id FROM deliveries WHERE state='pending' AND bot_id<>''").all() as {id:string}[]).map(row => row.id);
  }
  hasEarlierBlocker(delivery: Delivery): boolean {
    return !!this.database.db.prepare("SELECT 1 FROM deliveries WHERE scope=? AND turn_id=? AND output_index<? AND state IN ('pending','sending') LIMIT 1").get(delivery.scopeKey, delivery.turnId, delivery.index);
  }
  count(states: readonly string[]): number {
    return Number((this.database.db.prepare(`SELECT COUNT(*) count FROM deliveries WHERE state IN (${states.map(() => '?').join(',')})`).get(...states) as {count:number|bigint}).count);
  }
  pendingCount(): number {return this.count(['pending', 'sending']);}
  pageDeliveries(request: DeliveryPageRequest): Page<Delivery> {
    const revision = this.database.revision('deliveries'), fingerprint = filterHash(request.filter), cursor = decodeCursor(request.cursor, 'deliveries', fingerprint, revision), conditions: string[] = [], params: Array<string|number> = [];
    if (request.filter.scopeKey) { conditions.push('scope=?'); params.push(request.filter.scopeKey); }
    if (request.filter.botId) { conditions.push('bot_id=?'); params.push(request.filter.botId); }
    if (request.filter.states?.length) { conditions.push(`state IN (${request.filter.states.map(() => '?').join(',')})`); params.push(...request.filter.states); }
    if (cursor) { conditions.push('(created_at<? OR (created_at=? AND id<?))'); params.push(cursor.time, cursor.time, cursor.id); }
    const rows = this.decode(this.database.db.prepare(`SELECT json,state FROM deliveries${conditions.length ? ' WHERE ' + conditions.join(' AND ') : ''} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...params, request.limit + 1) as {json:string;state:DeliveryState}[]);
    const more = rows.length > request.limit, items = rows.slice(0, request.limit), last = items.at(-1);
    return {items, nextCursor:more && last ? encodeCursor({v:1, collection:'deliveries', filter:fingerprint, revision, time:last.createdAt ?? 0, id:last.id}) : null, revision:`deliveries:${revision}`};
  }
  enqueue(binding: SessionBinding, sourceId: string, turnId: string, outputs: readonly Output[], reply: Readonly<Record<string, string>>, replyEnvelope?: ChannelReplyEnvelope, progress?: NonNullable<Delivery['progress']>, snapshot?: TurnSnapshot): void {
    // SAVEPOINT also works inside the foreground completion transaction.
    this.database.savepoint('enqueue_delivery', () => {
      if (!progress) this.deps.metrics().updateTurnMetrics(binding.key, [sourceId], {sessionId:binding.sessionId, turnId});
      // Asset registration is a durable claim.  A later turn may mention the
      // same generated asset again, but it must not create a second intent after
      // the first one was accepted, is still unresolved, or needs explicit
      // recovery.  `resend` is the deliberate escape hatch for a new intent.
      const claimedAssetIds = new Set((this.database.db.prepare("SELECT json_extract(json,'$.output.assetId') assetId FROM deliveries WHERE scope=? AND state IN ('pending','sending','unknown','failed','sent') AND json_extract(json,'$.output.type')='asset'").all(binding.key) as {assetId:string|null}[]).map(row => row.assetId).filter((id): id is string => !!id));
      outputs.forEach((output, index) => {
        if (output.type === 'asset' && output.assetId && !output.resend) {
          if (claimedAssetIds.has(output.assetId)) return;
          claimedAssetIds.add(output.assetId);
        }
        const id = createHash('sha256').update(JSON.stringify([binding.key, binding.sessionId, sourceId, turnId, index])).digest('hex');
        if (this.find(id)) return;
        const replySequence = binding.scope.platform === 'qq' ? this.nextReplySequence(binding.scope.botId, replyEnvelope?.payload ?? reply) : undefined;
        const now = Date.now();
        const referencedAsset = output.type === 'asset' && output.assetId ? this.deps.assets().findAsset(output.assetId) : undefined;
        const assetServiceSnapshot = referencedAsset?.scopeKey === binding.key ? referencedAsset.serviceSnapshot : undefined;
        const serviceSnapshots = assetServiceSnapshot ? [assetServiceSnapshot] : [];
        const delivery: Delivery = {...(progress ? {purpose:'progress' as const, progress} : {}), ...(replySequence === undefined ? {} : {replySequence}), id, scopeKey:binding.key, botId:binding.scope.botId, sessionId:binding.sessionId, sessionGeneration:binding.generation, sourceId, turnId, index, output, reply, ...replyEnvelope ? {replyEnvelope} : {}, ...snapshot ? {turnContext:{personaId:snapshot.personaId, personaRevision:snapshot.personaRevision, trusted:snapshot.trusted, serviceSnapshots}} : {}, state:'pending', createdAt:now, updatedAt:now};
        const inserted = this.database.db.prepare('INSERT OR IGNORE INTO deliveries(id,scope,json,state,created_at,bot_id,turn_id,output_index) VALUES(?,?,?,?,?,?,?,?)').run(id, binding.key, JSON.stringify(delivery), 'pending', now, delivery.botId, delivery.turnId, delivery.index).changes === 1;
        if (inserted) {
          this.deps.stats().observeDelivery(delivery);
          this.database.bump('deliveries');
        }
      });
    });
  }
  private nextReplySequence(botId: string, reply: Readonly<Record<string, string>>): number {
    const key = JSON.stringify([botId, reply.kind, reply.target, reply.msgId]);
    let previous = this.database.records.get<number>('reply-sequence', key);
    if (previous === undefined) {
      const row = this.database.db.prepare("SELECT MAX(COALESCE(json_extract(json,'$.replySequence'),output_index+1)) value FROM deliveries WHERE bot_id=? AND COALESCE(json_extract(json,'$.replyEnvelope.payload.kind'),json_extract(json,'$.reply.kind'))=? AND COALESCE(json_extract(json,'$.replyEnvelope.payload.target'),json_extract(json,'$.reply.target'))=? AND COALESCE(json_extract(json,'$.replyEnvelope.payload.msgId'),json_extract(json,'$.reply.msgId'))=?").get(botId, reply.kind ?? '', reply.target ?? '', reply.msgId ?? '') as {value:number|null};
      previous = row.value ?? 0;
    }
    const next = previous + 1;
    this.database.records.put('reply-sequence', key, next);
    return next;
  }
  retry(id: string): Delivery | undefined {
    const row = this.database.db.prepare('SELECT json,state FROM deliveries WHERE id=?').get(id) as {json:string;state:DeliveryState} | undefined;
    if (!row || !['unknown', 'failed'].includes(row.state)) return;
    const current = {...JSON.parse(row.json), state:row.state} as Delivery;
    if (current.purpose === 'progress') throw new Error('PROGRESS_DELIVERY_EXPIRED');
    const next: Delivery = {...current, state:'pending', receipt:undefined, error:undefined, sentAt:undefined, updatedAt:Date.now()};
    const changed = this.database.db.prepare("UPDATE deliveries SET json=?,state=? WHERE id=? AND state IN ('unknown','failed')").run(JSON.stringify(next), 'pending', id).changes;
    if (!changed) return this.find(id);
    this.deps.stats().observeDelivery(next);
    this.database.bump('deliveries');
    return next;
  }
  deliveryState(delivery: Delivery, state: DeliveryState, receipt?: string, error?: string): void {
    const now = Date.now(), next = {...delivery, state, receipt, error, updatedAt:now, ...(state === 'sent' ? {sentAt:now} : {})};
    this.database.db.prepare('UPDATE deliveries SET json=?,state=? WHERE id=?').run(JSON.stringify(next), state, delivery.id);
    this.deps.stats().observeDelivery(next);
    this.database.bump('deliveries');
  }
  /** Recovery transition: in-flight sends become explicitly unknown. */
  unknownSending(): void {this.database.db.exec("UPDATE deliveries SET state='unknown' WHERE state='sending'");}
  delete(id: string): number {return Number(this.database.db.prepare('DELETE FROM deliveries WHERE id=?').run(id).changes);}
  deleteScope(scope: string): void {this.database.db.prepare('DELETE FROM deliveries WHERE scope=?').run(scope);}
  deleteBot(botId: string): void {this.database.db.prepare('DELETE FROM deliveries WHERE bot_id=?').run(botId);}
  /** Retained rows for scheduled cleanup. */
  stale(before: number): readonly Delivery[] {
    return this.deliveries().filter(delivery => (delivery.updatedAt ?? delivery.createdAt ?? 0) < before && ['sent', 'failed', 'cancelled', 'unknown'].includes(delivery.state));
  }
}
