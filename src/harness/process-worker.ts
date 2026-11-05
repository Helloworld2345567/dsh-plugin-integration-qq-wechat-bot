import path from 'node:path';
import {runJsonProcess,jobEnvironment} from './json-process.js';
import {packageRoot} from '../core/paths.js';
import {MEDIA_WORKER_PROTOCOL,MEDIA_WORKER_PROTOCOL_VERSION,validateMediaWorkerJob,validateMediaWorkerResult,type MediaWorkerJob,type WorkerPort,type WorkerCredentials} from '../core/worker-port.js';
import type {MediaResult} from '../core/media.js';
import {isPublicPythonErrorCode} from '../core/python-worker-errors.js';

export function safeWorkerErrorCode(value:unknown):string{return isPublicPythonErrorCode(value)?value:'MEDIA_WORKER_FAILED';}

/** Harness-side worker implementation; core only sees WorkerPort. */
export class ProcessWorker implements WorkerPort {
  readonly pythonRoot=path.join(packageRoot(),'python');
  constructor(readonly python = process.env.BOT_PYTHON || 'python', workerFile?:never) {if(workerFile!==undefined)throw Error('MEDIA_WORKER_PATH_OVERRIDE_FORBIDDEN');}
  async run(job: MediaWorkerJob, signal: AbortSignal, credentials: WorkerCredentials = {}): Promise<MediaResult> {
    validateMediaWorkerJob(job);
      const safeEnv=jobEnvironment(job.output,this.pythonRoot);
      const keyEnv=typeof job.endpoint?.keyEnv==='string'?job.endpoint.keyEnv:undefined;
      for(const [key,value] of Object.entries(credentials)){
        if(!/^[A-Z][A-Z0-9_]{0,127}$/.test(key)||typeof value!=='string'||value.length>8192||keyEnv!==key)throw new Error('MEDIA_WORKER_CREDENTIALS_INVALID');
        safeEnv[key]=value;
      }
      let response=await runJsonProcess(this.python,['-B','-P','-u','-m','dsh_bot_runtime.worker'],job,{cwd:job.output,env:safeEnv,signal,timeoutMs:job.timeoutMs});
      if(response.error)throw new Error(safeWorkerErrorCode(response.error?.code));
      if(response.protocol!==undefined||response.protocolVersion!==undefined){if(response.protocol!==MEDIA_WORKER_PROTOCOL||response.protocolVersion!==MEDIA_WORKER_PROTOCOL_VERSION)throw new Error('MEDIA_WORKER_PROTOCOL_UNSUPPORTED');response=response.result;}
      validateMediaWorkerResult(response);return response;
  }
}
