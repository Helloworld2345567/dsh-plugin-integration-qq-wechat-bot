import {access} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';

export type LaunchableService='gpt-sovits'|'breeze-tts';
export interface ServiceLaunchSettings {
  serviceId:LaunchableService;
  baseUrl:string;
  projectRoot:string;
}
export interface ServiceStartResult {
  serviceId:LaunchableService;
  state:'ready'|'already-running';
  safeDiagnostic:string;
  pid?:number;
}
export interface ServiceLauncher {
  start(settings:ServiceLaunchSettings,signal:AbortSignal):Promise<ServiceStartResult>;
}

type HealthCheck=(serviceId:LaunchableService,baseUrl:string,signal:AbortSignal)=>Promise<boolean>;
type SpawnProcess=(file:string,args:readonly string[],cwd:string)=>Promise<number>;

const powershell=process.platform==='win32'?'pwsh.exe':'pwsh';
const trimUrl=(value:string)=>value.replace(/\/$/,'');

async function defaultHealth(serviceId:LaunchableService,baseUrl:string,signal:AbortSignal):Promise<boolean>{
  const response=await fetch(`${trimUrl(baseUrl)}${serviceId==='breeze-tts'?'/health':'/openapi.json'}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(2500)]),redirect:'error'});
  if(!response.ok)return false;
  if(serviceId!=='breeze-tts')return true;
  const value=await response.json().catch(()=>undefined) as {status?:unknown;sample_rate?:unknown}|undefined;
  return value?.status==='ok'&&value.sample_rate===24000;
}

async function defaultSpawn(file:string,args:readonly string[],cwd:string):Promise<number>{
  const child=spawn(file,[...args],{cwd,detached:true,stdio:'ignore',windowsHide:true});
  await new Promise<void>((resolve,reject)=>{child.once('spawn',()=>resolve());child.once('error',reject);});
  child.unref();
  return child.pid??0;
}

/** Starts only fixed, operator-configured launchers. It never stops or owns the child service. */
export class ExternalServiceLauncher implements ServiceLauncher {
  constructor(readonly health:HealthCheck=defaultHealth,readonly spawnProcess:SpawnProcess=defaultSpawn,readonly pollMs=500,readonly timeoutMs=180_000){}
  async start(settings:ServiceLaunchSettings,signal:AbortSignal):Promise<ServiceStartResult>{
    signal.throwIfAborted();
    const root=path.resolve(settings.projectRoot);
    if(!path.isAbsolute(settings.projectRoot)||/[\x00-\x1f]/.test(settings.projectRoot))throw Error('SERVICE_LAUNCH_ROOT_INVALID');
    const endpoint=new URL(settings.baseUrl),expectedPort=settings.serviceId==='breeze-tts'?'8080':'9880',actualPort=endpoint.port||(endpoint.protocol==='https:'?'443':'80');
    if(!['127.0.0.1','localhost','::1'].includes(endpoint.hostname)||actualPort!==expectedPort)throw Error('SERVICE_LAUNCH_ENDPOINT_MISMATCH');
    if(await this.health(settings.serviceId,settings.baseUrl,signal).catch(()=>false))return{serviceId:settings.serviceId,state:'already-running',safeDiagnostic:'服务已经在运行。'};
    let command:string,args:string[],cwd:string;
    if(settings.serviceId==='breeze-tts'){
      const script=path.join(root,'Start-Breeze.ps1');await access(script);command=powershell;args=['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',script];cwd=root;
    }else{
      const python=path.join(root,'.codex','venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
      const serviceRoot=path.join(root,'GPT-SoVITS'),config=path.join(serviceRoot,'GPT_SoVITS','configs','tts_local.yaml');
      await Promise.all([access(python),access(path.join(serviceRoot,'api_v2.py')),access(config)]);
      command=python;args=['-B','api_v2.py','-a','127.0.0.1','-p','9880','-c','GPT_SoVITS/configs/tts_local.yaml'];cwd=serviceRoot;
    }
    const pid=await this.spawnProcess(command,args,cwd);
    const deadline=Date.now()+this.timeoutMs;
    while(Date.now()<deadline){
      signal.throwIfAborted();
      if(await this.health(settings.serviceId,settings.baseUrl,signal).catch(()=>false))return{serviceId:settings.serviceId,state:'ready',safeDiagnostic:'服务已启动并通过健康检查。',...(pid?{pid}:{})};
      await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,this.pollMs);const abort=()=>{clearTimeout(timer);reject(signal.reason??Error('SERVICE_START_CANCELLED'));};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
    }
    throw Error('SERVICE_START_TIMEOUT');
  }
}
