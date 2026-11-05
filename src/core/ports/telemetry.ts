import type {TurnMetric, TurnSnapshot} from '../types.js';

export type TurnStageField = Extract<keyof TurnMetric, `${string}At`>;

export interface MetricPercentiles {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

/** Per-turn timing observations used for operator metrics and retention. */
export interface TurnMetricRepository {
  findTurnMetric(id: string): TurnMetric | undefined;
  updateTurnMetric(id: string, patch: Partial<Omit<TurnMetric, 'id'>>): void;
  turnMetrics(): TurnMetric[];
  updateTurnMetrics(scope: string, sourceIds: readonly string[], patch: Partial<Omit<TurnMetric, 'id'>>): void;
  updateTurnMetricsByTurn(scope: string, turnId: string, patch: Partial<Omit<TurnMetric, 'id'>>): void;
  markTurnStage(scope: string, ids: readonly string[], field: TurnStageField, at?: number): void;
  metricPercentiles(field: TurnStageField, from?: number, to?: number): MetricPercentiles;
}

/** Frozen configuration snapshot of one turn. */
export interface TurnSnapshotRepository {
  findTurnSnapshot(id: string): TurnSnapshot | undefined;
  saveTurnSnapshot(id: string, value: TurnSnapshot): void;
}

export interface FailureRecord {
  sessionId?: string;
  scope?: string;
  state?: string;
  stage?: string;
  sourceIds?: readonly string[];
  at?: number;
  code?: string;
}

/** Durable failure journal for retry context, never a retry trigger by itself. */
export interface FailureRepository {
  failures(): readonly FailureRecord[];
  saveFailure(id: string, value: unknown): void;
  countFailures(): number;
}

export interface SessionActionRecord {
  id: string;
  scopeKey: string;
  state: string;
}

/** Deferred management actions that must run outside the native turn. */
export interface SessionActionRepository {
  sessionActions<T extends SessionActionRecord = SessionActionRecord>(): T[];
  findSessionAction<T extends SessionActionRecord = SessionActionRecord>(id: string): T | undefined;
  saveSessionAction(id: string, value: SessionActionRecord): void;
  countSessionActions(): number;
}

export type {TurnMetric, TurnSnapshot};
