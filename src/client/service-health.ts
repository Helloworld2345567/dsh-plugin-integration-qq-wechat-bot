import type {Translate} from './locale.js';

type ServiceProfile={serviceId:string;profileId:string;state:string;capabilities:readonly string[]};
export interface PanelServiceHealth {state:string;safeDiagnostic?:string;checkedAt?:number;expiresAt?:number}
type Query=(name:string,input:any,signal?:AbortSignal)=>Promise<any>;

export async function loadPanelServiceHealth(query:Query,profiles:readonly ServiceProfile[],signal?:AbortSignal):Promise<Record<string,PanelServiceHealth>> {
  const entries=await Promise.all(['gpt-sovits','breeze-tts'].map(async serviceId=>{
    const candidates=profiles.filter(profile=>profile.serviceId===serviceId&&profile.capabilities.includes(`${serviceId}.speak`));
    const profile=candidates.find(item=>item.state==='ready')??candidates.find(item=>item.state==='partial');
    if(!profile)return[serviceId,{state:candidates.length?'unknown':'missing'}] as const;
    try{
      signal?.throwIfAborted();
      const health=await query('service.health',{serviceId,profileId:profile.profileId},signal);
      signal?.throwIfAborted();
      return[serviceId,health??{state:'unknown'}] as const;
    }catch(error){
      signal?.throwIfAborted();
      return[serviceId,{state:'unknown',safeDiagnostic:error instanceof Error?error.message:String(error)}] as const;
    }
  }));
  return Object.fromEntries(entries);
}

export function serviceHealthLabel(value:PanelServiceHealth|undefined,t:Translate):string {
  switch(value?.state){
    case 'ready':return t('serviceReady');
    case 'degraded':return t('error');
    case 'unavailable':return t('serviceUnavailable');
    case 'blocked':return t('unavailable');
    case 'disabled':return t('closed');
    case 'missing':return t('pendingConfig');
    default:return t('unknown');
  }
}

export function modelLibraryLabel(report:{state?:string;checkedAt?:number}|undefined,t:Translate):string {
  if(!report?.checkedAt)return t('unknown');
  switch(report.state){
    case 'ready':return t('configured');
    case 'partial':case 'blocked':return t('error');
    case 'missing':return t('pendingConfig');
    default:return t('unknown');
  }
}
