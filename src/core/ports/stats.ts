import type {BotInstance, Delivery, InboundMessage} from '../types.js';
import type {StatsQueryInput, StatsResult, GroupObservation, GroupRecord} from '../stats.js';
import type {TokenUsage, UsageKind, MediaUsageCall, StatsSessionOwner, NativeUsageFact, AuxiliaryUsageCall} from '../usage.js';

export interface StatsProjectionCall {
  id: string;
  botId: string;
  provider: string;
  model: string;
  kind: UsageKind;
  at: number;
  usage?: TokenUsage;
}

/**
 * Read/write surface of the usage and message projection.  Projection tables
 * are derived data: rebuilding them never changes the authoritative records.
 */
export interface StatsProjectionRepository {
  collectionStartedAt(): number;
  initializeCoverage(at: number): void;
  observeSession(sessionId: string, botId: string, rootSessionId: string, kind: UsageKind): void;
  sessionOwner(sessionId: string): {sessionId: string; botId: string; rootSessionId: string; kind: UsageKind} | undefined;
  replaceUsageCalls(ownerKey: string, calls: readonly StatsProjectionCall[]): void;
  hasUsageCall(id: string): boolean;
  upsertUsageCall(call: StatsProjectionCall): void;
  upsertMediaCalls(jobId: string, botId: string, calls: readonly MediaUsageCall[]): void;
  observeReceived(message: InboundMessage): void;
  observeDelivery(delivery: Delivery): void;
  observeGroup(input: GroupObservation): void;
  importGroup(record: GroupRecord): void;
  query(input: StatsQueryInput, status: ReadonlyMap<string, string> | Record<string, string>, bots: readonly BotInstance[], channelGroupSupport: (id: string) => 'unsupported' | 'observed_only', now: number): StatsResult;
}

/** Durable statistics facts plus the derived projection they feed. */
export interface StatsDataPort {
  projection: StatsProjectionRepository;
  getSessionOwner(sessionId: string): StatsSessionOwner | undefined;
  putSessionOwner(owner: StatsSessionOwner): void;
  putNativeFact(id: string, fact: NativeUsageFact): boolean;
  listNativeFacts(sessionId: string): readonly NativeUsageFact[];
  getAuxiliaryUsage(id: string): {usage?: TokenUsage} | undefined;
  putAuxiliaryUsage(id: string, value: AuxiliaryUsageCall & {sessionId: string; usage?: TokenUsage}): boolean;
  listAuxiliaryUsage(sessionId: string): readonly (AuxiliaryUsageCall & {sessionId: string; usage?: TokenUsage})[];
  listSessionOwners(): readonly StatsSessionOwner[];
  observeGroup(input: GroupObservation, now: number): GroupRecord | undefined;
  migrateLegacy(): void;
}

/** Per-session start position of the native usage journal. */
export interface StatsSessionRepository {
  sessionExists(id: string): boolean;
  ownedStart(id: string): number;
  saveOwnedStart(id: string, value: number): void;
  listOwners(): readonly StatsSessionOwner[];
}
