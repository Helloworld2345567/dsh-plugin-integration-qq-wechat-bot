import type {AutomationKind, AutomationRepository, AutomationRun, ProactiveConfig, ScheduledJob} from '../../core/ports/automation.js';
import type {SqliteDatabase} from './database.js';

const runKind = (kind: AutomationKind) => kind === 'proactive' ? 'proactive-run' : 'job-run';

/** Proactive configurations, scheduled jobs and their execution journal. */
export class SqliteAutomationRepository implements AutomationRepository {
  constructor(private readonly database: SqliteDatabase) {}
  listProactive(): ProactiveConfig[] {return this.database.records.list<ProactiveConfig>('proactive-config');}
  findProactive(id: string): ProactiveConfig | undefined {return this.database.records.get<ProactiveConfig>('proactive-config', id);}
  findProactiveByScope(scopeKey: string): ProactiveConfig | undefined {return this.listProactive().find(config => config.scopeKey === scopeKey);}
  saveProactive(config: ProactiveConfig): void {this.database.records.put('proactive-config', config.id, config);}
  listJobs(): ScheduledJob[] {return this.database.records.list<ScheduledJob>('scheduled-job');}
  findJob(id: string): ScheduledJob | undefined {return this.database.records.get<ScheduledJob>('scheduled-job', id);}
  findJobByScope(scopeKey: string): ScheduledJob | undefined {return this.listJobs().find(job => job.scopeKey === scopeKey);}
  saveJob(job: ScheduledJob): void {this.database.records.put('scheduled-job', job.id, job);}
  deleteJob(id: string): void {this.database.records.delete('scheduled-job', id);}
  listRuns(kind: AutomationKind): AutomationRun[] {return this.database.records.list<AutomationRun>(runKind(kind));}
  findRun(kind: AutomationKind, id: string): AutomationRun | undefined {return this.database.records.get<AutomationRun>(runKind(kind), id);}
  saveRun(kind: AutomationKind, run: AutomationRun): void {this.database.records.put(runKind(kind), run.id, run);}
  countRuns(): number {return this.database.records.count('job-run') + this.database.records.count('proactive-run');}
}
