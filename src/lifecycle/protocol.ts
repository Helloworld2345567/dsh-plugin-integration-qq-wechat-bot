import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync,lstatSync,globSync} from 'node:fs';
import path from 'node:path';

export const MUTABLE_BUNDLE='dsh-plugin-integration-qq-wechat-bot';
export const LIFECYCLE_BUNDLE='dsh-bot-lifecycle';
export interface Artifact {path:string;sha256:string;identity:string}
export interface Installation {schemaVersion:1;sourceRoot:string;projectRoot?:string;sourceDigest:string;installedFrom:string;current:Artifact;previous?:Artifact;updatedAt:number}
export type Phase='draft'|'validating'|'validated'|'queued'|'draining'|'applying'|'restarting'|'reconnecting'|'succeeded'|'rolling-back'|'rolled-back'|'failed';
export interface EvolutionTask {
  id:string;kind:'upgrade'|'restart'|'rollback';scopeKey:string;configId:string;goal:string;phase:Phase;createdAt:number;updatedAt:number;
  candidateRoot?:string;sourceRoot?:string;projectRoot?:string;selectedSourceRoot?:string;baseline?:Record<string,string>;protectedFiles?:Record<string,string>;sourceDigest?:string;
  validatedDigest?:string;validationPid?:number;artifact?:Artifact;previous?:Artifact;rollbackOf?:string;rollbackAttempted?:boolean;activationRestarts?:string[];error?:string;
  validation?:Array<{name:string;status:'PASS'|'FAIL';log:string}>;changes?:Array<{file:string;change:'added'|'modified'|'deleted'}>;
  events:Array<{at:number;phase:Phase;message:string}>;
}
export interface LifecycleRuntime {
  packageRoot:string;
  quiesce():Promise<void>;
  resumeProcessing():void;
  health():{ready:boolean;quiescing?:boolean;activeTasks?:number;pendingDeliveries?:number;connections?:Record<string,string>};
}
const runtimeKey=Symbol.for('sakura.lifecycle.runtime');
const coordinatorKey=Symbol.for('sakura.lifecycle.coordinator');
const shutdownKey=Symbol.for('sakura.lifecycle.shutdown-requested');
export function lifecycleRuntime():LifecycleRuntime|undefined{return (globalThis as any)[runtimeKey];}
export function registerLifecycleRuntime(runtime:LifecycleRuntime):()=>void {
  (globalThis as any)[runtimeKey]=runtime;
  return()=>{if(lifecycleRuntime()===runtime)delete (globalThis as any)[runtimeKey];};
}
export function lifecycleAvailable():boolean{return Boolean((globalThis as any)[coordinatorKey]);}
export function markLifecycleAvailable(value:boolean):void{(globalThis as any)[coordinatorKey]=value?{instance:randomUUID()}:undefined;}
/** Both independently disposable bundles may receive the same IPC event; emit one host signal only. */
export function handleLifecycleShutdown(message:unknown,emit:()=>void=()=>{process.emit('SIGTERM');}):boolean{
  if(!message||typeof message!=='object'||!('type'in message)||!('nonce'in message)||message.type!=='bot-stop'||!process.env.BOT_LAUNCH_TOKEN||message.nonce!==process.env.BOT_LAUNCH_TOKEN)return false;
  if(!(globalThis as any)[shutdownKey]){(globalThis as any)[shutdownKey]=true;emit();}
  return true;
}
export function defaultProductHome(dataHome:string):string{return path.basename(dataHome)==='bot-integration'&&path.basename(path.dirname(dataHome))==='storages'?path.resolve(dataHome,'../..'):dataHome;}
export function atomicJson(file:string,value:unknown):void{
  mkdirSync(path.dirname(file),{recursive:true});const temporary=`${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx',flush:true});renameSync(temporary,file);
}
export function sha256(file:string):string{if(lstatSync(file).isSymbolicLink()||!lstatSync(file).isFile())throw Error('Expected regular artifact file');return createHash('sha256').update(readFileSync(file)).digest('hex');}
export function packageIdentity(root:string):string{
  const manifest=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));const included=new Set<string>(['package.json']);
  const add=(relative:string)=>{const normalized=relative.replaceAll('\\','/');if(normalized.split('/').some(part=>/^(?:node_modules|\.git|\.codex|__pycache__)$/.test(part))||/\.pyc$/.test(normalized))return;const stat=lstatSync(path.join(root,relative));if(stat.isSymbolicLink())throw Error('Shipped package files must not be symlinks');if(stat.isDirectory())for(const name of readdirSync(path.join(root,relative)))add(path.join(relative,name));else if(stat.isFile())included.add(normalized);};
  for(const pattern of manifest.files??['cordis.patch.yml','dist/*.js'])for(const entry of globSync(pattern,{cwd:root}))add(entry);
  const hash=createHash('sha256');for(const file of [...included].sort())hash.update(file).update('\0').update(readFileSync(path.join(root,file))).update('\0');
  return hash.digest('hex');
}
export function verifyArtifact(artifact:Artifact):void{if(!path.isAbsolute(artifact.path)||sha256(artifact.path)!==artifact.sha256)throw Error('Package archive hash mismatch');}
export function readInstallation(home:string):Installation{
  const value=JSON.parse(readFileSync(path.join(home,'installation.json'),'utf8')) as Installation;
  if(value.schemaVersion!==1||!path.isAbsolute(value.sourceRoot)||!value.current?.identity)throw Error('Invalid installation metadata; run the trusted installer with the source checkout');
  verifyArtifact(value.current);return value;
}
export class LifecycleJournal {
  readonly directory:string;
  constructor(readonly home:string){this.directory=path.join(home,'evolution');}
  file(id:string):string{if(!/^[a-z0-9-]{1,80}$/i.test(id))throw Error('Invalid evolution task ID');return path.join(this.directory,`${id}.json`);}
  read(id:string):EvolutionTask{return JSON.parse(readFileSync(this.file(id),'utf8')) as EvolutionTask;}
  list():EvolutionTask[]{if(!existsSync(this.directory))return[];return readdirSync(this.directory).filter(n=>/^[a-z0-9-]+\.json$/i.test(n)).map(n=>this.read(n.slice(0,-5))).sort((a,b)=>b.createdAt-a.createdAt);}
  write(task:EvolutionTask):EvolutionTask{task.updatedAt=Date.now();atomicJson(this.file(task.id),task);return task;}
  phase(task:EvolutionTask,phase:Phase,message:string):EvolutionTask{task.phase=phase;task.events.push({at:Date.now(),phase,message});return this.write(task);}
}
