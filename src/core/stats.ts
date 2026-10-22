import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {scopeKey,type Store} from './store.js';
import type {InboundMessage,SessionBinding} from './types.js';

export type UsageKind='agent'|'subagent'|'compaction'|'media';
export interface TokenUsage {inputTokens:number;outputTokens:number;cacheReadTokens?:number;cacheWriteTokens?:number;reasoningTokens?:number;totalTokens?:number}
export interface GroupObservation {botId:string;groupId:string;name?:string;event:'observed'|'joined'|'left';at?:number;eventId?:string}
export interface GroupRecord {botId:string;groupId:string;name?:string;state:'observed'|'joined'|'left';firstSeenAt:number;lastSeenAt:number;membershipAt?:number;complete:false}
export const statsQuerySchema=z.object({range:z.enum(['today','7d','30d','all','custom']).default('today'),from:z.union([z.number(),z.string()]).optional(),to:z.union([z.number(),z.string()]).optional(),botId:z.string().max(80).optional(),provider:z.string().max(200).optional(),model:z.string().max(200).optional(),kind:z.enum(['agent','subagent','compaction','media']).optional(),groups:z.boolean().default(true)}).strict();
export type StatsQueryInput=z.input<typeof statsQuerySchema>;
export interface UsageTotals {calls:number;unknownUsageCalls:number;inputTokens:number;outputTokens:number;cacheReadTokens:number;cacheWriteTokens:number;reasoningTokens:number;knownTokens:number;unknownCacheReadCalls:number;unknownCacheWriteCalls:number;unknownReasoningCalls:number}
export interface MessageTotals {received:number;sent:number;failed:number;cancelled:number;unknown:number;pending:number;unknownSentTime:number}
export interface StatsResult {
  timezone:'Asia/Shanghai';range:{preset:string;from:number|null;to:number};
  coverage:{collectionStartedAt:number;earliestMessageAt:number|null;earliestUsageAt:number|null;unknownSentTime:number;legacyUsage:'available_evidence_only';groupListComplete:false};
  summary:UsageTotals&MessageTotals&{totalBots:number;onlineBots:number};
  bots:Array<UsageTotals&MessageTotals&{id:string;name:string;channel:string;status:string;online:boolean;groupSupport:'observed_only'|'unsupported';groupCount:number}>;
  models:Array<UsageTotals&{botId:string;provider:string;model:string;kind:UsageKind}>;
  trend:Array<UsageTotals&MessageTotals&{date:string}>;groups:GroupRecord[];
}
interface SessionOwner {sessionId:string;botId:string;rootSessionId:string;kind:UsageKind}
interface NativeFact {sessionId:string;seq:number;time:number;type:string;turn?:number;step?:number;provider?:string;model?:string;usage?:TokenUsage;compactionId?:string}
interface UsageCall {id:string;botId:string;provider:string;model:string;kind:UsageKind;at:number;usage?:TokenUsage}
export interface AuxiliaryUsage {id:string;at:number;provider:string;model:string;usage?:unknown;kind:'compaction'}
export interface MediaUsageCall {id:string;attempted:true;at:number;provider?:string;model?:string;usage?:TokenUsage}
const DAY=86_400_000,OFFSET=8*3_600_000;
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const text=(value:unknown):string|undefined=>typeof value==='string'&&value.length>0?value.slice(0,200):undefined;
const id=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function shanghaiDay(time:number):string{return new Date(time+OFFSET).toISOString().slice(0,10);}
function timeInput(value:number|string|undefined):number|undefined {
  if(value===undefined)return;
  const normalized=typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)?value+'T00:00:00+08:00':typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(value)?value+'+08:00':value;
  const time=typeof normalized==='number'?normalized:Date.parse(normalized);
  if(!Number.isSafeInteger(time)||time<0)throw new Error('INVALID_STATS_TIME');return time;
}
export function statsWindow(input:StatsQueryInput,now:number):{preset:string;from:number|null;to:number}{
  const parsed=statsQuerySchema.parse(input);if(parsed.range==='all')return{preset:'all',from:null,to:now};
  if(parsed.range==='custom'){const from=timeInput(parsed.from),to=timeInput(parsed.to);if(from===undefined||to===undefined||from>=to)throw new Error('INVALID_STATS_RANGE');return{preset:'custom',from,to};}
  const today=Math.floor((now+OFFSET)/DAY)*DAY-OFFSET;
  return{preset:parsed.range,from:today-(parsed.range==='7d'?6:parsed.range==='30d'?29:0)*DAY,to:now};
}
/** Native Harness counts are disjoint. Reasoning is contained in output. */
export function normalizeNativeUsage(value:unknown):TokenUsage|undefined{
  if(!value||typeof value!=='object')return;const u=value as Record<string,unknown>;
  if(!count(u.inputTokens)||!count(u.outputTokens))return;
  const result:TokenUsage={inputTokens:u.inputTokens,outputTokens:u.outputTokens};
  for(const name of ['cacheReadTokens','cacheWriteTokens','reasoningTokens','totalTokens'] as const){if(u[name]!==undefined){if(!count(u[name]))return;result[name]=u[name];}}
  if((result.reasoningTokens??0)>result.outputTokens)return;
  const known=result.inputTokens+result.outputTokens+(result.cacheReadTokens??0)+(result.cacheWriteTokens??0);
  if(!Number.isSafeInteger(known)||(result.totalTokens!==undefined&&result.totalTokens<known))return;
  return result;
}
/** OpenAI-compatible media counters include cache hits in aggregate prompt input. */
export function normalizeProviderUsage(value:unknown):TokenUsage|undefined{
  if(!value||typeof value!=='object')return;const u=value as Record<string,any>;
  const input=u.prompt_tokens??u.input_tokens,output=u.completion_tokens??u.output_tokens;
  if(!count(input)||!count(output))return;
  const read=u.prompt_cache_hit_tokens??u.prompt_tokens_details?.cached_tokens??u.input_tokens_details?.cached_tokens;
  const write=u.cache_creation_input_tokens??u.prompt_tokens_details?.cache_write_tokens;
  const reasoning=u.completion_tokens_details?.reasoning_tokens??u.output_tokens_details?.reasoning_tokens;
  if((read!==undefined&&!count(read))||(write!==undefined&&!count(write)))return;
  const uncached=input-(read??0)-(write??0);if(!count(uncached))return;
  return normalizeNativeUsage({inputTokens:uncached,outputTokens:output,...read===undefined?{}:{cacheReadTokens:read},...write===undefined?{}:{cacheWriteTokens:write},...reasoning===undefined?{}:{reasoningTokens:reasoning},totalTokens:u.total_tokens??input+output});
}
function usageZero():UsageTotals{return{calls:0,unknownUsageCalls:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:0,knownTokens:0,unknownCacheReadCalls:0,unknownCacheWriteCalls:0,unknownReasoningCalls:0};}
function messageZero():MessageTotals{return{received:0,sent:0,failed:0,cancelled:0,unknown:0,pending:0,unknownSentTime:0};}
function addUsage(total:UsageTotals,call:UsageCall):void{
  total.calls++;const u=call.usage;if(!u){total.unknownUsageCalls++;return;}
  total.inputTokens+=u.inputTokens;total.outputTokens+=u.outputTokens;
  for(const field of ['cacheReadTokens','cacheWriteTokens','reasoningTokens'] as const)total[field]+=u[field]??0;
  if(u.cacheReadTokens===undefined)total.unknownCacheReadCalls++;if(u.cacheWriteTokens===undefined)total.unknownCacheWriteCalls++;if(u.reasoningTokens===undefined)total.unknownReasoningCalls++;
  total.knownTokens+=u.totalTokens??u.inputTokens+u.outputTokens+(u.cacheReadTokens??0)+(u.cacheWriteTokens??0);
}

