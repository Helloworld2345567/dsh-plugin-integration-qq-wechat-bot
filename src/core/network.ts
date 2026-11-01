import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';

export interface UrlPolicy {hosts?:ReadonlySet<string>;hostSuffixes?:ReadonlySet<string>;allowHttp?:boolean;allowQuery?:boolean;allowPorts?:ReadonlySet<string>}
export const DEFAULT_REMOTE_URL_POLICY:UrlPolicy=Object.freeze({allowHttp:false,allowQuery:true,allowPorts:new Set([''])});
function normalizeHost(host:string):string{return host.replace(/^\[|\]$/g,'').toLowerCase().replace(/\.$/,'');}
export function assertRemoteUrl(value:string,policy:UrlPolicy=DEFAULT_REMOTE_URL_POLICY):URL {
  let parsed:URL;try{parsed=new URL(value);}catch{throw new RemoteError('UNSAFE_MEDIA_URL');}
  const protocolOk=policy.allowHttp?parsed.protocol==='http:'||parsed.protocol==='https:':parsed.protocol==='https:';
  if(!protocolOk||parsed.username||parsed.password||(!policy.allowQuery&&parsed.search)||parsed.hash)throw new RemoteError('UNSAFE_MEDIA_URL');
  const ports=policy.allowPorts??new Set(['']);if(!ports.has(parsed.port))throw new RemoteError('UNSAFE_MEDIA_URL');
  const host=normalizeHost(parsed.hostname);if(policy.hosts&&!policy.hosts.has(host))throw new RemoteError('UNSAFE_MEDIA_HOST');if(policy.hostSuffixes&&!([...policy.hostSuffixes].some(suffix=>{const normalized=normalizeHost(suffix);return host===normalized||host.endsWith(`.${normalized}`)})))throw new RemoteError('UNSAFE_MEDIA_HOST');
  return parsed;
}

