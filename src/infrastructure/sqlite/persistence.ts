import {configForWrite, type BotConfig} from '../../core/types.js';
import {defaultPersonasRoot,sameConfig} from '../../core/personas.js';
import {PersonaFiles} from '../files/persona-files.js';
import {WorkspaceFiles} from '../files/workspace-files.js';
import {BotHistoryService} from '../bot-history.js';
import {SqliteDatabase} from './database.js';
import {initializeSchema} from './schema.js';
import {SqliteStatsProjection} from './stats-projection.js';
import {SqliteStatsData} from './stats-data.js';
import {SqliteStatsSessionRepository} from './stats-session-repository.js';
import {SqliteBotRepository} from './bot-repository.js';
import {SqlitePersonaConfigRepository} from './persona-repository.js';
import {SqliteSessionRepository} from './session-repository.js';
import {SqliteInboxRepository} from './inbox-repository.js';
import {SqliteMemoryRepository} from './memory-repository.js';
import {SqliteAssetRepository} from './asset-repository.js';
import {SqliteMediaJobRepository, SqliteMediaQuotaRepository} from './media-job-repository.js';
import {SqliteDeliveryRepository} from './delivery-repository.js';
import {SqliteAutomationRepository} from './automation-repository.js';
import {SqliteEvolutionRepository} from './evolution-repository.js';
import {SqliteCapabilityRepository} from './capability-repository.js';
import {SqliteProfileRepository} from './profile-repository.js';
import {SqliteServiceStateRepository} from './service-state-repository.js';
import {SqliteRuntimeOwnershipRepository} from './runtime-ownership-repository.js';
import {SqliteChannelCursorRepository} from './channel-cursor-repository.js';
import {SqliteHistoryLocationRepository, SqliteMusicStateRepository, SqliteSingingStateRepository, SqliteVoiceLibrarySettingsRepository} from './session-state-repositories.js';
import {SqliteFailureRepository, SqliteSessionActionRepository, SqliteTurnMetricRepository, SqliteTurnSnapshotRepository} from './telemetry-repositories.js';
import type {RuntimeRepositories} from '../../core/ports/application.js';

export type PersistenceStage = 'opened' | 'initialized' | 'migrated' | 'recovered' | 'started' | 'closed';

export interface PersistenceOptions {
  secureDefaults?: boolean;
  defer?: boolean;
}

/**
 * Composition of the SQLite adapters over one connection.
 *
 * Every adapter joins the same connection and transaction scope, so an
 * operation that spans aggregates stays atomic exactly as before.  Application
 * services receive individual adapters, never this object.
 */
export class SqlitePersistence {
  readonly database: SqliteDatabase;
  readonly personaFiles: PersonaFiles;
  readonly bots: SqliteBotRepository;
  readonly personas: SqlitePersonaConfigRepository;
  readonly sessions: SqliteSessionRepository;
  readonly inbox: SqliteInboxRepository;
  readonly memory: SqliteMemoryRepository;
  readonly assets: SqliteAssetRepository;
  readonly jobs: SqliteMediaJobRepository;
  readonly quota: SqliteMediaQuotaRepository;
  readonly deliveries: SqliteDeliveryRepository;
  readonly automation: SqliteAutomationRepository;
  readonly evolution: SqliteEvolutionRepository;
  readonly capability: SqliteCapabilityRepository;
  readonly profiles: SqliteProfileRepository;
  readonly serviceState: SqliteServiceStateRepository;
  readonly ownership: SqliteRuntimeOwnershipRepository;
  readonly cursors: SqliteChannelCursorRepository;
  readonly history: SqliteHistoryLocationRepository;
  readonly musicState: SqliteMusicStateRepository;
  readonly singingState: SqliteSingingStateRepository;
  readonly voiceLibrarySettings: SqliteVoiceLibrarySettingsRepository;
  readonly turnMetrics: SqliteTurnMetricRepository;
  readonly turnSnapshots: SqliteTurnSnapshotRepository;
  readonly failures: SqliteFailureRepository;
  readonly sessionActions: SqliteSessionActionRepository;
  readonly workspaceFiles: WorkspaceFiles;
  readonly botHistory: BotHistoryService;
  readonly statsSessions: SqliteStatsSessionRepository;
  private stats: SqliteStatsProjection | undefined;
  private statsDataValue: SqliteStatsData | undefined;
  private stage: PersistenceStage = 'opened';

