/** Long-term user preferences scoped to one channel identity. */
export interface MemoryRecord {
  key: string;
  value: string;
  source: string;
  quote: string;
  version: number;
  updated: number;
}

export interface MemoryRepository {
  remember(scope: string, key: string, value: string, source: string, quote: string): void;
  memories(scope: string): MemoryRecord[];
  correctMemory(scope: string, key: string, value: string, version: number): void;
  forget(scope: string, key: string): void;
  countMemories(): number;
}