export function errorCauseCode(error:unknown):string|undefined {
  const value=error as {causeCode?:unknown;cause?:{code?:unknown}}|undefined;
  if(typeof value?.causeCode==='string'&&value.causeCode)return value.causeCode;
  if(typeof value?.cause?.code==='string'&&value.cause.code)return value.cause.code;
  return undefined;
}
export function errorCauseMessage(error:unknown):string|undefined {
  const value=error as {causeMessage?:unknown;cause?:{message?:unknown}}|undefined;
  if(typeof value?.causeMessage==='string'&&value.causeMessage)return value.causeMessage;
  if(typeof value?.cause?.message==='string'&&value.cause.message)return value.cause.message;
  return undefined;
}
export interface RemoteErrorDetails {platformCode?:string|number;platformMessage?:string;platformTraceId?:string}
const SECRET_FIELD=/(?:authorization|token|secret|password|cookie|api[_-]?key|aes[_-]?key|file_info|encrypt(?:ed)?_query_param)/i;
/** Keep actionable provider text without publishing credentials, URLs or local paths. */
export function sanitizeRemoteMessage(value:unknown,secrets:readonly string[]=[]):string|undefined {
  if(typeof value!=='string'||!value.trim())return;
  let text=value.slice(0,4096).replace(/[\x00-\x1f\x7f]/g,' ');
  for(const secret of secrets)if(secret.length>=4)text=text.split(secret).join('[redacted]');
  text=text.replace(/\b(?:https?|wss?|file):\/\/[^\s<>"']+/gi,'[redacted-url]')
    .replace(/\b(?:Bearer|QQBot)\s+[^\s,;"']+/gi,'[redacted-credential]')
    .replace(/\b(?:authorization|access[_-]?token|refresh[_-]?token|token|client[_-]?secret|app[_-]?secret|secret|password|cookie|api[_-]?key|aes[_-]?key|file_info|encrypt(?:ed)?_query_param)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'[redacted-credential]')
    .replace(/\b[A-Za-z]:[\\/][^\s,;"']+/g,'[redacted-path]')
    .replace(/[A-Za-z0-9_+\/-]{48,}={0,2}/g,'[redacted-value]');
  return text.replace(/\s+/g,' ').trim().slice(0,512)||undefined;
}
function diagnosticId(value:unknown,maximum=128):string|undefined {
  const text=typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?value.trim():'';
  return text.length<=maximum&&/^[A-Za-z0-9_.:-]+$/.test(text)?text:undefined;
}
function requestSecrets(init:RequestInit):string[]{
  const secrets:string[]=[];
  for(const [key,value] of new Headers(init.headers))if(SECRET_FIELD.test(key)){secrets.push(value);if(/^(?:Bearer|QQBot)\s+/i.test(value))secrets.push(value.replace(/^\S+\s+/,''));}
  if(typeof init.body==='string'&&init.body.length<=16*1024)try{const body=JSON.parse(init.body);if(body&&typeof body==='object')for(const [key,value] of Object.entries(body))if(SECRET_FIELD.test(key)&&typeof value==='string')secrets.push(value);}catch{/* Non-JSON request bodies carry no extracted fields. */}
  return secrets;
}
export class RemoteError extends Error {
  readonly platformCode?:string;
  readonly platformMessage?:string;
  readonly platformTraceId?:string;
  constructor(readonly code:string,readonly status?:number,readonly causeCode?:string,readonly causeMessage?:string,details:RemoteErrorDetails={}) {
    super(status ? `${code} (HTTP ${status})` : causeCode ? `${code} (${causeCode})` : code);
    this.name='RemoteError';
    this.platformCode=diagnosticId(details.platformCode,80);
    this.platformMessage=sanitizeRemoteMessage(details.platformMessage);
    this.platformTraceId=diagnosticId(details.platformTraceId);
  }
}
async function boundedResponseText(response:Response,maximum:number):Promise<string>{
  if(Number(response.headers.get('content-length'))>maximum){await response.body?.cancel().catch(()=>{});throw new RemoteError('RESPONSE_TOO_LARGE');}
  if(!response.body)return '';
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>maximum){await reader.cancel().catch(()=>{});throw new RemoteError('RESPONSE_TOO_LARGE');}chunks.push(next.value);}return Buffer.concat(chunks).toString('utf8');}
  finally{reader.releaseLock();}
}
export async function jsonRequest<T=Record<string,any>>(url:string,init:RequestInit={},timeout=20000):Promise<T> {
  const signal=init.signal ? AbortSignal.any([init.signal,AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  let response:Response;
  try{response=await fetch(url,{...init,signal,redirect:'error'});}
  catch(error){throw new RemoteError('REMOTE_NETWORK_FAILED',undefined,errorCauseCode(error),sanitizeRemoteMessage(errorCauseMessage(error),requestSecrets(init)));}
  if(!response.ok){
    let body:any;
    try{body=JSON.parse(await boundedResponseText(response,64*1024));}catch{/* HTTP rejection remains usable when the diagnostic body is absent or invalid. */}
    const error=body?.error&&typeof body.error==='object'?body.error:body;
    const details:RemoteErrorDetails={platformCode:error?.code??error?.errcode??error?.retcode,platformMessage:sanitizeRemoteMessage(error?.message??error?.msg??error?.errmsg,requestSecrets(init)),platformTraceId:response.headers.get('x-tps-trace-id')??response.headers.get('x-request-id')??response.headers.get('x-trace-id')??error?.trace_id??error?.traceId};
    throw new RemoteError('REMOTE_REQUEST_FAILED',response.status,undefined,undefined,details);
  }
  const body=await boundedResponseText(response,4*1024*1024);
  if(!body.trim())return {} as T;
  try{return JSON.parse(body) as T;}catch{throw new RemoteError('REMOTE_RESPONSE_INVALID');}
}
export function publicAddress(address:string):boolean {
  if(!isIP(address))return false;
  // Admit globally routable IPv6 unicast only; mapped, local, multicast and docs are excluded.
  if(address.includes(':')) return /^[23]/.test(address)&&!/^2001:(?:0*0:|0*2:|0*10:|0*20:|db8:)/i.test(address)&&!address.includes('.');
  const n=address.split('.').map(Number);
  return ![0,10,127].includes(n[0]) && !(n[0]===169&&n[1]===254) && !(n[0]===172&&n[1]>=16&&n[1]<=31) && !(n[0]===192&&(n[1]===168||n[1]===0||n[1]===2)) && !(n[0]===100&&n[1]>=64&&n[1]<=127) && !(n[0]===198&&(n[1]===18||n[1]===19||n[1]===51)) && !(n[0]===203&&n[1]===0&&n[2]===113) && n[0]<224;
}
function proxyBenchmarkAddress(address:string):boolean {
  if(isIP(address)===4){const parts=address.split('.').map(Number);return parts[0]===198&&(parts[1]===18||parts[1]===19);}
  return isIP(address)===6&&/^2001:0*2:(?:0*:|:)/i.test(address);
}
/** Resolve, validate and pin DNS for each redirect. No bearer headers travel to attachment URLs. */
export async function download(url:string,signal:AbortSignal,limit=50*1024*1024,redirects=0,policy:UrlPolicy=DEFAULT_REMOTE_URL_POLICY):Promise<Buffer> {
  if(redirects>3) throw new RemoteError('TOO_MANY_REDIRECTS');
  const parsed=assertRemoteUrl(url,policy); const host=parsed.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(host) ? [{address:host,family:isIP(host)}] : await lookup(host,{all:true});
  // TUN proxies return benchmark-range fake DNS for official attachment hosts.
  // Keep the HTTPS hostname (and normal certificate verification), and admit
  // these answers only for an exact domain already selected by the adapter.
  const proxyHost=parsed.protocol==='https:'&&!isIP(host)&&policy.hosts?.has(normalizeHost(host))===true;
  if(!addresses.length || addresses.some(a=>!publicAddress(a.address)&&!(proxyHost&&proxyBenchmarkAddress(a.address)))) throw new RemoteError('PRIVATE_MEDIA_ADDRESS');
  const chosen=addresses[0];
  return new Promise<Buffer>((resolve,reject)=>{
    // Node's autoSelectFamily requests all:true and expects an address array.
    // Return only the already validated/pinned address in either callback form.
    const request=https.get(parsed,{signal,timeout:30000,lookup:((_h:any,options:any,cb:any)=>options?.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)) as any},response=>{
      if(response.statusCode && response.statusCode>=300 && response.statusCode<400 && response.headers.location){ response.resume(); void download(new URL(response.headers.location,parsed).href,signal,limit,redirects+1,policy).then(resolve,reject); return; }
      if(response.statusCode!==200){response.resume();reject(new RemoteError('MEDIA_DOWNLOAD_FAILED',response.statusCode));return;}
      if(Number(response.headers['content-length']??0)>limit){response.destroy();reject(new RemoteError('MEDIA_TOO_LARGE'));return;}
      let total=0; const chunks:Buffer[]=[];
      response.on('data',(chunk:Buffer)=>{total+=chunk.length; if(total>limit){response.destroy(new RemoteError('MEDIA_TOO_LARGE'));}else chunks.push(chunk);});
      response.on('error',reject);response.on('end',()=>resolve(Buffer.concat(chunks)));
    });
    request.on('timeout',()=>request.destroy(new RemoteError('MEDIA_TIMEOUT')));request.on('error',reject);
  });
}
export async function backoff(attempt:number,signal:AbortSignal):Promise<void>{await delay(Math.min(30000,1000*2**Math.min(attempt,5)),undefined,{signal});}
