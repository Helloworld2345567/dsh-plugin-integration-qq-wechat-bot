import type {DatabaseSync} from 'node:sqlite';
import type {BotConfig, BotInstance, CallerScope, Delivery, InboundMessage, Output, SessionBinding, SessionRecord, TurnMetric, TurnSnapshot} from '../../core/types.js';
import type {CursorStore, JsonValue} from '../../core/channel-ports.js';
import type {Page} from '../../core/ports/common.js';
import type {Asset} from '../../core/types.js';
import {defaultPersonasRoot} from '../../core/personas.js';
import {SqlitePersistence, type PersistenceStage} from './persistence.js';
import type {PersonaFiles} from '../files/persona-files.js';
import type {SqliteStatsProjection} from './stats-projection.js';
import type {SessionActionRecord} from '../../core/ports/telemetry.js';
import type {MediaJobRecord} from '../../core/ports/media.js';
import type {DeliveryPageRequest, DeliveryQueueRepository} from '../../core/ports/delivery.js';

/**
 * Infrastructure-only convenience facade over `SqlitePersistence`.
 *
 * Business services must not depend on this class: they receive the narrow
 * repositories they need.  The facade survives for two reasons only:
 *  1. the composition root and the local admin UI need one ordered lifecycle
 *     object (`open → initialize → migrate → recover → start → close`);
 *  2. the persistence contract tests exercise raw row fixtures (legacy rows,
 *     injected triggers) that no application-facing port may expose.
 * Exit condition: once those tests build their fixtures through the adapters,
 * this file is deleted.  `check:architecture` already rejects any production
 * import of it outside this directory and the composition root.
 */
export class Store {
  readonly persistence: SqlitePersistence;
  constructor(home: string, personasRoot = defaultPersonasRoot(home), readonly options: {secureDefaults?:boolean;defer?:boolean} = {}) {
    this.persistence = new SqlitePersistence(home, personasRoot, options);
  }
  static open(home: string, personasRoot = defaultPersonasRoot(home), options: {secureDefaults?:boolean} = {}): Store {
    return new Store(home, personasRoot, {...options, defer:true});
  }
  get home(): string {return this.persistence.home;}
  get db(): DatabaseSync {return this.persistence.database.db;}
  get personas(): PersonaFiles {return this.persistence.personaFiles;}
  get stats(): SqliteStatsProjection {return this.persistence.projection;}
  lifecycleStage(): PersistenceStage {return this.persistence.lifecycleStage();}
  initialize(): this {this.persistence.initialize(); return this;}
  migrate(): this {this.persistence.migrate(); return this;}
  recover(): void {this.persistence.recover();}
  start(): this {this.persistence.start(); return this;}
  close(): void {this.persistence.close();}
  retain(now = Date.now(), windows = {inbox:30, delivery:30, metric:30, failure:30}): {inbox:number;delivery:number;metric:number;failure:number} {
    return this.persistence.retain(now, windows);
  }
  transaction<T>(fn: () => T): T {return this.persistence.database.transaction(fn);}

  // Generic record access: infrastructure and test fixtures only.
  get<T>(kind: string, id: string): T | undefined {return this.persistence.database.records.get<T>(kind, id);}
  list<T>(kind: string): T[] {return this.persistence.database.records.list<T>(kind);}
  put(kind: string, id: string, value: unknown): void {this.persistence.database.records.put(kind, id, value);}
  recordCount(kind: string): number {return this.persistence.database.records.count(kind);}

  // Telemetry
  updateTurnMetric(id: string, patch: Partial<Omit<TurnMetric, 'id'>>): void {this.persistence.turnMetrics.updateTurnMetric(id, patch);}
  markTurnStage(scope: string, ids: readonly string[], field: Extract<keyof TurnMetric, `${string}At`>, at = Date.now()): void {this.persistence.turnMetrics.markTurnStage(scope, ids, field, at);}
  metricPercentiles(field: Extract<keyof TurnMetric, `${string}At`>, from = 0, to = Date.now()) {return this.persistence.turnMetrics.metricPercentiles(field, from, to);}
  turnMetrics(): TurnMetric[] {return this.persistence.turnMetrics.turnMetrics();}
  updateTurnMetrics(scope: string, sourceIds: readonly string[], patch: Partial<Omit<TurnMetric, 'id'>>): void {this.persistence.turnMetrics.updateTurnMetrics(scope, sourceIds, patch);}
  updateTurnMetricsByTurn(scope: string, turnId: string, patch: Partial<Omit<TurnMetric, 'id'>>): void {this.persistence.turnMetrics.updateTurnMetricsByTurn(scope, turnId, patch);}
  findTurnMetric(id: string): TurnMetric | undefined {return this.persistence.turnMetrics.findTurnMetric(id);}
  findTurnSnapshot(id: string): TurnSnapshot | undefined {return this.persistence.turnSnapshots.findTurnSnapshot(id);}
  saveTurnSnapshot(id: string, value: TurnSnapshot): void {this.persistence.turnSnapshots.saveTurnSnapshot(id, value);}
  failures(): readonly Record<string, unknown>[] {return this.persistence.failures.failures() as readonly Record<string, unknown>[];}
  saveFailure(id: string, value: unknown): void {this.persistence.failures.saveFailure(id, value);}

