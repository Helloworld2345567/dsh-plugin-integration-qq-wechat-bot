import {TransformSlots} from './transform-slots.js';
import {normalizeGptSovitsBaseUrl} from './voice-config.js';

/** Serializes the complete model/reference/inference sequence for an exclusive service. */
export class VoiceServiceQueue {
  private readonly services=new Map<string,{slots:TransformSlots;users:number}>();
  async acquire(baseUrl:string,signal:AbortSignal):Promise<()=>void>{
    const key=normalizeGptSovitsBaseUrl(baseUrl);
    let entry=this.services.get(key);
    if(!entry){entry={slots:new TransformSlots(1),users:0};this.services.set(key,entry);}
    entry.users++;
    const done=()=>{if(--entry.users===0)this.services.delete(key);};
    try{
      const lease=await entry.slots.acquire(1,signal);let released=false;
      return()=>{if(released)return;released=true;lease.release();done();};
    }catch(error){done();throw error;}
  }
}

export const voiceServiceQueue=new VoiceServiceQueue();
