import {spawn} from 'node:child_process';
import path from 'node:path';
import {packageRoot} from '../core/paths.js';
import {MEDIA_WORKER_PROTOCOL,MEDIA_WORKER_PROTOCOL_VERSION,validateMediaWorkerJob,validateMediaWorkerResult,type MediaWorkerJob,type WorkerPort,type WorkerCredentials} from '../core/worker-port.js';
import type {MediaResult} from '../core/media.js';

/** Harness-side worker implementation; core only sees WorkerPort. */
export class ProcessWorker implements WorkerPort {
  constructor(readonly python = process.env.BOT_PYTHON || 'python', readonly workerFile = path.join(packageRoot(),'python','worker.py')) {}
  async run(job: MediaWorkerJob, signal: AbortSignal, credentials: WorkerCredentials = {}): Promise<MediaResult> {
    validateMediaWorkerJob(job);
    return new Promise((resolve, reject) => {
      const safeEnv:NodeJS.ProcessEnv={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,SYSTEMROOT:process.env.SYSTEMROOT,TEMP:process.env.TEMP,TMP:process.env.TMP,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'};
      const keyEnv=typeof job.endpoint?.keyEnv==='string'?job.endpoint.keyEnv:undefined;
      for(const [key,value] of Object.entries(credentials)){
        if(!/^[A-Z][A-Z0-9_]{0,127}$/.test(key)||typeof value!=='string'||value.length>8192||keyEnv!==key){reject(new Error('MEDIA_WORKER_CREDENTIALS_INVALID'));return;}
        safeEnv[key]=value;
      }
      const child=spawn(this.python,['-u',this.workerFile],{env:safeEnv,windowsHide:true,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
      let output='';let errors='';let kill:ReturnType<typeof setTimeout>|undefined;let timedOut=false;
      const abort=()=>{if(process.platform==='win32'&&child.pid)spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{child.kill();}}kill=setTimeout(()=>child.kill('SIGKILL'),1500);};
      const timer=setTimeout(()=>{timedOut=true;abort();},job.timeoutMs);timer.unref();signal.addEventListener('abort',abort,{once:true});
      child.stdout.on('data',chunk=>{output+=String(chunk);if(output.length>2*1024*1024)abort();});child.stderr.on('data',chunk=>{if(errors.length<2000)errors+=String(chunk);});
      const clean=()=>{clearTimeout(timer);if(kill)clearTimeout(kill);signal.removeEventListener('abort',abort);};
      child.once('error',error=>{clean();reject(error);});child.once('close',code=>{clean();if(signal.aborted||timedOut)return reject(new Error('MEDIA_CANCELLED_OR_TIMEOUT'));try{let response=JSON.parse(output.trim());if(code||response.error)throw new Error(response.error?.code||'MEDIA_WORKER_FAILED');if(response.protocol!==undefined||response.protocolVersion!==undefined){if(response.protocol!==MEDIA_WORKER_PROTOCOL||response.protocolVersion!==MEDIA_WORKER_PROTOCOL_VERSION)throw new Error('MEDIA_WORKER_PROTOCOL_UNSUPPORTED');response=response.result;}validateMediaWorkerResult(response);resolve(response);}catch(error){reject(error instanceof Error?error:new Error(`MEDIA_WORKER_FAILED${errors?`: ${errors}`:''}`));}});
      child.stdin.end(JSON.stringify(job));if(signal.aborted)abort();
    });
  }
}
