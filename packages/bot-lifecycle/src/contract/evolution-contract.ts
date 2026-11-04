import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import type {MainLifecycleDeclaration} from './compatibility.mjs';
import {sha256} from './integrity.mjs';
export {packageIdentity,sha256} from './integrity.mjs';

export interface Artifact {path:string;sha256:string;identity:string;packageVersion?:string;lifecycle?:MainLifecycleDeclaration}
export interface Installation {schemaVersion:1;sourceRoot:string;projectRoot?:string;sourceDigest:string;installedFrom:string;current:Artifact;previous?:Artifact;updatedAt:number}
export type Phase='draft'|'validating'|'validated'|'queued'|'draining'|'applying'|'restarting'|'reconnecting'|'succeeded'|'rolling-back'|'rolled-back'|'failed';
export interface EvolutionTask {
  id:string;kind:'upgrade'|'restart'|'rollback';scopeKey:string;configId:string;goal:string;phase:Phase;createdAt:number;updatedAt:number;
  candidateRoot?:string;sourceRoot?:string;projectRoot?:string;selectedSourceRoot?:string;baseline?:Record<string,string>;protectedFiles?:Record<string,string>;sourceDigest?:string;
  validatedDigest?:string;validationPid?:number;artifact?:Artifact;previous?:Artifact;rollbackOf?:string;rollbackAttempted?:boolean;rollbackStep?:'requested'|'install-started'|'installed';activationRestarts?:string[];error?:string;
  validation?:Array<{name:string;status:'PASS'|'FAIL';log:string}>;changes?:Array<{file:string;change:'added'|'modified'|'deleted'}>;
  events:Array<{at:number;phase:Phase;message:string}>;
}

export function defaultProductHome(dataHome:string):string{return path.basename(dataHome)==='bot-integration'&&path.basename(path.dirname(dataHome))==='storages'?path.resolve(dataHome,'../..'):dataHome;}
const WINDOWS_REPLACE_RETRY_CODES=new Set(['EPERM','EACCES','EBUSY']);
export function replaceFileSync(source:string,target:string,rename:(source:string,target:string)=>void=renameSync,platform:NodeJS.Platform=process.platform):void {
  for(let attempt=0;;attempt++)try{rename(source,target);return;}catch(error){
    const code=(error as NodeJS.ErrnoException).code;
    if(platform!=='win32'||!WINDOWS_REPLACE_RETRY_CODES.has(String(code))||attempt>=9)throw error;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.min(100,5*2**attempt));
  }
}
export function atomicJson(file:string,value:unknown):void{
  mkdirSync(path.dirname(file),{recursive:true});const temporary=`${file}.${randomUUID()}.tmp`;
  try{writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx',flush:true});replaceFileSync(temporary,file);}
  finally{rmSync(temporary,{force:true});}
}
export function verifyArtifact(artifact:Artifact):void{if(!path.isAbsolute(artifact.path)||sha256(artifact.path)!==artifact.sha256)throw Error('LIFECYCLE_ARTIFACT_MISMATCH: package archive hash mismatch');}
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
  list():EvolutionTask[]{if(!existsSync(this.directory))return [];return readdirSync(this.directory).filter(n=>/^[a-z0-9-]+\.json$/i.test(n)).map(n=>this.read(n.slice(0,-5))).sort((a,b)=>b.createdAt-a.createdAt);}
  write(task:EvolutionTask):EvolutionTask{task.updatedAt=Date.now();atomicJson(this.file(task.id),task);return task;}
  phase(task:EvolutionTask,phase:Phase,message:string):EvolutionTask{task.phase=phase;task.events.push({at:Date.now(),phase,message});return this.write(task);}
}
