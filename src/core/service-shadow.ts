import {sanitizeServiceDiagnostic} from './service-errors.js';
import type {ServiceResult} from './service-contract.js';

export interface NormalizedServiceResult {
  readonly text?:string;
  readonly outputs:readonly {kind:string;name:string}[];
  readonly observations?:unknown;
}
export interface ServiceShadowComparison {
  readonly serviceId:string;
  readonly operation:string;
  readonly actual:NormalizedServiceResult;
  readonly expected?:NormalizedServiceResult;
}
/** A comparator receives only normalized, already-produced results. It cannot execute work. */
export interface ServiceShadowComparator {compare(value:ServiceShadowComparison):void|Promise<void>}

const PRIVATE_KEY=/(?:^id$|path|url|endpoint|credential|token|secret|locator|provider|source|weights?|root|home)/i;
function safeObservation(value:unknown,depth=0):unknown {
  if(depth>6)return '[truncated]';
  if(typeof value==='string')return sanitizeServiceDiagnostic(value);
  if(value===null||typeof value==='number'||typeof value==='boolean')return value;
  if(Array.isArray(value))return value.slice(0,100).map(item=>safeObservation(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!PRIVATE_KEY.test(key)).slice(0,100).map(([key,item])=>[key,safeObservation(item,depth+1)]));
  return undefined;
}
export function normalizeServiceResult(value:ServiceResult):NormalizedServiceResult {
  return Object.freeze({
    ...(value.text?{text:sanitizeServiceDiagnostic(value.text,value.text)}:{}),
    outputs:Object.freeze(value.outputs.map(output=>Object.freeze({kind:output.kind,name:output.name})).sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name))),
    ...(value.observations===undefined?{}:{observations:safeObservation(value.observations)}),
  });
}
export async function compareProducedResult(comparator:ServiceShadowComparator|undefined,serviceId:string,operation:string,actual:ServiceResult,expected?:ServiceResult):Promise<void>{
  if(!comparator)return;
  await comparator.compare({serviceId,operation,actual:normalizeServiceResult(actual),...(expected?{expected:normalizeServiceResult(expected)}:{})});
}
