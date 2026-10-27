import type {BotInstance,Delivery,InboundMessage} from './types.js';
import type {StatsQueryInput,StatsResult,GroupObservation,GroupRecord} from './stats.js';
import type {TokenUsage,UsageKind,MediaUsageCall,StatsSessionOwner,NativeUsageFact,AuxiliaryUsageCall} from './usage.js';

export interface Page<T>{items:readonly T[];nextCursor:string|null;revision:string}

export interface StatsProjectionCall {id:string;botId:string;provider:string;model:string;kind:UsageKind;at:number;usage?:TokenUsage}
export interface StatsDataPort {
  projection:StatsProjectionRepository;
  getSessionOwner(sessionId:string):StatsSessionOwner|undefined;
  putSessionOwner(owner:StatsSessionOwner):void;
  putNativeFact(id:string,fact:NativeUsageFact):boolean;
  listNativeFacts(sessionId:string):readonly NativeUsageFact[];
  getAuxiliaryUsage(id:string):{usage?:TokenUsage}|undefined;
  putAuxiliaryUsage(id:string,value:AuxiliaryUsageCall&{sessionId:string;usage?:TokenUsage}):boolean;
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
  hasUsageCall(id:string):boolean;
  upsertUsageCall(call:StatsProjectionCall):void;
  upsertMediaCalls(jobId:string,botId:string,calls:readonly MediaUsageCall[]):void;
  observeReceived(message:InboundMessage):void;
  observeDelivery(delivery:Delivery):void;
  observeGroup(input:GroupObservation):void;
  importGroup(record:GroupRecord):void;
  query(input:StatsQueryInput,status:ReadonlyMap<string,string>|Record<string,string>,bots:readonly BotInstance[],channelGroupSupport:(id:string)=>'unsupported'|'observed_only',now:number):StatsResult;
}
