import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import type {ProfileStore} from './profile-store.js';
import type {ServiceProfileRevision} from './service-contract.js';

export interface DiscoveryLimits {maxFiles:number;maxFileBytes:number;maxTotalBytes:number;maxDepth:number;deadlineMs:number}
export interface DiscoveredFile {relativePath:string;size:number;sha256:string}
export interface DiscoveryCandidate {profileId:string;displayName:string;modelLabel?:string;capabilities:readonly string[];managedConfig:Readonly<Record<string,unknown>>;state?:ServiceProfileRevision['state']}
export type ProfileDiscoverer=(context:{serviceId:string;root:string;files:readonly DiscoveredFile[];signal:AbortSignal})=>Promise<readonly DiscoveryCandidate[]>;
const DEFAULT_LIMITS:DiscoveryLimits={maxFiles:10_000,maxFileBytes:4*1024*1024*1024,maxTotalBytes:16*1024*1024*1024,maxDepth:12,deadlineMs:30_000};
const hashFile=(file:string,signal:AbortSignal)=>new Promise<string>((resolve,reject)=>{const hash=createHash('sha256'),stream=createReadStream(file);const abort=()=>stream.destroy(signal.reason);signal.addEventListener('abort',abort,{once:true});stream.on('data',chunk=>hash.update(chunk));stream.on('error',reject);stream.on('end',()=>resolve(hash.digest('hex')));stream.on('close',()=>signal.removeEventListener('abort',abort));});

export class ReadOnlyServiceDiscovery {
  constructor(readonly profiles:ProfileStore,readonly registeredRoots:ReadonlyMap<string,readonly string[]>,readonly limits:Partial<DiscoveryLimits>={}){}
  async refresh(serviceId:string,discoverer:ProfileDiscoverer,signal:AbortSignal):Promise<readonly ServiceProfileRevision[]>{
    const roots=this.registeredRoots.get(serviceId)??[];if(!roots.length)return[];const result:ServiceProfileRevision[]=[];
    for(const configured of roots){signal.throwIfAborted();let root:string;try{const info=await lstat(configured);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('SERVICE_DISCOVERY_ROOT_INVALID');root=await realpath(configured);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
      const timeout=AbortSignal.timeout(this.limits.deadlineMs??DEFAULT_LIMITS.deadlineMs),combined=AbortSignal.any([signal,timeout]),files=await this.scan(root,combined),candidates=await discoverer({serviceId,root,files,signal:combined});
      for(const candidate of candidates)result.push(this.profiles.publicProjection(this.profiles.create({serviceId,profileId:candidate.profileId,state:candidate.state??'ready',capabilities:candidate.capabilities,displayName:candidate.displayName,modelLabel:candidate.modelLabel,managedConfig:candidate.managedConfig})));
    }
    return result;
  }
  private async scan(root:string,signal:AbortSignal):Promise<readonly DiscoveredFile[]>{
    const policy={...DEFAULT_LIMITS,...this.limits},files:DiscoveredFile[]=[];let total=0;
    const walk=async(directory:string,depth:number):Promise<void>=>{if(depth>policy.maxDepth)throw new Error('SERVICE_DISCOVERY_DEPTH_LIMIT');for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){signal.throwIfAborted();const file=path.join(directory,entry.name),info=await lstat(file);if(info.isSymbolicLink())throw new Error('SERVICE_DISCOVERY_REPARSE_POINT');if(entry.isDirectory()){await walk(file,depth+1);continue;}if(!entry.isFile())throw new Error('SERVICE_DISCOVERY_SPECIAL_FILE');if(info.size>policy.maxFileBytes)throw new Error('SERVICE_DISCOVERY_FILE_SIZE_LIMIT');if(++files.length>policy.maxFiles)throw new Error('SERVICE_DISCOVERY_FILE_COUNT_LIMIT');total+=info.size;if(total>policy.maxTotalBytes)throw new Error('SERVICE_DISCOVERY_TOTAL_SIZE_LIMIT');const canonical=await realpath(file),relative=path.relative(root,canonical);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('SERVICE_DISCOVERY_PATH_ESCAPE');files[files.length-1]={relativePath:relative.split(path.sep).join('/'),size:info.size,sha256:await hashFile(canonical,signal)};}};await walk(root,0);return files;
  }
}
