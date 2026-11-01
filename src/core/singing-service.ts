import {VoiceServiceQueue} from './voice-service-queue.js';
import {normalizeGptSovitsBaseUrl} from './voice-config.js';
import type {Store} from './store.js';

const queue=new VoiceServiceQueue();
const terminal=new Set(['cancelled','failed','succeeded']);
export const normalizeSingingServiceUrl=normalizeGptSovitsBaseUrl;
export function markSingingServiceStarted(store:Store,serviceUrl:string,jobId:string):void {store.put('singing-service-unknown',normalizeSingingServiceUrl(serviceUrl),{jobId,at:Date.now()});}
export function markSingingServiceFinished(store:Store,serviceUrl:string):void {store.put('singing-service-unknown',normalizeSingingServiceUrl(serviceUrl),null);}
async function request(baseUrl:string,route:string,method='GET'):Promise<any>{
  const response=await fetch(`${baseUrl}${route}`,{method,signal:AbortSignal.timeout(15_000)});
  if(response.status===404)return {status:'missing'};
  if(!response.ok)throw Error('SINGING_SERVICE_STATE_UNKNOWN');
  return await response.json();
}
/** Retains an uncertain service boundary across plugin restarts, until idle is confirmed. */
export async function acquireSingingService(store:Store,serviceUrl:string,signal:AbortSignal):Promise<()=>void>{
  const baseUrl=normalizeSingingServiceUrl(serviceUrl),release=await queue.acquire(baseUrl,signal);
  try{
    if(store.get('singing-service-unknown',baseUrl)){
      const health=await request(baseUrl,'/health');signal.throwIfAborted();
      if(health.protocol!=='rvc_http_v1'||health.status!=='ready'||health.activeJobId||health.queued!==0)throw Error('SINGING_SERVICE_STATE_UNKNOWN');
      store.put('singing-service-unknown',baseUrl,null);
    }
    return release;
  }catch(error){release();throw error instanceof Error&&error.message==='SINGING_SERVICE_STATE_UNKNOWN'?error:Error('SINGING_SERVICE_STATE_UNKNOWN');}
}
export async function confirmSingingStopped(store:Store,serviceUrl:string,jobId:string):Promise<void>{
  const baseUrl=normalizeSingingServiceUrl(serviceUrl);
  try{
    const result=await request(baseUrl,`/v1/jobs/${encodeURIComponent(jobId)}`,'DELETE');
    // Unknown IDs are cancelled by the service too, fencing a late POST submission.
    if(result.jobId!==jobId||!terminal.has(result.status))throw Error('SINGING_SERVICE_STATE_UNKNOWN');
    markSingingServiceFinished(store,baseUrl);
  }catch{
    markSingingServiceStarted(store,baseUrl,jobId);
    throw Error('SINGING_SERVICE_STATE_UNKNOWN');
  }
}
