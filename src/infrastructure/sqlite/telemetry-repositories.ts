import type {TurnMetric, TurnSnapshot} from '../../core/types.js';
import type {FailureRecord, MetricPercentiles, SessionActionRecord, SessionActionRepository, TurnMetricRepository, TurnSnapshotRepository, FailureRepository, TurnStageField} from '../../core/ports/telemetry.js';
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
  updateTurnMetricsByTurn(scope: string, turnId: string, patch: Partial<Omit<TurnMetric, 'id'>>): void {
    for (const metric of this.turnMetrics()) if (metric.scopeKey === scope && metric.turnId === turnId) this.updateTurnMetric(metric.id, patch);
  }
  markTurnStage(scope: string, ids: readonly string[], field: TurnStageField, at = Date.now()): void {
    for (const sourceId of ids) {
      const id = `inbox:${scope}:${sourceId}`;
      if (this.findTurnMetric(id)) this.updateTurnMetric(id, {[field]:at});
    }
  }
  metricPercentiles(field: TurnStageField, from = 0, to = Date.now()): MetricPercentiles {
    const values = this.turnMetrics().map(metric => {
      const start = metric.receivedAt, end = metric[field];
      return typeof end === 'number' && start >= from && end <= to ? end - start : undefined;
    }).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
    const percentile = (rank: number) => values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * rank) - 1)] : null;
    return {count:values.length, p50:percentile(.5), p95:percentile(.95), max:values.at(-1) ?? null};
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
