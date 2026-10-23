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

export class RemoteError extends Error { constructor(readonly code:string,readonly status?:number) { super(status ? `${code} (HTTP ${status})` : code); } }
export async function jsonRequest<T=Record<string,any>>(url:string,init:RequestInit={},timeout=20000):Promise<T> {
  const signal=init.signal ? AbortSignal.any([init.signal,AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  const response=await fetch(url,{...init,signal,redirect:'error'});
  if(!response.ok) throw new RemoteError('REMOTE_REQUEST_FAILED',response.status);
  const body=await response.text(); if(body.length>4*1024*1024) throw new RemoteError('RESPONSE_TOO_LARGE');
  return JSON.parse(body) as T;
}
export function publicAddress(address:string):boolean {
  if(!isIP(address))return false;
  // Admit globally routable IPv6 unicast only; mapped, local, multicast and docs are excluded.
  if(address.includes(':')) return /^[23]/.test(address)&&!/^2001:(?:0*0:|0*2:|0*10:|0*20:|db8:)/i.test(address)&&!address.includes('.');
  const n=address.split('.').map(Number);
  return ![0,10,127].includes(n[0]) && !(n[0]===169&&n[1]===254) && !(n[0]===172&&n[1]>=16&&n[1]<=31) && !(n[0]===192&&(n[1]===168||n[1]===0||n[1]===2)) && !(n[0]===100&&n[1]>=64&&n[1]<=127) && !(n[0]===198&&(n[1]===18||n[1]===19||n[1]===51)) && !(n[0]===203&&n[1]===0&&n[2]===113) && n[0]<224;
}
/** Resolve, validate and pin DNS for each redirect. No bearer headers travel to attachment URLs. */
export async function download(url:string,signal:AbortSignal,limit=50*1024*1024,redirects=0,policy:UrlPolicy=DEFAULT_REMOTE_URL_POLICY):Promise<Buffer> {
  if(redirects>3) throw new RemoteError('TOO_MANY_REDIRECTS');
  const parsed=assertRemoteUrl(url,policy); const host=parsed.hostname.replace(/^\[|\]$/g,'');
  const addresses=isIP(host) ? [{address:host,family:isIP(host)}] : await lookup(host,{all:true});
  if(!addresses.length || addresses.some(a=>!publicAddress(a.address))) throw new RemoteError('PRIVATE_MEDIA_ADDRESS');
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
