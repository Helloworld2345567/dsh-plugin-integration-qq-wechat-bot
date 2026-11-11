import type {BotRepository} from './bot.js';
import type {PersonaConfigRepository} from './persona.js';
import type {BindingRepository, SessionRepository} from './session.js';
import type {InboxRepository} from './inbox.js';
import type {MemoryRepository} from './memory.js';
import type {AssetRepository, MediaJobRepository, MediaQuotaRepository, MusicStateRepository, SingingStateRepository} from './media.js';
import type {DeliveryRepository} from './delivery.js';
import type {AutomationRepository} from './automation.js';
import type {EvolutionRepository} from './evolution.js';
import type {FailureRepository, SessionActionRepository, TurnMetricRepository, TurnSnapshotRepository} from './telemetry.js';
import type {StatsDataPort, StatsSessionRepository} from './stats.js';
import type {CapabilityAcceptanceRepository} from './service.js';
import type {HistoryLocationRepository, WorkspacePort} from './workspace.js';
import type {StorageLocation, UnitOfWork} from './common.js';
import type {BotHistorySnapshot} from './bot-history.js';

export interface RetentionResult {
  inbox: number;
  delivery: number;
  metric: number;
  failure: number;
}

/** Runtime ownership, crash recovery and retention of completed work. */
export interface RuntimeLifecyclePort {
  claim(owner: string): void;
  release(owner: string): void;
  recover(): void;
  retain(now?: number, windows?: {inbox:number;delivery:number;metric:number;failure:number}): RetentionResult;
}

/** Readable chat history beside the native compressed session log. */
export interface ChatHistoryPort {
  write(scope: string, sessionId: string, events: readonly unknown[]): Promise<void>;
}

/** Scope-owned history deletion for one bot; never touches another bot. */
export interface BotHistoryPort {
  snapshot(botId: string): BotHistorySnapshot;
  deleteFiles(assetsRoot: string, snapshot: BotHistorySnapshot): Promise<void>;
  deleteRecords(botId: string, snapshot: BotHistorySnapshot): void;
  deleteSessionFiles(scope: string, sessionIds: readonly string[]): Promise<void>;
  deleteSessionRecords(scope: string, sessionIds: readonly string[]): void;
}

export interface MediaRepositories {
  assets: AssetRepository;
  jobs: MediaJobRepository;
  quota: MediaQuotaRepository;
  music: MusicStateRepository;
  singing: SingingStateRepository;
}

/** Dependencies of the proactive and scheduled automation scheduler. */
export type AutomationRepositories = Pick<RuntimeRepositories,'automation'|'sessions'|'bots'|'inbox'|'deliveries'|'telemetry'>;

/** Dependencies of the durable outbox worker. */
export type DeliveryWorkerRepositories = Pick<RuntimeRepositories,'deliveries'|'sessions'|'bots'|'personas'|'media'|'telemetry'>;

export interface TelemetryRepositories {
  metrics: TurnMetricRepository;
  snapshots: TurnSnapshotRepository;
  failures: FailureRepository;
  actions: SessionActionRepository;
}

/**
 * The explicit dependency bundle of the channel runtime and of the services it
 * drives.  Every field is a narrow port; the composition root wires adapters.
 */
export interface RuntimeRepositories {
  readonly storage: StorageLocation;
  readonly unitOfWork: UnitOfWork;
  readonly lifecycle: RuntimeLifecyclePort;
  readonly bots: BotRepository;
  readonly personas: PersonaConfigRepository;
  readonly sessions: SessionRepository & BindingRepository;
  readonly inbox: InboxRepository;
  readonly memory: MemoryRepository;
  readonly media: MediaRepositories;
  readonly deliveries: DeliveryRepository;
  readonly automation: AutomationRepository;
  readonly evolution: EvolutionRepository;
  readonly telemetry: TelemetryRepositories;
  readonly stats: StatsDataPort;
  readonly statsSessions: StatsSessionRepository;
  readonly capabilities: CapabilityAcceptanceRepository;
  readonly historyLocations: HistoryLocationRepository;
  readonly chatHistory: ChatHistoryPort;
  readonly workspace: WorkspacePort;
  readonly botHistory: BotHistoryPort;
}

/** The subset needed by the model-facing feature service. */
export interface FeatureRepositories {
  readonly bots: BotRepository;
  readonly personas: PersonaConfigRepository;
  readonly sessions: SessionRepository & BindingRepository;
  readonly evolution: EvolutionRepository;
  readonly stats: StatsDataPort;
}
