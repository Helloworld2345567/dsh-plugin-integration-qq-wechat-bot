import type {BotConfig, SessionBinding} from '../types.js';

export type PersonaFilesState = 'synced' | 'draft' | 'error';

export interface PersonaStatus {
  id: string;
  directory: string;
  state: PersonaFilesState;
  error?: string;
}

export interface PersonaDraft {
  config: BotConfig;
  digest: string;
}

/**
 * Applied persona configurations and their immutable revisions.  Editable
 * drafts live in the persona file port; SQLite keeps the applied revision.
 */
export interface PersonaConfigRepository {
  configs(): BotConfig[];
  config(id: string): BotConfig;
  findConfig(id: string): BotConfig | undefined;
  configVersions(): readonly BotConfig[];
  configVersion(personaId: string, revision: number): BotConfig | undefined;
  saveConfig(input: unknown, expectedRevision?: number, fileDigest?: string): BotConfig;
  effectiveConfig(binding: SessionBinding): BotConfig;
  personaStatus(id: string): PersonaStatus;
  personaDirectory(id?: string): string;
  personaRoot(): string;
  readPersonaDraft(id: string): PersonaDraft;
  countConfigs(): number;
}
