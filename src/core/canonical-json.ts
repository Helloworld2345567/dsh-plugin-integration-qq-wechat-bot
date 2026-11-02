import {createHash} from 'node:crypto';

export interface CanonicalJsonLimits {maxBytes:number;maxDepth:number;maxNodes:number;maxObjectKeys:number;maxArrayLength:number}
const DEFAULT_LIMITS:CanonicalJsonLimits={maxBytes:256*1024,maxDepth:32,maxNodes:20_000,maxObjectKeys:2_000,maxArrayLength:10_000};
export type JsonPrimitive=null|boolean|number|string;
export type JsonValue=JsonPrimitive|JsonValue[]|{[key:string]:JsonValue};

export function canonicalJson(input:unknown,limits:Partial<CanonicalJsonLimits>={}):string {
  const policy={...DEFAULT_LIMITS,...limits};let nodes=0;
  const encode=(value:unknown,depth:number):string=>{
    if(++nodes>policy.maxNodes||depth>policy.maxDepth)throw new Error('CANONICAL_JSON_COMPLEXITY_LIMIT');
    if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
    if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('CANONICAL_JSON_VALUE_INVALID');return JSON.stringify(value);}
    if(Array.isArray(value)){if(value.length>policy.maxArrayLength)throw new Error('CANONICAL_JSON_ARRAY_LIMIT');return`[${value.map(item=>encode(item,depth+1)).join(',')}]`;}
    if(typeof value!=='object'||!value||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('CANONICAL_JSON_VALUE_INVALID');
    const object=value as Record<string,unknown>,keys=Object.keys(object).sort();if(keys.length>policy.maxObjectKeys)throw new Error('CANONICAL_JSON_OBJECT_LIMIT');
    return`{${keys.map(key=>`${JSON.stringify(key)}:${encode(object[key],depth+1)}`).join(',')}}`;
  };
  const result=encode(input,0);if(Buffer.byteLength(result)>policy.maxBytes)throw new Error('CANONICAL_JSON_BYTE_LIMIT');return result;
}
export function canonicalJsonHash(input:unknown,limits?:Partial<CanonicalJsonLimits>):string{return createHash('sha256').update(canonicalJson(input,limits)).digest('hex');}
export function immutableJson<T>(input:T,limits?:Partial<CanonicalJsonLimits>):T {const value=JSON.parse(canonicalJson(input,limits)) as T;const freeze=(item:unknown):void=>{if(!item||typeof item!=='object'||Object.isFrozen(item))return;for(const child of Object.values(item))freeze(child);Object.freeze(item);};freeze(value);return value;}
