import type {BotConfig,BotInstance,CallerScope,Delivery,InboundMessage,SessionBinding,SessionRecord,Asset} from './types.js';
import type {StatsQueryInput,StatsResult,GroupObservation,GroupRecord} from './stats.js';
import type {TokenUsage,UsageKind,MediaUsageCall,StatsSessionOwner,NativeUsageFact,AuxiliaryUsageCall} from './usage.js';

export interface PageRequest<F>{filter:F;limit:number;cursor?:string}
export interface Page<T>{items:readonly T[];nextCursor:string|null;revision:string}
export interface ConfigRepository {requireConfig(id:string):BotConfig;listConfigs():readonly BotConfig[];saveConfig(input:unknown,expectedRevision?:number,fileDigest?:string):BotConfig;requireBot(id:string):BotInstance;listBots():readonly BotInstance[];saveBot(input:unknown):BotInstance}
export interface SessionInboxRepository {accept(message:InboundMessage):boolean;findMessage(scopeKey:string,id:string):InboundMessage|undefined;listMessageBatch(scopeKey:string,states:readonly string[],limit:number):readonly InboundMessage[];transitionMessages(scopeKey:string,ids:readonly string[],state:string):void;bindingFor(scope:CallerScope):SessionBinding;requireOwnedSession(scope:CallerScope,id:string):SessionRecord;pageSessions(request:PageRequest<{scopeKey?:string}>):Page<SessionRecord>}
export interface DeliveryRepository {
  pageDeliveries(request:PageRequest<{scopeKey?:string;botId?:string;states?:readonly string[]}>):Page<Delivery>;
  count(states:readonly string[]):number;
  pendingBotIds():readonly string[];
  nextSendable(botId:string,limit:number):readonly Delivery[];
  find(id:string,state?:Delivery['state']):Delivery|undefined;
  /** Find unresolved or accepted deliveries for one persisted asset by default. */
  findByAsset(scopeKey:string,assetId:string,states?:readonly Delivery['state'][]):readonly Delivery[];
  /** Return an existing delivery in a retryable state as pending, preserving its ID. */
  retry(id:string):Delivery|undefined;
  hasEarlierBlocker(delivery:Delivery):boolean;
}
export interface AssetRepository {requireOwnedAsset(scopeKey:string,id:string):Asset;recentAssets(scopeKey:string,sessionId:string,kind?:string,limit?:number):readonly Asset[]}
export interface StatsProjectionCall {id:string;botId:string;provider:string;model:string;kind:UsageKind;at:number;usage?:TokenUsage}
export interface StatsDataPort {
  projection:StatsProjectionRepository;
  getSessionOwner(sessionId:string):StatsSessionOwner|undefined;
  putSessionOwner(owner:StatsSessionOwner):void;
  putNativeFact(id:string,fact:NativeUsageFact):boolean;
  listNativeFacts(sessionId:string):readonly NativeUsageFact[];
  getAuxiliaryUsage(id:string):{usage?:TokenUsage}|undefined;
  putAuxiliaryUsage(id:string,value:AuxiliaryUsageCall&{sessionId:string;usage?:TokenUsage}):void;
  listAuxiliaryUsage(sessionId:string):readonly (AuxiliaryUsageCall&{sessionId:string;usage?:TokenUsage})[];
  listSessionOwners():readonly StatsSessionOwner[];
  observeGroup(input:GroupObservation,now:number):GroupRecord|undefined;
  migrateLegacy():void;
}
export interface StatsProjectionRepository {
  collectionStartedAt():number;
  initializeCoverage(at:number):void;
  observeSession(sessionId:string,botId:string,rootSessionId:string,kind:UsageKind):void;
  sessionOwner(sessionId:string):{sessionId:string;botId:string;rootSessionId:string;kind:UsageKind}|undefined;
  replaceUsageCalls(ownerKey:string,calls:readonly StatsProjectionCall[]):void;
  upsertUsageCall(call:StatsProjectionCall):void;
  upsertMediaCalls(jobId:string,botId:string,calls:readonly MediaUsageCall[]):void;
  observeReceived(message:InboundMessage):void;
  observeDelivery(delivery:Delivery):void;
  observeGroup(input:GroupObservation):void;
  importGroup(record:GroupRecord):void;
  query(input:StatsQueryInput,status:ReadonlyMap<string,string>|Record<string,string>,bots:readonly BotInstance[],channelGroupSupport:(id:string)=>'unsupported'|'observed_only',now:number):StatsResult;
}
