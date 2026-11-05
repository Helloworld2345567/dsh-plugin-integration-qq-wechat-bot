import type {CallerScope} from '../types.js';

export type AutomationKind = 'scheduled' | 'proactive';
export type AutomationState = 'active' | 'paused' | 'blocked' | 'failed' | 'completed';

export interface ProactiveConfig {
  id: string; kind: 'proactive'; botId: string; scopeKey: string; scope: CallerScope;
  enabled: boolean; timezone: string; dailyLimit: number; quietFrom: string; quietTo: string;
  minIntervalMinutes: number; cooldownMinutes: number; allowWeb: boolean; maxLength: number;
  failureStopsDay: boolean; nextAt?: number; createdAt: number; updatedAt: number;
}
export interface ScheduledJob {
  id: string; kind: 'scheduled'; botId: string; scopeKey: string; scope: CallerScope;
  enabled: boolean; timezone: string; prompt: string; runAt?: number; intervalMs?: number; dailyAt?: string;
  nextAt?: number; state: AutomationState; createdAt: number; updatedAt: number;
}
export interface AutomationRun {
  id: string; automationId: string; kind: AutomationKind; scopeKey: string; scheduledAt: number; startedAt: number;
  finishedAt?: number; state: 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';
  error?: string; turnId?: string;
}

/** Proactive configurations, scheduled jobs and their execution journal. */
export interface AutomationRepository {
  listProactive(): ProactiveConfig[];
  findProactive(id: string): ProactiveConfig | undefined;
  findProactiveByScope(scopeKey: string): ProactiveConfig | undefined;
  saveProactive(config: ProactiveConfig): void;
  listJobs(): ScheduledJob[];
  findJob(id: string): ScheduledJob | undefined;
  findJobByScope(scopeKey: string): ScheduledJob | undefined;
  saveJob(job: ScheduledJob): void;
  deleteJob(id: string): void;
  listRuns(kind: AutomationKind): AutomationRun[];
  findRun(kind: AutomationKind, id: string): AutomationRun | undefined;
  saveRun(kind: AutomationKind, run: AutomationRun): void;
}
