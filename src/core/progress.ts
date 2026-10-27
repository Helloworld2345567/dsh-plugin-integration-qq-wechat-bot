import {randomUUID} from 'node:crypto';

export type ProgressStage='attachments'|'transcription'|'model'|'tool'|'image'|'media'|'search';
export interface ProgressFacts {stage:ProgressStage;elapsedSeconds:number;previousText?:string}
export const PROGRESS_INTERVAL_MS=60_000;
export const PROGRESS_GENERATION_MS=8_000;
export const PROGRESS_SEND_MS=10_000;
const descriptions:Record<ProgressStage,string>={attachments:'附件还在准备中',transcription:'语音还在转写中',model:'请求还在处理中',tool:'当前任务步骤还在执行中',image:'图片还在处理中',media:'媒体还在处理中',search:'资料还在查找中'};
export function progressFallback(stage:ProgressStage):string{return `${descriptions[stage]}，暂时还没有最终结果。`;}
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
  signal:AbortSignal;
  active:()=>boolean;
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
  private stage:ProgressStage='attachments';
  private version=0;
  private sequence=0;
  private busy=false;
  private previousText?:string;
  private readonly abort=()=>this.stop();
  constructor(private readonly options:ProgressOptions){
    this.timer=setInterval(()=>{void this.tick();},PROGRESS_INTERVAL_MS);
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
    const expiresAt=Date.now()+PROGRESS_INTERVAL_MS,version=this.version;
    const deadline=new AbortController();const timeout=setTimeout(()=>deadline.abort(new Error('PROGRESS_GENERATION_TIMEOUT')),PROGRESS_GENERATION_MS);
    const signal=AbortSignal.any([this.controller.signal,this.options.signal,deadline.signal]);
    let text:string|undefined;
    try{
      try{text=progressText(await abortable(Promise.resolve().then(()=>this.options.format({stage:this.stage,elapsedSeconds:Math.floor((Date.now()-this.startedAt)/1000),previousText:this.previousText},signal)),signal));}catch{}
      finally{clearTimeout(timeout);}
      if(!this.active()||Date.now()>=expiresAt)return;
      if(version!==this.version)text=undefined;
      text??=progressFallback(this.stage);
      await this.options.deliver(text,this.runId,++this.sequence,expiresAt);
      this.previousText=text;
    }catch{/* Reminder errors never change the foreground task's outcome. */}
    finally{this.busy=false;}
  }
}
