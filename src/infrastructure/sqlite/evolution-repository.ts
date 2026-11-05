import type {EvolutionRepository, ContentChangeRecord, EvolutionTask} from '../../core/ports/evolution.js';
import type {SqliteDatabase} from './database.js';

/** Self-evolution journal and persona/skill content changes. */
export class SqliteEvolutionRepository implements EvolutionRepository {
  constructor(readonly database: SqliteDatabase) {}
  get home(): string {return this.database.home;}
  evolutionTasks(): EvolutionTask[] {return this.database.records.list<EvolutionTask>('evolution');}
  saveEvolutionTask(id: string, value: EvolutionTask): void {this.database.records.put('evolution', id, value);}
  contentChanges<T extends ContentChangeRecord = ContentChangeRecord>(): T[] {return this.database.records.list<T>('evolution-content');}
  findContentChange<T extends ContentChangeRecord = ContentChangeRecord>(id: string): T | undefined {return this.database.records.get<T>('evolution-content', id);}
  saveContentChange(id: string, value: ContentChangeRecord): void {this.database.records.put('evolution-content', id, value);}
}