/** Durable accounting projection. Stores identifiers and counters, never prompts or credentials. */
export class StatsService {
  constructor(readonly store:Store,readonly status:()=>ReadonlyMap<string,string>|Record<string,string>=()=>({}),readonly now:()=>number=Date.now){
    if(!store.get('stats-meta','coverage'))store.put('stats-meta','coverage',{collectionStartedAt:now()});
    if(!store.get('stats-meta','groups-backfilled')){
      for(const row of store.db.prepare('SELECT scope,id,json FROM inbox').all() as {scope:string;id:string;json:string}[]){const message=JSON.parse(row.json) as InboundMessage;if(message.scope.platform==='qq'&&message.scope.kind==='group')this.observeGroup({botId:message.scope.botId,groupId:message.scope.channelId,event:'observed',at:message.timestamp,eventId:`inbox:${row.scope}:${row.id}`});}
      store.put('stats-meta','groups-backfilled',{at:now()});
    }
  }
  observeSession(sessionId:string,botId:string,rootSessionId=sessionId,kind:UsageKind=rootSessionId===sessionId?'agent':'subagent'):void{
    const previous=this.store.get<SessionOwner>('stats-session',sessionId);if(previous&&(previous.botId!==botId||previous.rootSessionId!==rootSessionId))throw new Error('STATS_SESSION_OWNER_CONFLICT');
    this.store.put('stats-session',sessionId,{sessionId,botId,rootSessionId,kind});
  }
  recordNative(sessionId:string,event:{seq:number;time:number;type:string;data:unknown}):void{
    if(!count(event.seq)||!count(event.time)||!event.data||typeof event.data!=='object')return;
    const d=event.data as Record<string,any>;const fact:NativeFact={sessionId,seq:event.seq,time:event.time,type:event.type};
    if(event.type==='request/header'||event.type==='request/context'){
      const config=event.type==='request/header'?d.header?.config:d;fact.provider=text(config?.provider);fact.model=text(config?.model);
    }else if(event.type==='assistant/message'||event.type==='assistant/attempt'){
      if(!count(d.turn)||!count(d.step))return;fact.turn=d.turn;fact.step=d.step;
      const chunks=Array.isArray(d.stream)?d.stream:[];const last=chunks.findLast((item:any)=>item?.type==='chunk'&&item.chunk?.type==='usage');
      fact.usage=normalizeNativeUsage(d.usage??last?.chunk.usage);fact.provider=text(d.message?.source?.provider);fact.model=text(d.message?.source?.model);
    }else if(event.type==='llm/retry-started'){
      if(!count(d.turn)||!count(d.step))return;fact.turn=d.turn;fact.step=d.step;
    }else if(event.type==='compaction/summary'){
      if(d.llmStreamCall!==true)return;fact.provider=text(d.provider);fact.model=text(d.model);fact.usage=normalizeNativeUsage(d.usage);fact.compactionId=text(d.compactionId);
    }else return;
    const key=id([sessionId,event.seq]);if(!this.store.get('stats-native',key))this.store.put('stats-native',key,fact);
  }
  recordAuxiliary(sessionId:string,call:AuxiliaryUsage):void{
    if(!call.id||!count(call.at))return;const key=id([sessionId,call.id]);
    const old=this.store.get<{usage?:TokenUsage}>('stats-auxiliary',key);
    this.store.put('stats-auxiliary',key,{sessionId,...call,provider:text(call.provider)??'unknown',model:text(call.model)??'unknown',usage:normalizeNativeUsage(call.usage)??old?.usage});
  }
  observeGroup(input:GroupObservation):void{
    if(!input.botId||!input.groupId)return;this.store.transaction(()=>{
      const at=count(input.at)?input.at:this.now();const key=id([input.botId,input.groupId]);const old=this.store.get<GroupRecord>('stats-group',key);
      if(input.eventId){const eventKey=id([input.botId,input.groupId,input.eventId,input.event]);if(this.store.get('stats-group-event',eventKey))return;this.store.put('stats-group-event',eventKey,{at});}
      const membership=input.event!=='observed'&&at>=(old?.membershipAt??0);
      this.store.put('stats-group',key,{...old,botId:input.botId,groupId:input.groupId,name:text(input.name)??old?.name,state:membership?input.event:old?.state??'observed',firstSeenAt:Math.min(old?.firstSeenAt??at,at),lastSeenAt:Math.max(old?.lastSeenAt??at,at),membershipAt:membership?at:old?.membershipAt,complete:false} satisfies GroupRecord);
    });
  }
  private calls():UsageCall[]{
    const owners=new Map(this.store.list<SessionOwner>('stats-session').map(s=>[s.sessionId,s]));const calls:UsageCall[]=[];
    const auxiliary=this.store.list<AuxiliaryUsage&{sessionId:string}>('stats-auxiliary');const auxKeys=new Set(auxiliary.map(c=>id([c.sessionId,c.id])));
    const facts=this.store.list<NativeFact>('stats-native').sort((a,b)=>a.sessionId.localeCompare(b.sessionId)||a.seq-b.seq);
    let session='',provider='unknown',model='unknown',last:{turn:number;step:number;index:number}|undefined;
    for(const f of facts){const owner=owners.get(f.sessionId);if(!owner)continue;if(session!==f.sessionId){session=f.sessionId;provider='unknown';model='unknown';last=undefined;}
      if(f.type==='request/header'||f.type==='request/context'){provider=f.provider??'unknown';model=f.model??'unknown';continue;}
      if(f.type==='llm/retry-started'){if(last?.turn===f.turn&&last?.step===f.step)last=undefined;continue;}
      const call:UsageCall={id:id([f.sessionId,f.seq]),botId:owner.botId,provider:f.provider??provider,model:f.model??model,kind:f.type==='compaction/summary'?'compaction':owner.kind,at:f.time,usage:f.usage};
      if(f.type==='compaction/summary'){if(!f.compactionId||!auxKeys.has(id([f.sessionId,f.compactionId])))calls.push(call);continue;}
      if(last&&last.turn===f.turn&&last.step===f.step){const previous=calls[last.index];calls[last.index]={...call,id:previous.id,usage:call.usage??previous.usage};}
      else{calls.push(call);last={turn:f.turn!,step:f.step!,index:calls.length-1};}
    }
    for(const auxiliaryCall of auxiliary){const owner=owners.get(auxiliaryCall.sessionId);if(owner)calls.push({id:id([auxiliaryCall.sessionId,auxiliaryCall.id]),botId:owner.botId,provider:auxiliaryCall.provider,model:auxiliaryCall.model,at:auxiliaryCall.at,kind:auxiliaryCall.kind,usage:normalizeNativeUsage(auxiliaryCall.usage)});}
    const bindings=new Map(this.store.list<SessionBinding>('binding').filter(binding=>{
      const scope=binding?.scope;if(!scope||!['qq','weixin'].includes(scope.platform)||!['private','group'].includes(scope.kind))return false;
      return [scope.botId,scope.accountId,scope.channelId,scope.senderId].every(value=>typeof value==='string'&&value.length>0)&&binding.key===scopeKey(scope);
    }).map(binding=>[binding.key,binding.scope.botId]));
    for(const job of this.store.list<{id:string;scope:string;botId?:string;provider?:string;requestedModel?:string;modelCalls?:MediaUsageCall[]}>('job')){
      const botId=job.botId??bindings.get(job.scope);if(!botId)continue;
      let modelCalls=job.modelCalls??[];
      // A worker may have dispatched upstream immediately before a process crash.
      if(!job.modelCalls&&/^[a-zA-Z0-9_-]{1,100}$/.test(job.id)){try{const raw=JSON.parse(readFileSync(path.join(this.store.home,'jobs',job.id,'model-usage.json'),'utf8'));if(Array.isArray(raw))modelCalls=raw.filter(c=>c?.attempted===true&&typeof c.id==='string'&&count(c.at)).map(c=>({id:c.id,attempted:true,at:c.at,provider:job.provider,model:text(c.model)??job.requestedModel,usage:normalizeProviderUsage(c.usage)}));}catch{/* Historical jobs without evidence remain unmetered. */}}
      const seen=new Set<string>();for(const call of modelCalls){if(call.attempted!==true||seen.has(call.id))continue;seen.add(call.id);calls.push({id:id([job.id,call.id]),botId,provider:call.provider??'unknown',model:call.model??'unknown',kind:'media',at:call.at,usage:normalizeNativeUsage(call.usage)});}
    }
    return calls;
  }
  query(input:StatsQueryInput={}):StatsResult{
    const q=statsQuerySchema.parse(input),range=statsWindow(q,this.now());const inRange=(at:number)=>at>=(range.from??0)&&(q.range==='custom'?at<range.to:at<=range.to);
    const availableBots=this.store.bots().filter(b=>!q.botId||b.id===q.botId);const state=this.status();const getStatus=(botId:string)=>'get' in state&&typeof state.get==='function'?state.get(botId):(state as Record<string,string>)[botId];
    const groups=this.store.list<GroupRecord>('stats-group').filter(g=>(!q.botId||g.botId===q.botId));
    const bots=availableBots.map(b=>({id:b.id,name:b.name,channel:b.channel,status:getStatus(b.id)??'stopped',online:getStatus(b.id)==='connected',groupSupport:b.channel==='weixin'?'unsupported' as const:'observed_only' as const,groupCount:groups.filter(g=>g.botId===b.id&&g.state!=='left').length,...usageZero(),...messageZero()}));
    const botMap=new Map(bots.map(b=>[b.id,b]));const summary={...usageZero(),...messageZero(),totalBots:bots.filter(b=>!this.store.bot(b.id).archived).length,onlineBots:bots.filter(b=>b.online).length};
    const modelMap=new Map<string,StatsResult['models'][number]>(),trendMap=new Map<string,StatsResult['trend'][number]>();
    const trend=(at:number)=>{const date=shanghaiDay(at);let entry=trendMap.get(date);if(!entry){entry={date,...usageZero(),...messageZero()};trendMap.set(date,entry);}return entry;};
    const allCalls=this.calls();for(const call of allCalls){if(!botMap.has(call.botId)||!inRange(call.at)||(q.model&&call.model!==q.model)||(q.provider&&call.provider!==q.provider)||(q.kind&&call.kind!==q.kind))continue;
      const key=id([call.botId,call.provider,call.model,call.kind]);let row=modelMap.get(key);if(!row){row={botId:call.botId,provider:call.provider,model:call.model,kind:call.kind,...usageZero()};modelMap.set(key,row);}for(const total of [summary,botMap.get(call.botId)!,row,trend(call.at)])addUsage(total,call);
    }
    const inbox=(this.store.db.prepare('SELECT json FROM inbox').all() as {json:string}[]).map(r=>JSON.parse(r.json) as InboundMessage);
    for(const message of inbox){const bot=botMap.get(message.scope.botId);if(bot&&inRange(message.timestamp)){summary.received++;bot.received++;trend(message.timestamp).received++;}}
    let unknownSentTime=0;
    for(const delivery of this.store.deliveries()){
      const bot=botMap.get(delivery.botId);if(!bot)continue;const d=delivery as typeof delivery&{sentAt?:number;updatedAt?:number;createdAt?:number};
      // An unknown delivery has no trustworthy send timestamp. Its update or
      // creation time must not turn it into a dated successful send, especially
      // when querying a fixed historical window.
      const at=delivery.state==='sent'?d.sentAt:delivery.state==='unknown'?undefined:d.updatedAt??d.createdAt;
      if(delivery.state==='sent'&&!count(at)){unknownSentTime++;bot.unknownSentTime++;summary.unknownSentTime++;}
      if(!count(at)?q.range!=='all':!inRange(at))continue;
      const key=delivery.state==='sending'||delivery.state==='pending'?'pending':delivery.state;
      summary[key]++;bot[key]++;if(count(at))trend(at)[key]++;
    }
    const meta=this.store.get<{collectionStartedAt:number}>('stats-meta','coverage')!;
    return{timezone:'Asia/Shanghai',range,coverage:{...meta,earliestMessageAt:inbox.length?inbox.reduce((earliest,m)=>Math.min(earliest,m.timestamp),Infinity):null,earliestUsageAt:allCalls.length?allCalls.reduce((earliest,c)=>Math.min(earliest,c.at),Infinity):null,unknownSentTime,legacyUsage:'available_evidence_only',groupListComplete:false},summary,bots,models:[...modelMap.values()].sort((a,b)=>b.knownTokens-a.knownTokens),trend:[...trendMap.values()].sort((a,b)=>a.date.localeCompare(b.date)),groups:q.groups?groups:[]};
  }
}
