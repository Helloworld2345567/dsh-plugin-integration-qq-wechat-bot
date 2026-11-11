import {randomUUID} from 'node:crypto';
import type {SessionBinding,TurnSnapshot} from './types.js';
import type {BindingRepository} from './ports/session.js';
import type {MusicCandidate, SingingCandidate, SingingAttempt, SingingCandidates, SingingStateRepository} from './ports/media.js';

export type {SingingCandidate,SingingAttempt,SingingCandidates};
export interface SingingTurn {attempted:boolean}

export interface SingingSessionPorts {
  bindings: BindingRepository;
  singing: SingingStateRepository;
}

export function assertSingingSession(bindings:BindingRepository,binding:SessionBinding):void {
  const current=bindings.findBinding(binding.key);
  if(!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation)throw Error('SINGING_SESSION_CHANGED');
}
export function singingCandidates(ports:SingingSessionPorts,binding:SessionBinding):SingingCandidates|undefined {
  const current=ports.bindings.findBinding(binding.key);if(!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation)return;
  const value=ports.singing.candidates(binding.key);
  return value&&value.scope===binding.key&&value.sessionId===binding.sessionId&&value.generation===binding.generation?value:undefined;
}
export function hasPendingSingingUpload(ports:SingingSessionPorts,binding:SessionBinding):boolean {return singingCandidates(ports,binding)?.waiting===true;}
export function consumeSingingUpload(ports:SingingSessionPorts,binding:SessionBinding):void {const value=singingCandidates(ports,binding);if(value?.waiting)ports.singing.saveCandidates(binding.key,{...value,waiting:false});}
export function clearSingingCandidates(singing:SingingStateRepository,scope:string):void {singing.saveCandidates(scope,null);}
export function clearPendingSingingUpload(ports:SingingSessionPorts,binding:SessionBinding):void {const value=singingCandidates(ports,binding);if(value?.waiting)clearSingingCandidates(ports.singing,binding.key);}
export function explicitSingingRequest(text:string):boolean {
  // Only user-authored request lines qualify; quoted material and fenced content do not.
  const plain=text.replace(/```[\s\S]*?(?:```|$)/g,'').split(/\r?\n/).filter(line=>!/^\s*(?:>|引用|转发|网页|以下内容|quote(?:d)?\s*:|forwarded\s*:|web(?:page)?\s*:|following content\s*:)/i.test(line))
    .map(line=>line.replace(/["“][^"”]*["”]/g,'').replace(/(?<![\p{L}\p{N}])'[^'\r\n]*'(?![\p{L}\p{N}])/gu,''))
    .flatMap(line=>line.split(/[，,。；;！？!?]/)).filter(clause=>!/(?:不要|不用|无需|别|暂不|先不|不想).{0,20}(?:翻唱|变声|换声|音色转换|STS)|\b(?:do not|don[’']t|never|avoid|stop|without|no need to|not)\b.{0,60}\b(?:sing|cover|convert|change|use your voice|sts)\b/i.test(clause)).join('\n');
  const english=/(?:^|\n)\s*(?:(?:please\s+)?(?:(?:can|could|would|will) you\s+|(?:i want|i would like|i[’']d like) you to\s+|help me\s+)?(?:please\s+)?)(?:sing(?:\s|$)|cover\s+(?:this|that|the|a|my)\s+song\b|(?:convert|change)\s+(?:(?:this|that|these|those|the|my)\s+)?(?:vocals?|voice|singing|song|audio)\b|use your voice\s+(?:to sing|for (?:this|that|the) (?:song|cover))\b)/i.test(plain);
  return english||/(?:把|将|帮我|请|给我|我要|我想|用你).{0,80}(?:唱歌|唱一下|演唱|翻唱|变声|换声|音色转换|转换.{0,12}(?:音色|歌声))|(?:帮我|请|给我|我要|我想).{0,20}唱|(?:唱歌|演唱|翻唱|变声|音色转换|STS)(?:一下|这|该|此|请求|转换|\s*$)/i.test(plain);
}
export function saveSingingCandidates(ports:SingingSessionPorts,binding:SessionBinding,candidates:Omit<SingingCandidate,'number'>[],waiting=false):SingingCandidates {
  assertSingingSession(ports.bindings,binding);
  const value:SingingCandidates={id:randomUUID(),scope:binding.key,sessionId:binding.sessionId,generation:binding.generation,waiting,candidates:candidates.map((item,index)=>({...item,number:index+1})),createdAt:Date.now()};
  ports.singing.saveCandidates(binding.key,value);return value;
}
export function singingRequestKey(binding:SessionBinding,snapshot:TurnSnapshot):string {return JSON.stringify([binding.sessionId,binding.generation,snapshot.sourceIds,snapshot.sourceIds.length?undefined:snapshot.startedAt]);}
export function publicSingingCandidates(value:SingingCandidates|undefined){return value?{status:value.waiting?'waiting_for_audio':'prepared',candidateSet:value.id,candidates:value.candidates.map(({assetId:_,number,...item})=>({...item,candidate:number}))}:{status:'empty',candidates:[]};}
export type {MusicCandidate};
