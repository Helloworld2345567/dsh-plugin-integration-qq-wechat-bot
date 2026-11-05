import type {EvolutionTask} from '../../../packages/bot-lifecycle/src/contract/evolution-contract.js';
import type {BotConfig} from '../types.js';

export interface ContentChangeRecord {
  id: string;
  kind: 'persona' | 'skill' | 'reload';
  scopeKey: string;
  configId: string;
  goal: string;
  before: BotConfig;
  after?: BotConfig;
  phase: 'preparing' | 'succeeded' | 'failed' | 'rolled-back';
  createdAt: number;
  updatedAt: number;
  error?: string;
}

/** Self-evolution tasks and persona/skill content changes awaiting confirmation. */
export interface EvolutionRepository {
  readonly home: string;
  evolutionTasks(): EvolutionTask[];
  saveEvolutionTask(id: string, value: EvolutionTask): void;
  contentChanges(): ContentChangeRecord[];
  findContentChange(id: string): ContentChangeRecord | undefined;
  saveContentChange(id: string, value: ContentChangeRecord): void;
}

export type {EvolutionTask};
