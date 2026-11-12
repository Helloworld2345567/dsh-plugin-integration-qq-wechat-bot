import {spawn} from 'node:child_process';
export {jobEnvironment} from './process-environment.js';

/** One bounded JSON exchange. Cancellation waits for process-tree termination. */
export async function runJsonProcess(command:string,args:string[],request:unknown,options:{cwd:string;signal:AbortSignal;timeoutMs?:number;env?:NodeJS.ProcessEnv;maxOutputBytes?:number}):Promise<any>{
  options.signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:options.cwd,env:options.env,windowsHide:true,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
    const chunks:Buffer[]=[];let size=0,aborted=false,overflow=false,killing:Promise<void>|undefined;
    const abort=()=>{if(aborted)return;aborted=true;killing=new Promise(done=>{
      if(process.platform==='win32'&&child.pid){const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',()=>{child.kill();done();});killer.once('close',()=>done());}
      else {if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}done();}
    });};
    const timer=options.timeoutMs?setTimeout(abort,options.timeoutMs):undefined;timer?.unref();
    options.signal.addEventListener('abort',abort,{once:true});
    const clean=()=>{if(timer)clearTimeout(timer);options.signal.removeEventListener('abort',abort);};
    const fail=async(error:Error)=>{abort();await killing;clean();reject(error);};
    child.stdout.on('error',fail);child.stderr.on('error',fail);
    child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>(options.maxOutputBytes??2*1024*1024)){overflow=true;abort();}else chunks.push(chunk);});
    // Drain stderr without returning provider URLs, credentials or tracebacks.
    child.stderr.resume();child.stdin.on('error',()=>{});
    child.once('error',fail);
    child.once('close',async code=>{clean();await killing;if(overflow)return reject(Error('WORKER_OUTPUT_TOO_LARGE'));if(aborted||options.signal.aborted)return reject(Error('MEDIA_CANCELLED_OR_TIMEOUT'));try{const response=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(code&&!response.error)throw Error('WORKER_PROCESS_FAILED');resolve(response);}catch{reject(Error('WORKER_RESPONSE_INVALID'));}});
    child.stdin.end(JSON.stringify(request));if(options.signal.aborted)abort();
  });
}
