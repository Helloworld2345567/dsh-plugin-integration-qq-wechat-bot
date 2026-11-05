import type {Asset} from '../types.js';
import type {MediaUsageCall} from '../usage.js';
import type {MusicAcquisition, MusicCandidate, MusicCandidates} from '../music-state.js';
import type {SingingAttempt, SingingCandidate, SingingCandidates} from '../singing-state.js';

export interface AssetUsage {
  scope: number;
  total: number;
}

/** Registered inbound and generated media, owned by one channel identity. */
export interface AssetRepository {
  saveAsset(asset: Asset): void;
  asset(scope: string, id: string): Asset;
  findAsset(id: string): Asset | undefined;
  recentAssets(scope: string, sessionId: string, kind?: string, limit?: number): Asset[];
  assetUsage(scope: string): AssetUsage;
  deleteAsset(scope: string, id: string): void;
  allAssets(): Asset[];
  countAssets(): number;
  /** Rebuild the query index from the durable asset records. */
  reindex(asset: Asset): void;
}

export type MediaJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export interface MediaJobRecord {
  readonly id: string;
  readonly scope?: string;
  readonly botId?: string;
  readonly state?: MediaJobState | string;
  readonly provider?: string;
  readonly requestedModel?: string;
  readonly modelCalls?: readonly MediaUsageCall[];
  readonly directory?: string;
  readonly workspace?: string;
  readonly [key: string]: unknown;
}

export interface MediaJobRepository {
  jobs(): readonly MediaJobRecord[];
  findJob(id: string): MediaJobRecord | undefined;
  saveJob(id: string, value: unknown): void;
  patchJob(id: string, patch: Readonly<Record<string, unknown>>): MediaJobRecord;
  countJobs(): number;
}

/** Durable per-key daily media quota.  The adapter owns the atomic check-and-increment. */
export interface MediaQuotaRepository {
  consume(key: string, limit: number): void;
}

/** Session-bound music candidates and acquisition state. */
export interface MusicStateRepository {
  candidates(scope: string): MusicCandidates | null | undefined;
  saveCandidates(scope: string, value: MusicCandidates): void;
  acquisition(scope: string): MusicAcquisition | null | undefined;
  saveAcquisition(scope: string, value: MusicAcquisition): void;
  clear(scope: string): void;
}

/** Session-bound singing candidates and attempt state. */
export interface SingingStateRepository {
  candidates(scope: string): SingingCandidates | null | undefined;
  saveCandidates(scope: string, value: SingingCandidates | null): void;
  attempt(scope: string): SingingAttempt | null | undefined;
  saveAttempt(scope: string, value: SingingAttempt): void;
}

/** Operator-editable voice model library settings.  Values are validated by the caller. */
export interface VoiceLibrarySettingsRepository {
  read(): unknown;
  write(settings: unknown): void;
}

export type {MusicCandidate, MusicCandidates, MusicAcquisition, SingingCandidate, SingingCandidates, SingingAttempt};