  /** Composition-root entry point: opening allocates the database; later stages own schema and recovery. */
  static open(home: string, personasRoot = defaultPersonasRoot(home), options: {secureDefaults?:boolean} = {}): SqlitePersistence {
    return new SqlitePersistence(home, personasRoot, {...options, defer:true});
  }
  constructor(readonly home: string, personasRoot: string, readonly options: PersistenceOptions = {}) {
    this.database = new SqliteDatabase(home);
    this.personaFiles = PersonaFiles.forHome(home, personasRoot);
    this.bots = new SqliteBotRepository(this.database, () => this.personas);
    this.sessions = new SqliteSessionRepository(this.database);
    this.personas = new SqlitePersonaConfigRepository(this.database, this.personaFiles, () => this.bots, () => this.sessions);
    this.turnMetrics = new SqliteTurnMetricRepository(this.database);
    this.turnSnapshots = new SqliteTurnSnapshotRepository(this.database);
    this.failures = new SqliteFailureRepository(this.database);
    this.sessionActions = new SqliteSessionActionRepository(this.database);
    this.inbox = new SqliteInboxRepository(this.database, () => this.turnMetrics, () => this.projection);
    this.memory = new SqliteMemoryRepository(this.database, () => this.inbox);
    this.assets = new SqliteAssetRepository(this.database);
    this.jobs = new SqliteMediaJobRepository(this.database);
    this.quota = new SqliteMediaQuotaRepository(this.database);
    this.deliveries = new SqliteDeliveryRepository({database:this.database, metrics:() => this.turnMetrics, stats:() => this.projection, assets:() => this.assets});
    this.automation = new SqliteAutomationRepository(this.database);
    this.evolution = new SqliteEvolutionRepository(this.database);
    this.capability = new SqliteCapabilityRepository(this.database);
    this.profiles = new SqliteProfileRepository(this.database);
    this.serviceState = new SqliteServiceStateRepository(this.database);
    this.ownership = new SqliteRuntimeOwnershipRepository(this.database);
    this.cursors = new SqliteChannelCursorRepository(this.database);
    this.history = new SqliteHistoryLocationRepository(this.database);
    this.musicState = new SqliteMusicStateRepository(this.database);
    this.singingState = new SqliteSingingStateRepository(this.database);
    this.voiceLibrarySettings = new SqliteVoiceLibrarySettingsRepository(this.database);
    this.workspaceFiles = new WorkspaceFiles({home, bindings:() => this.sessions, sessions:() => this.sessions, automation:() => this.automation, bots:() => this.bots, history:this.history});
    this.statsSessions = new SqliteStatsSessionRepository(this.database);
    this.botHistory = new BotHistoryService({database:this.database, bots:() => this.bots, inbox:() => this.inbox, deliveries:() => this.deliveries, workspace:() => this.workspaceFiles});
    if (!options.defer) this.initializeStorage(options.secureDefaults === true);
  }

  /** Statistics projection; available only after storage initialization. */
  get projection(): SqliteStatsProjection {
    if (!this.stats) throw new Error('STORE_NOT_INITIALIZED');
    return this.stats;
  }
  get statsData(): SqliteStatsData {
    if (!this.statsDataValue) throw new Error('STORE_NOT_INITIALIZED');
    return this.statsDataValue;
  }
  lifecycleStage(): PersistenceStage {return this.stage;}
  initialize(): this {
    if (this.stage === 'closed') throw new Error('STORE_CLOSED');
    if (this.stage === 'opened') this.initializeStorage(this.options.secureDefaults === true);
    return this;
  }
  migrate(): this {
    this.initialize();
    if (this.stage !== 'closed') this.stage = 'migrated';
    return this;
  }
  start(): this {
    if (this.stage === 'closed') throw new Error('STORE_CLOSED');
    this.stage = 'started';
    return this;
  }
  close(): void {
    if (this.stage === 'closed') return;
    this.stage = 'closed';
    this.database.close();
  }

  private initializeStorage(secureDefaults: boolean): void {
    initializeSchema(this.database);
    this.stats = new SqliteStatsProjection(this.database.db);
    this.statsDataValue = new SqliteStatsData({database:this.database, projection:this.stats, inbox:this.inbox, deliveries:this.deliveries, bindings:this.sessions, jobs:this.jobs});
    for (const id of this.personaFiles.ids()) {
      // Preserve externally changed files and their journal; the panel exposes the recovery error.
      try { this.personas.recoverFiles(id); } catch {}
    }
    if (!this.database.records.get('config', 'default')) {
      const hostTools = secureDefaults ? false : undefined;
      const voiceDefaults = {enabled:false, protocol:'edge_tts' as const, format:'mp3' as const};
      this.database.records.put('config', 'default', configForWrite({id:'default', name:'默认', personaPrompt:'你是自然、真诚、具体的中文聊天伙伴。回应用户实际意图，默认简洁，任务结果按需要展开。不编造记忆、工具执行或媒体内容。保留工具、skills和运行环境信息。', media:{voice:voiceDefaults}, ...(hostTools === undefined ? {} : {allowHostTools:hostTools})}));
      this.database.records.put('config', 'sakura', configForWrite({id:'sakura', name:'小樱', personaPrompt:'你是成年猫娘小樱：银白长发、翠绿色眼睛、白色猫耳和尾巴、黑白女仆装。自然简短地交流，日常文字尽量不超过100字，任务结果可以展开。按用户意图决定是否调用图片工具，每轮最多一张生成图。参考图编辑必须使用真实原图。不输出配图描述，不编造工具或媒体观察。', media:{voice:voiceDefaults}, ...(hostTools === undefined ? {} : {allowHostTools:hostTools})}));
    }
    for (const config of this.personas.configs()) if (!this.database.records.get('config-version', `${config.id}:${config.revision}`)) this.database.records.put('config-version', `${config.id}:${config.revision}`, config);
    for (const config of this.personas.configs()) {
      try {
        const baseline = this.personas.baseline(config.id);
        const unchanged = baseline?.digest === this.personaFiles.currentDigest(config.id);
        if (!this.personaFiles.hasFiles(config.id) || (unchanged && !sameConfig(this.personaFiles.read(config.id).config, config))) this.personaFiles.publish(config, fingerprint => this.database.transaction(() => this.personas.saveBaseline(config.id, fingerprint)));
        else if (!baseline && sameConfig(this.personaFiles.read(config.id).config, config)) this.personas.saveBaseline(config.id, this.personaFiles.currentDigest(config.id));
      } catch {/* An invalid draft must not stop bots using the last applied configuration. */}
    }
    this.sessions.backfill(this.deliveries.deliveries());
    this.stage = 'initialized';
  }

