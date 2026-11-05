import type {Asset} from '../types.js';
import type {MediaUsageCall} from '../usage.js';

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

export interface MusicCandidate {source:string;id:string;title:string;artist:string;album?:string;duration?:number;format?:string;size?:number;version?:string;locator?:unknown}
export interface MusicCandidates {id:string;scope:string;sessionId:string;generation:number;candidates:MusicCandidate[];createdAt:number}
export interface MusicAcquisition {scope:string;sessionId:string;generation:number;request:string;selectionKey:string;state:'running'|'succeeded'|'failed';sourceAssetId?:string;lyricAssetId?:string;track?:MusicCandidate;deliveryState?:'running'|'succeeded'|'failed';deliveryAssetIds?:string[];deliveryCode?:string;code?:string}

/** Session-bound music candidates and acquisition state. */
export interface MusicStateRepository {
  candidates(scope: string): MusicCandidates | null | undefined;
  saveCandidates(scope: string, value: MusicCandidates): void;
  acquisition(scope: string): MusicAcquisition | null | undefined;
  saveAcquisition(scope: string, value: MusicAcquisition): void;
  clear(scope: string): void;
}

export interface SingingCandidate {number:number;title:string;assetId?:string;url?:string;source?:string;license?:string}
export interface SingingCandidates {id:string;scope:string;sessionId:string;generation:number;waiting:boolean;candidates:SingingCandidate[];createdAt:number}
export interface SingingAttempt {request:string;state:'running'|'succeeded'|'failed';assetIds?:string[];code?:string;format?:string;music?:{selectionKey:string;track:MusicCandidate}}

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
