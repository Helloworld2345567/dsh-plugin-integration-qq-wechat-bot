import {availableParallelism} from 'node:os';

interface Lease { slots:number; release:()=>void }
interface Waiting {maximum:number; signal:AbortSignal; resolve:(lease:Lease)=>void; reject:(error:unknown)=>void; cancel:()=>void}

/** One budget for file transforms and their FFmpeg segment processes. */
export class TransformSlots {
  private used=0;
  private readonly queue:Waiting[]=[];
  constructor(readonly capacity=Math.min(4,availableParallelism())) {
    if(!Number.isInteger(capacity)||capacity<1||capacity>4)throw new Error('TRANSFORM_CAPACITY_INVALID');
  }
  acquire(maximum:number,signal:AbortSignal):Promise<Lease> {
    signal.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const waiting:Waiting={maximum:Math.max(1,Math.min(2,maximum)),signal,resolve,reject,cancel:()=>{
        const index=this.queue.indexOf(waiting);
        if(index>=0){this.queue.splice(index,1);signal.removeEventListener('abort',waiting.cancel);reject(signal.reason??new Error('MEDIA_CANCELLED'));this.drain();}
      }};
      this.queue.push(waiting);signal.addEventListener('abort',waiting.cancel,{once:true});this.drain();
    });
  }
  private drain():void {
    while(this.queue.length&&this.used<this.capacity){
      const waiting=this.queue.shift()!;waiting.signal.removeEventListener('abort',waiting.cancel);
      if(waiting.signal.aborted){waiting.reject(waiting.signal.reason);continue;}
      const slots=Math.min(waiting.maximum,this.capacity-this.used);this.used+=slots;let released=false;
      waiting.resolve({slots,release:()=>{if(released)return;released=true;this.used-=slots;this.drain();}});
    }
  }
}

export const transformSlots=new TransformSlots();