  // Session actions
  sessionActions<T extends SessionActionRecord = SessionActionRecord>(): T[] {return this.persistence.sessionActions.sessionActions<T>();}
  findSessionAction<T extends SessionActionRecord = SessionActionRecord>(id: string): T | undefined {return this.persistence.sessionActions.findSessionAction<T>(id);}
  saveSessionAction(id: string, value: SessionActionRecord): void {this.persistence.sessionActions.saveSessionAction(id, value);}

  // Media jobs and quota
  jobs(): readonly MediaJobRecord[] {return this.persistence.jobs.jobs();}
  findJob(id: string): MediaJobRecord | undefined {return this.persistence.jobs.findJob(id);}
  saveJob(id: string, value: unknown): void {this.persistence.jobs.saveJob(id, value);}
  patchJob(id: string, patch: Record<string, unknown>): MediaJobRecord {return this.persistence.jobs.patchJob(id, patch);}
  consumeMediaQuota(key: string, limit: number): void {this.persistence.quota.consume(key, limit);}

  // Assets
  saveAsset(asset: Asset): void {this.persistence.assets.saveAsset(asset);}
  indexAsset(asset: Asset): void {this.persistence.assets.reindex(asset);}
  assetUsage(scope: string) {return this.persistence.assets.assetUsage(scope);}
  recentAssets(scope: string, sessionId: string, kind?: string, limit = 24): Asset[] {return this.persistence.assets.recentAssets(scope, sessionId, kind, limit);}
  asset(scope: string, id: string): Asset {return this.persistence.assets.asset(scope, id);}

  // Capability and evolution
  capabilityStatuses(): readonly unknown[] {return this.persistence.capability.statuses();}
  saveCapabilityStatus(id: string, value: unknown): void {this.persistence.capability.saveStatus(id, value as Parameters<typeof this.persistence.capability.saveStatus>[1]);}
  evolutionTasks<T>(): T[] {return this.persistence.evolution.evolutionTasks() as T[];}
  saveEvolutionTask(id: string, value: unknown): void {this.persistence.evolution.saveEvolutionTask(id, value as Parameters<typeof this.persistence.evolution.saveEvolutionTask>[1]);}
  contentChanges<T>(): T[] {return this.persistence.evolution.contentChanges() as T[];}
  findContentChange<T>(id: string): T | undefined {return this.persistence.evolution.findContentChange(id) as T | undefined;}
  saveContentChange(id: string, value: unknown): void {this.persistence.evolution.saveContentChange(id, value as Parameters<typeof this.persistence.evolution.saveContentChange>[1]);}

  // Sessions and bindings
  sessionsAll(): SessionRecord[] {return this.persistence.sessions.sessionsAll();}
  findSession(id: string): SessionRecord | undefined {return this.persistence.sessions.findSession(id);}
  bindings(): SessionBinding[] {return this.persistence.sessions.bindings();}
  findBinding(key: string): SessionBinding | undefined {return this.persistence.sessions.findBinding(key);}
  binding(scope: CallerScope): SessionBinding {return this.persistence.sessions.binding(scope);}
  updateSession(binding: SessionBinding): SessionBinding {return this.persistence.sessions.updateSession(binding);}
  markSessionPersisted(binding: SessionBinding): void {this.persistence.sessions.markSessionPersisted(binding);}
  session(scope: CallerScope, id: string): SessionRecord {return this.persistence.sessions.session(scope, id);}
  sessions(scope: CallerScope): SessionRecord[] {return this.persistence.sessions.sessions(scope);}
  pageSessions(filter: {scopeKey?:string}, limit: number, cursor?: string): Page<SessionRecord> {return this.persistence.sessions.pageSessions(filter, limit, cursor);}
  recentSince(key: string): number {return this.persistence.sessions.recentSince(key);}
  sessionRecentSince(key: string): number {return this.persistence.sessions.sessionRecentSince(key);}
  reset(scope: CallerScope): SessionBinding {return this.persistence.sessions.reset(scope);}
  activateSession(scope: CallerScope, id: string): SessionBinding {return this.persistence.sessions.activateSession(scope, id);}

