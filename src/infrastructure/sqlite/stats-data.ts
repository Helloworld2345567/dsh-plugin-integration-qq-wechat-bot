import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {scopeKey} from '../../core/identity.js';
import {idSchema, type SessionBinding} from '../../core/types.js';
import type {StatsDataPort, StatsProjectionRepository} from '../../core/ports/stats.js';
import type {AuxiliaryUsageCall, NativeUsageFact, StatsSessionOwner, TokenUsage} from '../../core/usage.js';
import {normalizeProviderUsage} from '../../core/usage.js';
import type {GroupRecord, GroupObservation} from '../../core/stats.js';
import type {BindingRepository} from '../../core/ports/session.js';
import type {InboxRepository} from '../../core/ports/inbox.js';
import type {DeliveryRepository} from '../../core/ports/delivery.js';
import type {MediaJobRepository, MediaJobRecord} from '../../core/ports/media.js';
import {SqliteDatabase} from './database.js';

const requireHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export interface SqliteStatsDataDeps {
  database: SqliteDatabase;
  projection: StatsProjectionRepository;
  inbox: InboxRepository;
  deliveries: DeliveryRepository;
  bindings: BindingRepository;
  jobs: MediaJobRepository;
}

/**
 * Durable statistics facts.  Native usage journal entries are immutable once
 * written; auxiliary calls may be corrected by a later observation.
 */
export class SqliteStatsData implements StatsDataPort {
  readonly projection: StatsProjectionRepository;
  private readonly database: SqliteDatabase;
  private readonly deps: SqliteStatsDataDeps;
  constructor(deps: SqliteStatsDataDeps) {
    this.deps = deps;
    this.database = deps.database;
    this.projection = deps.projection;
  }
  private get records() {return this.database.records;}
  getSessionOwner(id: string) {return this.records.get<StatsSessionOwner>('stats-session', id);}
  putSessionOwner(owner: StatsSessionOwner): void {this.records.put('stats-session', owner.sessionId, owner);}
  putNativeFact(id: string, fact: NativeUsageFact): boolean {
    if (this.records.get('stats-native', id)) return false;
    this.records.put('stats-native', id, fact);
    return true;
  }
  listNativeFacts(sessionId: string) {
    return (this.database.db.prepare("SELECT json FROM records WHERE kind='stats-native' AND json_extract(json,'$.sessionId')=? ORDER BY id").all(sessionId) as {json:string}[]).map(row => JSON.parse(row.json) as NativeUsageFact);
  }
  getAuxiliaryUsage(id: string) {return this.records.get<{usage?:TokenUsage}>('stats-auxiliary', id);}
  putAuxiliaryUsage(id: string, value: AuxiliaryUsageCall & {sessionId:string;usage?:TokenUsage}): boolean {
    const old = this.records.get<AuxiliaryUsageCall & {sessionId:string;usage?:TokenUsage}>('stats-auxiliary', id);
    if (old && JSON.stringify(old) === JSON.stringify(value)) return false;
    this.records.put('stats-auxiliary', id, value);
    return true;
  }
  listAuxiliaryUsage(sessionId: string) {
    return (this.database.db.prepare("SELECT json FROM records WHERE kind='stats-auxiliary' AND json_extract(json,'$.sessionId')=? ORDER BY id").all(sessionId) as {json:string}[]).map(row => JSON.parse(row.json) as AuxiliaryUsageCall & {sessionId:string;usage?:TokenUsage});
  }
  listSessionOwners() {return this.records.list<StatsSessionOwner>('stats-session');}
  observeGroup(input: GroupObservation, now: number) {
    if (!input.botId || !input.groupId) return;
    const at = typeof input.at === 'number' && Number.isSafeInteger(input.at) && input.at >= 0 ? input.at : now, key = requireHash([input.botId, input.groupId]);
    if (input.eventId) {
      const eventKey = requireHash([input.botId, input.groupId, input.eventId, input.event]);
      if (this.records.get('stats-group-event', eventKey)) return;
      this.records.put('stats-group-event', eventKey, {at});
    }
    const old = this.records.get<GroupRecord>('stats-group', key), membership = input.event !== 'observed' && at >= (old?.membershipAt ?? 0);
    const value = {...old, botId:input.botId, groupId:input.groupId, name:typeof input.name === 'string' ? input.name.slice(0, 200) : old?.name, state:membership ? input.event : old?.state ?? 'observed', firstSeenAt:Math.min(old?.firstSeenAt ?? at, at), lastSeenAt:Math.max(old?.lastSeenAt ?? at, at), membershipAt:membership ? at : old?.membershipAt, complete:false} satisfies GroupRecord;
    this.records.put('stats-group', key, value);
    this.projection.importGroup(value);
    return value;
  }
  migrateLegacy(): void {
    const meta = this.records.get<{collectionStartedAt:number}>('stats-meta', 'coverage');
    if (meta) this.projection.initializeCoverage(meta.collectionStartedAt);
    for (const owner of this.listSessionOwners()) this.projection.observeSession(owner.sessionId, owner.botId, owner.rootSessionId, owner.kind);
    for (const message of this.deps.inbox.allMessages()) {
      this.projection.observeReceived(message);
      if (message.scope.kind === 'group') this.projection.observeGroup({botId:message.scope.botId, groupId:message.scope.channelId, event:'observed', at:message.timestamp, eventId:`inbox:${message.scope.botId}:${message.id}`});
    }
    for (const delivery of this.deps.deliveries.deliveries()) this.projection.observeDelivery(delivery);
    for (const group of this.records.list<GroupRecord>('stats-group')) this.projection.importGroup(group);
    const bindings = new Map(this.deps.bindings.bindings().filter((binding:SessionBinding) => {
      const scope = binding?.scope;
      return !!scope && idSchema.safeParse(scope.platform).success && ['private', 'group'].includes(scope.kind) && [scope.botId, scope.accountId, scope.channelId, scope.senderId].every(value => typeof value === 'string' && value.length > 0) && binding.key === scopeKey(scope);
    }).map(binding => [binding.key, binding.scope.botId]));
    for (const job of this.deps.jobs.jobs() as readonly MediaJobRecord[]) {
      const botId = job.botId ?? bindings.get(job.scope ?? '');
      if (!botId) continue;
      let calls = job.modelCalls ?? [];
      if (!job.modelCalls && /^[a-zA-Z0-9_-]{1,100}$/.test(job.id)) {
        try {
          const raw = JSON.parse(readFileSync(path.join(this.database.home, 'jobs', job.id, 'model-usage.json'), 'utf8'));
          if (Array.isArray(raw)) calls = raw.filter(call => call?.attempted === true && typeof call.id === 'string' && Number.isSafeInteger(call.at)).map(call => ({id:call.id, attempted:true, at:call.at, provider:job.provider, model:typeof call.model === 'string' ? call.model : job.requestedModel, usage:normalizeProviderUsage(call.usage)}));
        } catch {/* Historical jobs without evidence remain unknown, never zero. */}
      }
      const seen = new Set<string>();
      this.projection.upsertMediaCalls(job.id, botId, calls.filter(call => !seen.has(call.id) && !!seen.add(call.id)));
    }
  }
}
