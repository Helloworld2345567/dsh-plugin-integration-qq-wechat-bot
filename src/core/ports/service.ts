import type {MessageDescriptor} from '../../i18n/common.js';
import type {CapabilityAcceptance, ResolvedServiceProfileRevision, ServiceJobState} from '../service-contract.js';

export interface ProfileRecord extends ResolvedServiceProfileRevision {}

/**
 * Immutable service profile revisions.  A revision is never updated in place;
 * a new revision is appended and content hashes bind it to its managed config.
 */
export interface ProfileRepository {
  get(serviceId: string, profileId: string, revision: number): ProfileRecord | undefined;
  latest(serviceId: string, profileId: string): ProfileRecord | undefined;
  list(serviceId?: string): readonly ProfileRecord[];
  save(record: ProfileRecord): void;
}

export interface ServiceInstanceFence {
  serviceId: string;
  state: 'available' | 'blocked_unknown';
  jobId?: string;
  updatedAt: number;
  safeDiagnostic?: string;
  message?:MessageDescriptor;
}

export interface ServiceJobRecord {
  jobId: string;
  serviceId: string;
  operation: string;
  profileId: string;
  profileRevision: number;
  profileContentHash: string;
  idempotencyKey: string;
  state: ServiceJobState;
  createdAt: number;
  updatedAt: number;
}

/** Crash-visible service fence and idempotent job records. */
export interface ServiceStateRepository {
  fence(serviceId: string): ServiceInstanceFence | undefined;
  saveFence(record: ServiceInstanceFence): void;
  job(jobId: string): ServiceJobRecord | undefined;
  findByIdempotency(serviceId: string, idempotencyKey: string): ServiceJobRecord | undefined;
  saveJob(record: ServiceJobRecord): void;
}

export interface CapabilityStatusRecord {
  readonly role?: string;
  readonly configId?: string;
  readonly revision?: number;
  readonly status?: string;
  readonly source?: string;
  readonly updatedAt?: number;
  readonly evidence?: string;
  readonly [key: string]: unknown;
}

/**
 * Operator capability facts bound to an exact persona and profile revision.
 * A stale binding is never silently reused as current evidence.
 */
export interface CapabilityAcceptanceRepository {
  statuses(): readonly CapabilityStatusRecord[];
  saveStatus(id: string, value: CapabilityStatusRecord): void;
  acceptance(key: string): CapabilityAcceptance | undefined;
  findAcceptance(predicate: (record: CapabilityAcceptance) => boolean): CapabilityAcceptance | undefined;
  allAcceptances(): readonly CapabilityAcceptance[];
  saveAcceptance(key: string, record: CapabilityAcceptance): void;
}

export interface ServiceHealthRecord {
  serviceId: string;
  profileId: string;
  profileRevision: number;
  profileContentHash: string;
  state: 'unknown' | 'ready' | 'degraded' | 'unavailable' | 'blocked' | 'disabled';
  checkedAt: number;
  expiresAt: number;
  safeDiagnostic?: string;
  message?:MessageDescriptor;
}

/** Cached health results keyed by an exact profile revision and content hash. */
export interface ServiceHealthRepository {
  health(key: string): ServiceHealthRecord | undefined;
  saveHealth(key: string, record: ServiceHealthRecord): void;
}