  // Personas and bots
  configVersions(): readonly BotConfig[] {return this.persistence.personas.configVersions();}
  configs(): BotConfig[] {return this.persistence.personas.configs();}
  config(id: string): BotConfig {return this.persistence.personas.config(id);}
  personaStatus(id: string) {return this.persistence.personas.personaStatus(id);}
  personaDirectory(id?: string): string {return this.persistence.personas.personaDirectory(id);}
  personaRoot(): string {return this.persistence.personas.personaRoot();}
  readPersonaDraft(id: string) {return this.persistence.personas.readPersonaDraft(id);}
  saveConfig(input: unknown, expectedRevision?: number, fileDigest?: string): BotConfig {return this.persistence.personas.saveConfig(input, expectedRevision, fileDigest);}
  effectiveConfig(binding: SessionBinding): BotConfig {return this.persistence.personas.effectiveConfig(binding);}
  storageHome(): string {return this.persistence.home;}
  bots(): BotInstance[] {return this.persistence.bots.bots();}
  bot(id: string): BotInstance {return this.persistence.bots.bot(id);}
  saveBot(input: unknown): BotInstance {return this.persistence.bots.saveBot(input);}

  // Inbox
  accept(message: InboundMessage): boolean {return this.persistence.inbox.accept(message);}
  messages(scope: string, states: readonly string[] = ['pending']): InboundMessage[] {return this.persistence.inbox.messages(scope, states);}
  source(scope: string, id: string): InboundMessage | undefined {return this.persistence.inbox.source(scope, id);}
  updateMessage(scope: string, message: InboundMessage): void {this.persistence.inbox.updateMessage(scope, message);}
  mark(scope: string, ids: readonly string[], state: string): void {this.persistence.inbox.mark(scope, ids, state);}
  allMessages(states?: readonly string[]): InboundMessage[] {return this.persistence.inbox.allMessages(states);}
  scopesWithPending(states: readonly string[] = ['pending']): string[] {return this.persistence.inbox.scopesWithPending(states);}

  // Channel cursors and runtime ownership
  cursorStore(): CursorStore {
    return {
      read:(channelId, botId) => this.persistence.cursors.read(channelId, botId) as JsonValue | undefined,
      write:(channelId, botId, value) => this.persistence.cursors.write(channelId, botId, value),
    };
  }
  claimRuntime(owner: string): void {this.persistence.ownership.claim(owner);}
  releaseRuntime(owner: string): void {this.persistence.ownership.release(owner);}

  // Statistics ownership
  statsSessionExists(id: string): boolean {return Boolean(this.get('stats-session', id));}
  statsOwnedStart(id: string): number {return this.get<number>('stats-owned-start', id) ?? 0;}
  saveStatsOwnedStart(id: string, value: number): void {this.put('stats-owned-start', id, value);}

  // Delivery
  enqueue(binding: SessionBinding, sourceId: string, turnId: string, outputs: Output[], reply: Record<string, string>, replyEnvelope?: Delivery['replyEnvelope'], progress?: NonNullable<Delivery['progress']>, snapshot?: TurnSnapshot): void {
    this.persistence.deliveries.enqueue(binding, sourceId, turnId, outputs, reply, replyEnvelope, progress, snapshot);
  }
  deliveries(states?: readonly string[]): Delivery[] {return this.persistence.deliveries.deliveries(states);}
  /** Plain object on purpose: callers spread it to observe a query without mutating the adapter. */
  deliveryRepository(): DeliveryQueueRepository {
    const repository = this.persistence.deliveries;
    return {
      count:(states: readonly string[]) => repository.count(states),
      pendingCount:() => repository.pendingCount(),
      pendingBotIds:() => repository.pendingBotIds(),
      nextSendable:(botId: string, limit: number) => repository.nextSendable(botId, limit),
      find:(id: string, state?: Delivery['state']) => repository.find(id, state),
      findByAsset:(scopeKey: string, assetId: string, states?: readonly Delivery['state'][]) => repository.findByAsset(scopeKey, assetId, states),
      retry:(id: string) => repository.retry(id),
      hasEarlierBlocker:(delivery: Delivery) => repository.hasEarlierBlocker(delivery),
      pageDeliveries:(request: DeliveryPageRequest) => repository.pageDeliveries(request),
    };
  }
  retryDelivery(id: string): Delivery | undefined {return this.persistence.deliveries.retry(id);}
  deliveryState(delivery: Delivery, state: Delivery['state'], receipt?: string, error?: string): void {this.persistence.deliveries.deliveryState(delivery, state, receipt, error);}

  // Memory
  remember(scope: string, key: string, value: string, source: string, quote: string): void {this.persistence.memory.remember(scope, key, value, source, quote);}
  memories(scope: string): Record<string, unknown>[] {return this.persistence.memory.memories(scope) as unknown as Record<string, unknown>[];}
  correctMemory(scope: string, key: string, value: string, version: number): void {this.persistence.memory.correctMemory(scope, key, value, version);}
  forget(scope: string, key: string): void {this.persistence.memory.forget(scope, key);}
}
