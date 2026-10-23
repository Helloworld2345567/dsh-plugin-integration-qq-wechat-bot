export type UsageKind='agent'|'subagent'|'compaction'|'media';
export interface TokenUsage {inputTokens:number;outputTokens:number;cacheReadTokens?:number;cacheWriteTokens?:number;reasoningTokens?:number;totalTokens?:number}
export interface MediaUsageCall {id:string;attempted:true;at:number;provider?:string;model?:string;usage?:TokenUsage}
export interface StatsSessionOwner {sessionId:string;botId:string;rootSessionId:string;kind:UsageKind}
export interface NativeUsageFact {sessionId:string;seq:number;time:number;type:string;turn?:number;step?:number;provider?:string;model?:string;usage?:TokenUsage;compactionId?:string}
export interface AuxiliaryUsageCall {id:string;at:number;provider:string;model:string;usage?:unknown;kind:'compaction'}
export type UsageEvent=
  | {type:'session.owner';sessionId:string;botId:string;rootSessionId:string;kind:UsageKind}
  | {type:'usage.context';sessionId:string;seq:number;at:number;provider?:string;model?:string}
  | {type:'usage.attempt';sessionId:string;seq:number;at:number;turn:number;step:number;provider?:string;model?:string;usage?:TokenUsage}
  | {type:'usage.retry';sessionId:string;seq:number;at:number;turn:number;step:number}
  | {type:'usage.compaction';sessionId:string;seq:number;at:number;callId?:string;provider?:string;model?:string;usage?:TokenUsage}
  | {type:'usage.auxiliary';sessionId:string;callId:string;at:number;provider:string;model:string;usage?:TokenUsage}
  | {type:'usage.media';jobId:string;callId:string;botId:string;at:number;provider:string;model:string;usage?:TokenUsage};
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
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
