import type {EvolutionRepository, ContentChangeRecord, EvolutionTask} from '../../core/ports/evolution.js';
import type {SqliteDatabase} from './database.js';

/** Self-evolution journal and persona/skill content changes. */
export class SqliteEvolutionRepository implements EvolutionRepository {
  constructor(readonly database: SqliteDatabase) {}
  get home(): string {return this.database.home;}
  evolutionTasks(): EvolutionTask[] {return this.database.records.list<EvolutionTask>('evolution');}
  saveEvolutionTask(id: string, value: EvolutionTask): void {this.database.records.put('evolution', id, value);}
  contentChanges(): ContentChangeRecord[] {return this.database.records.list<ContentChangeRecord>('evolution-content');}
  findContentChange(id: string): ContentChangeRecord | undefined {return this.database.records.get<ContentChangeRecord>('evolution-content', id);}
  saveContentChange(id: string, value: ContentChangeRecord): void {this.database.records.put('evolution-content', id, value);}
}
