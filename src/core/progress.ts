import type {SystemLocale} from '../i18n/common.js';
import {systemMessage,type SystemMessageKey} from '../i18n/system.js';
import {randomUUID} from 'node:crypto';

export type ProgressStage='attachments'|'transcription'|'model'|'tool'|'image'|'media'|'search';
export interface ProgressFacts {stage:ProgressStage;elapsedSeconds:number;previousText?:string}
export const PROGRESS_INTERVAL_MS=60_000;
export const PROGRESS_GENERATION_MS=8_000;
export const PROGRESS_SEND_MS=10_000;
const descriptions:Record<ProgressStage,SystemMessageKey>={attachments:'progressAttachments',transcription:'progressTranscription',model:'progressModel',tool:'progressTool',image:'progressImage',media:'progressMedia',search:'progressSearch'};
export function progressFallback(stage:ProgressStage,locale:SystemLocale='zh'):string{return systemMessage(locale,descriptions[stage]);}
export function progressText(value:string):string|undefined {
  const text=value.trim();
  if(!text||[...text].length>80||/[\r\n]|```|!\[|\]\(|<[^>]+>/.test(text))return;
  return text;
}
/** Stop waiting even when an upstream provider fails to honour cancellation. */
export function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason??new Error('ABORTED'));
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
    work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export interface ProgressOptions {
  systemLocale?:SystemLocale;
  signal:AbortSignal;
  active:()=>boolean;
  intervalMs?:number;
  format:(facts:ProgressFacts,signal:AbortSignal)=>Promise<string>;
  deliver:(text:string,runId:string,sequence:number,expiresAt:number)=>Promise<void>;
  cancel:(runId:string)=>void;
}
/** One in-memory heartbeat per foreground task; the outbox owns delivery evidence. */
export class TaskProgress {
  readonly runId=randomUUID();
  private readonly controller=new AbortController();
  private readonly startedAt=Date.now();
  private readonly timer:ReturnType<typeof setInterval>;
  private readonly intervalMs:number;
  private stage:ProgressStage='attachments';
  private version=0;
  private sequence=0;
  private busy=false;
  private previousText?:string;
  private readonly abort=()=>this.stop();
  constructor(private readonly options:ProgressOptions){
    this.intervalMs=options.intervalMs??PROGRESS_INTERVAL_MS;
    this.timer=setInterval(()=>{void this.tick();},this.intervalMs);
    this.timer.unref?.();
    options.signal.addEventListener('abort',this.abort,{once:true});
    if(options.signal.aborted)this.stop();
  }
  update(stage:ProgressStage):void{if(this.stage!==stage){this.stage=stage;this.version++;}}
  private active():boolean{return !this.controller.signal.aborted&&!this.options.signal.aborted&&this.options.active();}
  stop():void{
    if(this.controller.signal.aborted)return;
    clearInterval(this.timer);this.controller.abort();this.options.signal.removeEventListener('abort',this.abort);this.options.cancel(this.runId);
  }
  private async tick():Promise<void>{
    if(this.busy||!this.active())return;
    this.busy=true;
    const expiresAt=Date.now()+this.intervalMs,version=this.version;
    const deadline=new AbortController();const timeout=setTimeout(()=>deadline.abort(new Error('PROGRESS_GENERATION_TIMEOUT')),PROGRESS_GENERATION_MS);
    const signal=AbortSignal.any([this.controller.signal,this.options.signal,deadline.signal]);
    let text:string|undefined;
    try{
      try{text=progressText(await abortable(Promise.resolve().then(()=>this.options.format({stage:this.stage,elapsedSeconds:Math.floor((Date.now()-this.startedAt)/1000),previousText:this.previousText},signal)),signal));}catch{}
      finally{clearTimeout(timeout);}
      if(!this.active()||Date.now()>=expiresAt)return;
      if(version!==this.version)text=undefined;
      text??=progressFallback(this.stage,this.options.systemLocale);
      await this.options.deliver(text,this.runId,++this.sequence,expiresAt);
      this.previousText=text;
    }catch{/* Reminder errors never change the foreground task's outcome. */}
    finally{this.busy=false;}
  }
}
