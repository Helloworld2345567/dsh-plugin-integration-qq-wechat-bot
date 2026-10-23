import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import type {Store} from './store.js';
import {scopeKey} from './store.js';
import {idSchema,type SessionBinding} from './types.js';
import type {StatsDataPort} from './repositories.js';
import type {AuxiliaryUsageCall,MediaUsageCall,NativeUsageFact,StatsSessionOwner,TokenUsage} from './usage.js';
import {normalizeProviderUsage} from './usage.js';
import type {GroupRecord} from './stats.js';
const requireHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class SqliteStatsData implements StatsDataPort {
  readonly projection;
  constructor(readonly store:Store){this.projection=store.stats;}
  getSessionOwner(id:string){return this.store.get<StatsSessionOwner>('stats-session',id);}
  putSessionOwner(owner:StatsSessionOwner):void{this.store.put('stats-session',owner.sessionId,owner);}
  putNativeFact(id:string,fact:NativeUsageFact):boolean{if(this.store.get('stats-native',id))return false;this.store.put('stats-native',id,fact);return true;}
  listNativeFacts(sessionId:string){return this.store.list<NativeUsageFact>('stats-native').filter(fact=>fact.sessionId===sessionId);}
  getAuxiliaryUsage(id:string){return this.store.get<{usage?:TokenUsage}>('stats-auxiliary',id);}
  putAuxiliaryUsage(id:string,value:AuxiliaryUsageCall&{sessionId:string;usage?:TokenUsage}):void{this.store.put('stats-auxiliary',id,value);}
  listAuxiliaryUsage(sessionId:string){return this.store.list<AuxiliaryUsageCall&{sessionId:string;usage?:TokenUsage}>('stats-auxiliary').filter(call=>call.sessionId===sessionId);}
  listSessionOwners(){return this.store.list<StatsSessionOwner>('stats-session');}
  observeGroup(input:import('./stats.js').GroupObservation,now:number){if(!input.botId||!input.groupId)return;const at=typeof input.at==='number'&&Number.isSafeInteger(input.at)&&input.at>=0?input.at:now,key=requireHash([input.botId,input.groupId]);if(input.eventId){const eventKey=requireHash([input.botId,input.groupId,input.eventId,input.event]);if(this.store.get('stats-group-event',eventKey))return;this.store.put('stats-group-event',eventKey,{at});}const old=this.store.get<GroupRecord>('stats-group',key),membership=input.event!=='observed'&&at>=(old?.membershipAt??0);const value={...old,botId:input.botId,groupId:input.groupId,name:typeof input.name==='string'?input.name.slice(0,200):old?.name,state:membership?input.event:old?.state??'observed',firstSeenAt:Math.min(old?.firstSeenAt??at,at),lastSeenAt:Math.max(old?.lastSeenAt??at,at),membershipAt:membership?at:old?.membershipAt,complete:false} satisfies GroupRecord;this.store.put('stats-group',key,value);this.projection.importGroup(value);return value;}
  migrateLegacy():void{
    const meta=this.store.get<{collectionStartedAt:number}>('stats-meta','coverage');if(meta)this.projection.initializeCoverage(meta.collectionStartedAt);
    for(const owner of this.listSessionOwners())this.projection.observeSession(owner.sessionId,owner.botId,owner.rootSessionId,owner.kind);
    for(const message of this.store.allMessages()){this.projection.observeReceived(message);if(message.scope.kind==='group')this.projection.observeGroup({botId:message.scope.botId,groupId:message.scope.channelId,event:'observed',at:message.timestamp,eventId:`inbox:${message.scope.botId}:${message.id}`});}
    for(const delivery of this.store.deliveries())this.projection.observeDelivery(delivery);
    for(const group of this.store.list<GroupRecord>('stats-group'))this.projection.importGroup(group);
    const bindings=new Map(this.store.list<SessionBinding>('binding').filter(binding=>{const scope=binding?.scope;return!!scope&&idSchema.safeParse(scope.platform).success&&['private','group'].includes(scope.kind)&&[scope.botId,scope.accountId,scope.channelId,scope.senderId].every(value=>typeof value==='string'&&value.length>0)&&binding.key===scopeKey(scope);}).map(binding=>[binding.key,binding.scope.botId]));
    for(const job of this.store.list<{id:string;scope:string;botId?:string;provider?:string;requestedModel?:string;modelCalls?:MediaUsageCall[]}>('job')){
      const botId=job.botId??bindings.get(job.scope);if(!botId)continue;let calls=job.modelCalls??[];
      if(!job.modelCalls&&/^[a-zA-Z0-9_-]{1,100}$/.test(job.id)){try{const raw=JSON.parse(readFileSync(path.join(this.store.home,'jobs',job.id,'model-usage.json'),'utf8'));if(Array.isArray(raw))calls=raw.filter(call=>call?.attempted===true&&typeof call.id==='string'&&Number.isSafeInteger(call.at)).map(call=>({id:call.id,attempted:true,at:call.at,provider:job.provider,model:typeof call.model==='string'?call.model:job.requestedModel,usage:normalizeProviderUsage(call.usage)}));}catch{/* Historical jobs without evidence remain unknown, never zero. */}}
      const seen=new Set<string>();this.projection.upsertMediaCalls(job.id,botId,calls.filter(call=>!seen.has(call.id)&&!!seen.add(call.id)));
    }
  }
}
