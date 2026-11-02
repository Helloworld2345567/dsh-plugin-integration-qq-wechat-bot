import {spawn,type ChildProcess} from 'node:child_process';

export interface ControlledProcessRequest {jobId?:string;command:string;args:readonly string[];cwd:string;env:NodeJS.ProcessEnv;signal:AbortSignal;deadline:number;maxOutputBytes?:number;stdin?:Buffer}
export interface ControlledProcessResult {code:number|null;stdout:Buffer}
export interface ControlledProcessPort {run(request:ControlledProcessRequest):Promise<ControlledProcessResult>;cancel(jobId:string):Promise<'cancelled'|'unknown'>}

type Active={child:ChildProcess;settled:Promise<void>;killing?:Promise<'cancelled'|'unknown'>;reason?:'abort'|'deadline'|'overflow'|'cancel'};
async function terminateTree(child:ChildProcess):Promise<'cancelled'|'unknown'>{
  if(child.exitCode!==null)return'cancelled';
  try{
    if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await new Promise<void>((resolve,reject)=>{killer.once('error',reject);killer.once('close',code=>code===0||child.exitCode!==null?resolve():reject(Error('PROCESS_TREE_KILL_FAILED')));});}
    else if(child.pid){try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}
    await new Promise<void>((resolve,reject)=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>reject(Error('PROCESS_TREE_KILL_TIMEOUT')),20_000);child.once('close',()=>{clearTimeout(timer);resolve();});});return'cancelled';
  }catch{return'unknown';}
}
/** Fixed-command subprocess port. Cancellation resolves only after the whole tree exits. */
export class NodeControlledProcessPort implements ControlledProcessPort {
  private readonly active=new Map<string,Active>();
  async run(request:ControlledProcessRequest):Promise<ControlledProcessResult>{
    request.signal.throwIfAborted();if(request.deadline<=Date.now())throw Error('SERVICE_DEADLINE_EXCEEDED');
    const child=spawn(request.command,[...request.args],{cwd:request.cwd,env:request.env,windowsHide:true,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'}),chunks:Buffer[]=[];let bytes=0,overflow=false,settle!:()=>void,killing:Promise<'cancelled'|'unknown'>|undefined;const settled=new Promise<void>(resolve=>settle=resolve),active:Active={child,settled};if(request.jobId)this.active.set(request.jobId,active);
    const stop=(reason:Active['reason'])=>{active.reason??=reason;killing??=active.killing??=terminateTree(child);};const abort=()=>stop((request.signal.reason as {name?:string}|undefined)?.name==='TimeoutError'?'deadline':'abort');request.signal.addEventListener('abort',abort,{once:true});const timeout=setTimeout(()=>stop('deadline'),Math.max(1,request.deadline-Date.now()));timeout.unref();child.stdout?.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>(request.maxOutputBytes??2*1024*1024)){overflow=true;stop('overflow');}else chunks.push(chunk);});child.stderr?.resume();child.stdin?.on('error',()=>{});child.stdin?.end(request.stdin);
    try{return await new Promise<ControlledProcessResult>((resolve,reject)=>{child.once('error',reject);child.once('close',async code=>{if(overflow)return reject(Error('PROCESS_OUTPUT_TOO_LARGE'));if(killing||active.killing){const result=await(killing??active.killing!);return reject(Error(result==='unknown'?'PROCESS_TREE_STATE_UNKNOWN':active.reason==='deadline'?'SERVICE_DEADLINE_EXCEEDED':active.reason==='overflow'?'PROCESS_OUTPUT_TOO_LARGE':'PROCESS_CANCELLED_CONFIRMED'));}if(Date.now()>=request.deadline)return reject(Error('SERVICE_DEADLINE_EXCEEDED'));resolve({code,stdout:Buffer.concat(chunks)});});});}
    finally{clearTimeout(timeout);request.signal.removeEventListener('abort',abort);if(request.jobId)this.active.delete(request.jobId);settle();}
  }
  async cancel(jobId:string):Promise<'cancelled'|'unknown'>{const item=this.active.get(jobId);if(!item)return'cancelled';item.reason??='cancel';const result=await(item.killing??=terminateTree(item.child));if(result==='cancelled')await item.settled;return result;}
}
