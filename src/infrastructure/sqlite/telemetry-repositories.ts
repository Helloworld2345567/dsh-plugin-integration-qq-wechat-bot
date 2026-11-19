import type {TurnMetric, TurnSnapshot} from '../../core/types.js';
import type {FailureRecord, InboxLatency, MetricPercentiles, SessionActionRecord, SessionActionRepository, TurnMetricRepository, TurnSnapshotRepository, FailureRepository, TurnStageField} from '../../core/ports/telemetry.js';
import type {SqliteDatabase} from './database.js';

/** Per-turn timing metrics; ownership fields never change after creation. */
export class SqliteTurnMetricRepository implements TurnMetricRepository {
  constructor(private readonly database: SqliteDatabase) {}
  findTurnMetric(id: string): TurnMetric | undefined {return this.database.records.get<TurnMetric>('turn-metric', id);}
  turnMetrics(): TurnMetric[] {return this.database.records.list<TurnMetric>('turn-metric');}
  updateTurnMetric(id: string, patch: Partial<Omit<TurnMetric, 'id'>>): void {
    const previous = this.findTurnMetric(id), next = {...previous, ...patch, id} as TurnMetric;
    if (!next.scopeKey || !next.sourceId || !Number.isSafeInteger(next.receivedAt)) throw new Error('TURN_METRIC_INVALID');
    if (previous && (previous.scopeKey !== next.scopeKey || previous.sourceId !== next.sourceId || previous.receivedAt !== next.receivedAt)) throw new Error('TURN_METRIC_OWNERSHIP_MISMATCH');
    this.database.records.put('turn-metric', id, next);
  }
  updateTurnMetrics(scope: string, sourceIds: readonly string[], patch: Partial<Omit<TurnMetric, 'id'>>): void {
    for (const sourceId of sourceIds) {
      const id = `inbox:${scope}:${sourceId}`;
      if (this.findTurnMetric(id)) this.updateTurnMetric(id, patch);
    }
  }
  recordDeliveryStage(scope: string, sessionId: string, turnId: string, stage: 'sending' | 'sent', at: number): void {
    const update = stage === 'sending'
      ? "json_insert(json,'$.deliveryStartedAt',?)"
      : "json_set(json_insert(json,'$.firstSentAt',?),'$.sentAt',?)";
    this.database.db.prepare(`UPDATE records SET json=${update}
      WHERE kind='turn-metric' AND json_extract(json,'$.scopeKey')=? AND json_extract(json,'$.sessionId')=? AND json_extract(json,'$.turnId')=?`)
      .run(...(stage === 'sending' ? [at] : [at, at]), scope, sessionId, turnId);
  }
  markTurnStage(scope: string, ids: readonly string[], field: TurnStageField, at = Date.now()): void {
    for (const sourceId of ids) {
      const id = `inbox:${scope}:${sourceId}`;
      if (this.findTurnMetric(id)) this.updateTurnMetric(id, {[field]:at});
    }
  }
  inboxLatency(): InboxLatency {
    const rows = this.database.db.prepare(`SELECT json_extract(json,'$.receivedAt') receivedAt,
      json_extract(json,'$.modelStartedAt') modelStartedAt, json_extract(json,'$.modelFirstChunkAt') modelFirstChunkAt,
      json_extract(json,'$.modelFirstTextAt') modelFirstTextAt, json_extract(json,'$.firstSentAt') firstSentAt, json_extract(json,'$.sentAt') sentAt
      FROM records WHERE kind='turn-metric'`).all();
    const now = Date.now();
    const summarize = (field: TurnStageField): MetricPercentiles => {
      const values: number[] = [];
      for (const row of rows) {
        const start=row.receivedAt, end=row[field];
        if (typeof start==='number' && typeof end==='number' && start>=0 && end>=start && end<=now) values.push(end-start);
      }
      values.sort((a,b)=>a-b);
      const percentile=(rank:number)=>values[Math.ceil(values.length*rank)-1]??null;
      return {count:values.length,p50:percentile(.5),p95:percentile(.95),max:values.at(-1)??null};
    };
    return {inboxToModel:summarize('modelStartedAt'),inboxToFirstModelChunk:summarize('modelFirstChunkAt'),inboxToFirstModelText:summarize('modelFirstTextAt'),inboxToFirstSent:summarize('firstSentAt'),inboxToSent:summarize('sentAt')};
  }
  deleteMetric(id: string): number {return Number(this.database.db.prepare("DELETE FROM records WHERE kind='turn-metric' AND id=?").run(id).changes);}
}

/** Frozen per-turn configuration snapshots. */
export class SqliteTurnSnapshotRepository implements TurnSnapshotRepository {
  constructor(private readonly database: SqliteDatabase) {}
  findTurnSnapshot(id: string): TurnSnapshot | undefined {return this.database.records.get<TurnSnapshot>('turn-snapshot', id);}
  saveTurnSnapshot(id: string, value: TurnSnapshot): void {this.database.records.put('turn-snapshot', id, value);}
}

/** Failure journal used only to explain a later turn's context. */
export class SqliteFailureRepository implements FailureRepository {
  constructor(private readonly database: SqliteDatabase) {}
  failures(): readonly FailureRecord[] {return this.database.records.list<FailureRecord>('failure');}
  saveFailure(id: string, value: unknown): void {this.database.records.put('failure', id, value);}
  countFailures(): number {return this.database.records.count('failure');}
  entries(): {id:string;json:string}[] {return this.database.db.prepare("SELECT id,json FROM records WHERE kind='failure'").all() as {id:string;json:string}[];}
  delete(id: string): number {return Number(this.database.db.prepare("DELETE FROM records WHERE kind='failure' AND id=?").run(id).changes);}
}

/** Deferred management actions. */
export class SqliteSessionActionRepository implements SessionActionRepository {
  constructor(private readonly database: SqliteDatabase) {}
  sessionActions<T extends SessionActionRecord = SessionActionRecord>(): T[] {return this.database.records.list<T>('session-action');}
  findSessionAction<T extends SessionActionRecord = SessionActionRecord>(id: string): T | undefined {return this.database.records.get<T>('session-action', id);}
  saveSessionAction(id: string, value: SessionActionRecord): void {this.database.records.put('session-action', id, value);}
  countSessionActions(): number {return this.database.records.count('session-action');}
}
