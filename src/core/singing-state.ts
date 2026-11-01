import {randomUUID} from 'node:crypto';
import type {Store} from './store.js';
import type {SessionBinding,TurnSnapshot} from './types.js';
import type {MusicCandidate} from './music-state.js';

export interface SingingCandidate {number:number;title:string;assetId?:string;url?:string;source?:string;license?:string}
export interface SingingCandidates {id:string;scope:string;sessionId:string;generation:number;waiting:boolean;candidates:SingingCandidate[];createdAt:number}
export interface SingingAttempt {request:string;state:'running'|'succeeded'|'failed';assetIds?:string[];code?:string;format?:string;music?:{selectionKey:string;track:MusicCandidate}}
export interface SingingTurn {attempted:boolean}

export function assertSingingSession(store:Store,binding:SessionBinding):void {
  const current=store.findBinding(binding.key);
  if(!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation)throw Error('SINGING_SESSION_CHANGED');
}
export function singingCandidates(store:Store,binding:SessionBinding):SingingCandidates|undefined {
  const current=store.findBinding(binding.key);if(!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation)return;
  const value=store.get<SingingCandidates>('singing-candidates',binding.key);
  return value&&value.scope===binding.key&&value.sessionId===binding.sessionId&&value.generation===binding.generation?value:undefined;
}
export function hasPendingSingingUpload(store:Store,binding:SessionBinding):boolean {return singingCandidates(store,binding)?.waiting===true;}
export function consumeSingingUpload(store:Store,binding:SessionBinding):void {const value=singingCandidates(store,binding);if(value?.waiting)store.put('singing-candidates',binding.key,{...value,waiting:false});}
export function clearSingingCandidates(store:Store,scope:string):void {store.put('singing-candidates',scope,null);}
export function clearPendingSingingUpload(store:Store,binding:SessionBinding):void {const value=singingCandidates(store,binding);if(value?.waiting)clearSingingCandidates(store,binding.key);}
export function explicitSingingRequest(text:string):boolean {
  // Only user-authored request lines qualify; quoted material and fenced content do not.
  const plain=text.replace(/```[\s\S]*?(?:```|$)/g,'').split(/\r?\n/).filter(line=>!/^\s*(?:>|引用|转发|网页|以下内容)/.test(line))
    .flatMap(line=>line.split(/[，,。；;！？!?]/)).filter(clause=>!/(?:不要|不用|无需|别|暂不|先不|不想).{0,20}(?:翻唱|变声|换声|音色转换|STS)/i.test(clause)).join('\n');
  return /(?:把|将|帮我|请|给我|我要|我想|用你).{0,80}(?:唱歌|唱一下|演唱|翻唱|变声|换声|音色转换|转换.{0,12}(?:音色|歌声))|(?:帮我|请|给我|我要|我想).{0,20}唱|(?:唱歌|演唱|翻唱|变声|音色转换|STS)(?:一下|这|该|此|请求|转换|\s*$)/i.test(plain);
}
export function saveSingingCandidates(store:Store,binding:SessionBinding,candidates:Omit<SingingCandidate,'number'>[],waiting=false):SingingCandidates {
  assertSingingSession(store,binding);
  const value:SingingCandidates={id:randomUUID(),scope:binding.key,sessionId:binding.sessionId,generation:binding.generation,waiting,candidates:candidates.map((item,index)=>({...item,number:index+1})),createdAt:Date.now()};
  store.put('singing-candidates',binding.key,value);return value;
}
export function singingRequestKey(binding:SessionBinding,snapshot:TurnSnapshot):string {return JSON.stringify([binding.sessionId,binding.generation,snapshot.sourceIds,snapshot.sourceIds.length?undefined:snapshot.startedAt]);}
export function publicSingingCandidates(value:SingingCandidates|undefined){return value?{status:value.waiting?'waiting_for_audio':'prepared',candidateSet:value.id,candidates:value.candidates.map(({assetId:_,...candidate})=>candidate)}:{status:'empty',candidates:[]};}
