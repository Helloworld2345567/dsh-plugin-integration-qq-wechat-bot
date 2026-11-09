import {access,readdir} from 'node:fs/promises';
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

async function findModelConfig(projectRoot:string,configuredRoot:string,serviceRoot:string):Promise<string|undefined>{
  const candidates=[
    path.join(serviceRoot,'GPT_SoVITS','configs','tts_local.yaml'),
    path.join(configuredRoot,'gpt-sovits'),
    path.join(projectRoot,'models','gpt-sovits'),
  ];
  try{await access(candidates[0]);return candidates[0];}catch{}
  const roots=[...new Set(candidates.slice(1).map(value=>path.resolve(value)))];
  const matches:string[]=[];
  const visit=async(directory:string,depth:number):Promise<void>=>{
    if(depth>4||matches.length>=32)return;
    let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
      const target=path.join(directory,entry.name);
      if(entry.isFile()&&entry.name==='tts_config.yaml')matches.push(target);
      else if(entry.isDirectory())await visit(target,depth+1);
      if(matches.length>=32)return;
    }
  };
  await Promise.all(roots.map(root=>visit(root,0)));
  if(matches.length)return matches.sort((a,b)=>a.localeCompare(b))[0];
  try{await access(path.join(serviceRoot,'GPT_SoVITS','configs','tts_infer.yaml'));return path.join(serviceRoot,'GPT_SoVITS','configs','tts_infer.yaml');}catch{return;}
}

async function findGptSovitsRoot(configuredRoot:string):Promise<{root:string;python:string;serviceRoot:string;config:string;configArg:string}> {
  const pythonName=process.platform==='win32'?path.join('.codex','venv','Scripts','python.exe'):path.join('.codex','venv','bin','python');
  let current=path.resolve(configuredRoot);
  for(;;){
    const python=path.join(current,pythonName),serviceRoot=path.join(current,'GPT-SoVITS');
    try{
      await Promise.all([access(python),access(path.join(serviceRoot,'api_v2.py'))]);
      const config=await findModelConfig(current,configuredRoot,serviceRoot);if(!config)throw Error('GPT_SOVITS_CONFIG_NOT_FOUND');
      return{root:current,python,serviceRoot,config,configArg:path.relative(serviceRoot,config).replaceAll(path.sep,'/')};
    }
    catch{}
    const parent=path.dirname(current);if(parent===current)break;current=parent;
  }
  // Preserve the original configured root in the diagnostic path while
  // returning the same stable error category as the previous direct checks.
  throw Error('GPT_SOVITS_LAYOUT_NOT_FOUND');
}

async function defaultHealth(serviceId:LaunchableService,baseUrl:string,signal:AbortSignal):Promise<boolean>{
  const response=await fetch(`${trimUrl(baseUrl)}${serviceId==='breeze-tts'?'/health':'/openapi.json'}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(2500)]),redirect:'error'});
  if(!response.ok)return false;
  if(serviceId!=='breeze-tts')return true;
  const value=await response.json().catch(()=>undefined) as {status?:unknown;sample_rate?:unknown}|undefined;
  return value?.status==='ok'&&value.sample_rate===24000;
}

async function defaultSpawn(file:string,args:readonly string[],cwd:string):Promise<number>{
  // On Windows the Breeze PowerShell launcher creates the actual service as a
  // grandchild. Detaching the PowerShell process here leaves that grandchild
  // in the launcher job and it is terminated as soon as PowerShell exits,
  // even though the service reported healthy during startup. Keep the
  // launcher attached on Windows so its child service remains owned by the
  // long-lived bot process; Unix keeps the previous detached behavior.
  const child=spawn(file,[...args],{cwd,detached:process.platform!=='win32',stdio:'ignore',windowsHide:true});
  await new Promise<void>((resolve,reject)=>{child.once('spawn',()=>resolve());child.once('error',reject);});
  child.unref();
  return child.pid??0;
}

/** Starts only fixed, operator-configured launchers. It never stops or owns the child service. */
export class ExternalServiceLauncher implements ServiceLauncher {
  constructor(readonly health:HealthCheck=defaultHealth,readonly spawnProcess:SpawnProcess=defaultSpawn,readonly pollMs=500,readonly timeoutMs=180_000,readonly healthTimeoutMs=2_500){}
  /**
   * A provider health probe must never hold the admin request forever. The
   * built-in fetch already has a timeout, but launchers are injectable and a
   * custom probe can accidentally ignore its AbortSignal. Race every probe
   * against a local deadline and abort the probe when that deadline expires.
   */
  private async checkHealth(serviceId:LaunchableService,baseUrl:string,signal:AbortSignal):Promise<boolean>{
    const controller=new AbortController();
    const combined=AbortSignal.any([signal,controller.signal]);
    let timer:ReturnType<typeof setTimeout>|undefined;
    let onAbort:()=>void=()=>{};
    const timeout=new Promise<boolean>(resolve=>{timer=setTimeout(()=>{controller.abort(Error('SERVICE_HEALTH_TIMEOUT'));resolve(false);},Math.max(1,this.healthTimeoutMs));});
    const aborted=new Promise<boolean>((_,reject)=>{onAbort=()=>reject(signal.reason??Error('SERVICE_START_CANCELLED'));if(signal.aborted)onAbort();else signal.addEventListener('abort',onAbort,{once:true});});
    try{return await Promise.race([this.health(serviceId,baseUrl,combined).catch(()=>false),timeout,aborted]);}
    finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
  }
  async start(settings:ServiceLaunchSettings,signal:AbortSignal):Promise<ServiceStartResult>{
    signal.throwIfAborted();
    const root=path.resolve(settings.projectRoot);
    if(!path.isAbsolute(settings.projectRoot)||/[\x00-\x1f]/.test(settings.projectRoot))throw Error('SERVICE_LAUNCH_ROOT_INVALID');
    const endpoint=new URL(settings.baseUrl),expectedPort=settings.serviceId==='breeze-tts'?'8080':'9880',actualPort=endpoint.port||(endpoint.protocol==='https:'?'443':'80');
    if(!['127.0.0.1','localhost','::1'].includes(endpoint.hostname)||actualPort!==expectedPort)throw Error('SERVICE_LAUNCH_ENDPOINT_MISMATCH');
    if(await this.checkHealth(settings.serviceId,settings.baseUrl,signal))return{serviceId:settings.serviceId,state:'already-running',safeDiagnostic:'服务已经在运行。'};
    let command:string,args:string[],cwd:string;
    if(settings.serviceId==='breeze-tts'){
      const script=path.join(root,'Start-Breeze.ps1');await access(script);command=powershell;args=['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',script];cwd=root;
    }else{
      const layout=await findGptSovitsRoot(root),python=layout.python,serviceRoot=layout.serviceRoot;
      command=python;args=['-B','api_v2.py','-a','127.0.0.1','-p','9880','-c',layout.configArg];cwd=serviceRoot;
    }
    const pid=await this.spawnProcess(command,args,cwd);
    const deadline=Date.now()+this.timeoutMs;
    while(Date.now()<deadline){
      signal.throwIfAborted();
      if(await this.checkHealth(settings.serviceId,settings.baseUrl,signal))return{serviceId:settings.serviceId,state:'ready',safeDiagnostic:'服务已启动并通过健康检查。',...(pid?{pid}:{})};
      await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,this.pollMs);const abort=()=>{clearTimeout(timer);reject(signal.reason??Error('SERVICE_START_CANCELLED'));};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
    }
    throw Error('SERVICE_START_TIMEOUT');
  }
}