  /**
   * Crash recovery: in-flight work becomes explicitly unknown and is never
   * replayed automatically.  Progress deliveries expire instead of resurfacing.
   */
  recover(): void {
    if (this.stage === 'closed') throw new Error('STORE_CLOSED');
    const sending = this.deliveries.deliveries(['sending']);
    this.database.db.exec("UPDATE inbox SET state='interrupted' WHERE state='processing'; UPDATE deliveries SET state='unknown' WHERE state='sending'");
    for (const delivery of sending) this.projection.observeDelivery({...delivery, state:'unknown'});
    for (const delivery of this.deliveries.deliveries(['pending'])) if (delivery.purpose === 'progress') this.deliveries.deliveryState(delivery, 'cancelled');
    this.stage = 'recovered';
  }

  /** Retention of completed work only; pending or unknown rows are never dropped. */
  retain(now = Date.now(), windows = {inbox:30, delivery:30, metric:30, failure:30}): {inbox:number;delivery:number;metric:number;failure:number} {
    const cutoff = (days: number) => now - days * 86_400_000;
    const result = {inbox:0, delivery:0, metric:0, failure:0};
    for (const row of this.inbox.rows()) {
      const value = JSON.parse(row.json) as {timestamp:number};
      if (value.timestamp < cutoff(windows.inbox) && ['complete', 'failed', 'cancelled', 'interrupted'].includes(this.inbox.stateOf(row.scope, row.id) ?? '')) result.inbox += this.inbox.delete(row.scope, row.id);
    }
    for (const delivery of this.deliveries.deliveries()) {
      const at = delivery.updatedAt ?? delivery.createdAt ?? 0;
      if (at < cutoff(windows.delivery) && ['sent', 'failed', 'cancelled', 'unknown'].includes(delivery.state)) result.delivery += this.deliveries.delete(delivery.id);
    }
    for (const metric of this.turnMetrics.turnMetrics()) {
      const at = metric.sentAt ?? metric.modelCompletedAt ?? metric.receivedAt;
      if (at < cutoff(windows.metric) && ['complete', 'failed', 'cancelled'].includes(metric.state ?? '')) result.metric += this.turnMetrics.deleteMetric(metric.id);
    }
    for (const row of this.failures.entries()) {
      const failure = JSON.parse(row.json) as {at:number;state:string};
      if (failure.at < cutoff(windows.failure) && ['failed', 'cancelled'].includes(failure.state)) result.failure += this.failures.delete(row.id);
    }
    return result;
  }

  /** Default persona written on a fresh install, exported for bootstrap tests. */
  bootstrapConfigs(): readonly BotConfig[] {return this.personas.configs();}

  /**
   * Explicit application dependency bundle.  Every field is a narrow port; the
   * runtime and its services never receive this composition object itself.
   */
  repositories(): RuntimeRepositories {
    return {
      storage:{home:this.home},
      unitOfWork:{transaction:fn => this.database.transaction(fn)},
      lifecycle:{
        claim:owner => this.ownership.claim(owner),
        release:owner => this.ownership.release(owner),
        recover:() => this.recover(),
        retain:(now, windows) => this.retain(now, windows),
      },
      bots:this.bots,
      personas:this.personas,
      sessions:this.sessions,
      inbox:this.inbox,
      memory:this.memory,
      media:{assets:this.assets, jobs:this.jobs, quota:this.quota, music:this.musicState, singing:this.singingState},
      deliveries:this.deliveries,
      automation:this.automation,
      evolution:this.evolution,
      telemetry:{metrics:this.turnMetrics, snapshots:this.turnSnapshots, failures:this.failures, actions:this.sessionActions},
      stats:this.statsData,
      statsSessions:this.statsSessions,
      capabilities:this.capability,
      historyLocations:this.history,
      chatHistory:{write:(scope, sessionId, events) => this.workspaceFiles.write(scope, sessionId, events)},
      workspace:this.workspaceFiles,
      botHistory:{
        snapshot:botId => this.botHistory.snapshot(botId),
        deleteFiles:(assetsRoot, snapshot) => this.botHistory.deleteFiles(assetsRoot, snapshot),
        deleteRecords:(botId, snapshot) => this.botHistory.deleteRecords(botId, snapshot),
      },
    };
  }
}
