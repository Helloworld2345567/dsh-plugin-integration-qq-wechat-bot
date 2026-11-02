import {createHash} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {lstat,open,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {canonicalJsonHash} from './canonical-json.js';
import type {ProfileStore} from './profile-store.js';
import {profileIdSchema,serviceIdSchema,type ServiceProfileRevision} from './service-contract.js';

export interface DiscoveryLimits {maxFiles:number;maxFileBytes:number;maxTotalBytes:number;maxDepth:number;maxProfiles:number;deadlineMs:number}
export interface DiscoveredFile {relativePath:string;size:number;sha256:string}
export interface DiscoveryCandidate {profileId:string;displayName:string;modelLabel?:string;capabilities:readonly string[];managedConfig:Readonly<Record<string,unknown>>;state?:ServiceProfileRevision['state']}
export interface ServiceDiscoveryStatus {serviceId:string;state:'ready'|'partial'|'blocked'|'missing';registeredRoots:number;scannedRoots:number;profileCount:number;checkedAt:number;safeDiagnostic?:string}
export type ProfileDiscoverer=(context:{serviceId:string;root:string;files:readonly DiscoveredFile[];rootContentHash:string;signal:AbortSignal})=>Promise<readonly DiscoveryCandidate[]>;
const DEFAULT_LIMITS:DiscoveryLimits={maxFiles:10_000,maxFileBytes:4*1024*1024*1024,maxTotalBytes:16*1024*1024*1024,maxDepth:12,maxProfiles:1_000,deadlineMs:30_000};
const isReparsePoint=(info:{isSymbolicLink():boolean;mode:number})=>info.isSymbolicLink()||(process.platform==='win32'&&(info.mode&0o170000)===0o120000);
const inside=(root:string,target:string)=>{const relative=path.relative(root,target);return relative===''||!relative.startsWith('..')&&!path.isAbsolute(relative);};
const sameFile=(a:{dev:number|bigint;ino:number|bigint;size:number|bigint;mtimeMs:number|bigint},b:{dev:number|bigint;ino:number|bigint;size:number|bigint;mtimeMs:number|bigint})=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
async function assertPlainPath(target:string):Promise<void>{const absolute=path.resolve(target),parsed=path.parse(absolute);let current=parsed.root;for(const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){current=path.join(current,segment);const info=await lstat(current);if(isReparsePoint(info))throw new Error('SERVICE_DISCOVERY_REPARSE_POINT');}}

export class ReadOnlyServiceDiscovery {
  private readonly statuses=new Map<string,ServiceDiscoveryStatus>();
  constructor(readonly profiles:ProfileStore,readonly registeredRoots:ReadonlyMap<string,readonly string[]>,readonly limits:Partial<DiscoveryLimits>={}){}
  status(serviceId:string):ServiceDiscoveryStatus{return this.statuses.get(serviceId)??{serviceId,state:'missing',registeredRoots:this.registeredRoots.get(serviceId)?.length??0,scannedRoots:0,profileCount:0,checkedAt:0,safeDiagnostic:'未发现已登记的服务根目录。'};}
  catalog(serviceId?:string):readonly ServiceProfileRevision[]{const all=this.profiles.list(serviceId),latest=new Map<string,ServiceProfileRevision>();for(const profile of all){const key=`${profile.serviceId}/${profile.profileId}`,previous=latest.get(key);if(!previous||profile.revision>previous.revision)latest.set(key,profile);}return Object.freeze([...latest.values()].sort((a,b)=>a.serviceId.localeCompare(b.serviceId)||a.profileId.localeCompare(b.profileId)));}
  async refresh(serviceId:string,discoverer:ProfileDiscoverer,signal:AbortSignal):Promise<readonly ServiceProfileRevision[]>{
    serviceIdSchema.parse(serviceId);const roots=this.registeredRoots.get(serviceId)??[],checkedAt=Date.now(),policy={...DEFAULT_LIMITS,...this.limits};
    const timeout=AbortSignal.timeout(policy.deadlineMs),combined=AbortSignal.any([signal,timeout]),budget={files:0,totalBytes:0},seenProfiles=new Set<string>(),seenRoots=new Set<string>();let scannedRoots=0,missingRoots=0;
    try{
      if(!roots.length){this.markMissing(serviceId,seenProfiles);const catalog=this.catalog(serviceId);this.statuses.set(serviceId,{serviceId,state:'missing',registeredRoots:0,scannedRoots:0,profileCount:catalog.length,checkedAt,safeDiagnostic:'未登记服务根目录。'});return catalog;}
      for(const configured of roots){
        combined.throwIfAborted();let root:string;
        try{const configuredPath=path.resolve(configured);await assertPlainPath(configuredPath);const info=await lstat(configuredPath);if(isReparsePoint(info)||!info.isDirectory())throw new Error('SERVICE_DISCOVERY_ROOT_INVALID');root=await realpath(configuredPath);const canonicalInfo=await lstat(root);if(isReparsePoint(canonicalInfo)||!canonicalInfo.isDirectory())throw new Error('SERVICE_DISCOVERY_ROOT_INVALID');}
        catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){missingRoots++;continue;}throw error;}
        const rootKey=process.platform==='win32'?root.toLowerCase():root;if(seenRoots.has(rootKey))throw new Error('SERVICE_DISCOVERY_ROOT_DUPLICATE');seenRoots.add(rootKey);scannedRoots++;
        const files=await this.scan(root,combined,policy,budget),rootContentHash=canonicalJsonHash(files,{maxBytes:2*1024*1024,maxNodes:Math.max(20_000,files.length*4)});
        const candidates=await discoverer({serviceId,root,files,rootContentHash,signal:combined});combined.throwIfAborted();if(candidates.length+seenProfiles.size>policy.maxProfiles)throw new Error('SERVICE_DISCOVERY_PROFILE_LIMIT');
        for(const candidate of candidates){
          combined.throwIfAborted();const profileId=profileIdSchema.parse(candidate.profileId);if(seenProfiles.has(profileId))throw new Error(`SERVICE_DISCOVERY_PROFILE_DUPLICATE: ${profileId}`);seenProfiles.add(profileId);
          if(Object.hasOwn(candidate.managedConfig,'__discovery'))throw new Error('SERVICE_DISCOVERY_RESERVED_CONFIG');const previous=this.profiles.get({serviceId,profileId}),discoveredState=candidate.state??'ready',state=previous&&['disabled','revoked'].includes(previous.state)?previous.state:discoveredState;
          this.profiles.create({serviceId,profileId,state,capabilities:candidate.capabilities,displayName:candidate.displayName,modelLabel:candidate.modelLabel,managedConfig:{...candidate.managedConfig,__discovery:{rootContentHash,fileCount:files.length,totalBytes:files.reduce((sum,file)=>sum+file.size,0)}}});
        }
      }
      this.markMissing(serviceId,seenProfiles);const catalog=this.catalog(serviceId),discovered=catalog.filter(profile=>seenProfiles.has(profile.profileId)),state:ServiceDiscoveryStatus['state']=!scannedRoots?'missing':missingRoots||discovered.some(profile=>profile.state==='partial')?'partial':discovered.length&&discovered.every(profile=>['blocked','missing','disabled','revoked'].includes(profile.state))?'blocked':discovered.length?'ready':'missing';
      this.statuses.set(serviceId,{serviceId,state,registeredRoots:roots.length,scannedRoots,profileCount:catalog.length,checkedAt,...state==='missing'?{safeDiagnostic:'已登记服务当前缺失。'}:state==='blocked'?{safeDiagnostic:'已发现的服务 Profile 当前不可用。'}:{}});return catalog;
    }catch(error){this.markBlocked(serviceId);this.statuses.set(serviceId,{serviceId,state:'blocked',registeredRoots:roots.length,scannedRoots,profileCount:this.catalog(serviceId).length,checkedAt,safeDiagnostic:combined.aborted?'服务发现超过安全时限或已取消。':'服务发现未通过路径或资源限制。'});throw error;}
  }
  private markMissing(serviceId:string,seen:Set<string>):void {for(const profile of this.catalog(serviceId))if(!seen.has(profile.profileId)&&['ready','partial','blocked'].includes(profile.state))this.profiles.transition({serviceId,profileId:profile.profileId},'missing');}
  private markBlocked(serviceId:string):void {for(const profile of this.catalog(serviceId))if(['ready','partial'].includes(profile.state))this.profiles.transition({serviceId,profileId:profile.profileId},'blocked');}
  private async scan(root:string,signal:AbortSignal,policy:DiscoveryLimits,budget:{files:number;totalBytes:number}):Promise<readonly DiscoveredFile[]>{
    const files:DiscoveredFile[]=[];
    const walk=async(directory:string,depth:number):Promise<void>=>{
      signal.throwIfAborted();if(depth>policy.maxDepth)throw new Error('SERVICE_DISCOVERY_DEPTH_LIMIT');const canonicalDirectory=await realpath(directory);if(!inside(root,canonicalDirectory))throw new Error('SERVICE_DISCOVERY_PATH_ESCAPE');const directoryInfo=await lstat(directory);if(isReparsePoint(directoryInfo)||!directoryInfo.isDirectory())throw new Error('SERVICE_DISCOVERY_REPARSE_POINT');
      for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        signal.throwIfAborted();const target=path.join(directory,entry.name),info=await lstat(target);if(isReparsePoint(info))throw new Error('SERVICE_DISCOVERY_REPARSE_POINT');
        if(info.isDirectory()){await walk(target,depth+1);continue;}if(!info.isFile())throw new Error('SERVICE_DISCOVERY_SPECIAL_FILE');if(info.size>policy.maxFileBytes)throw new Error('SERVICE_DISCOVERY_FILE_SIZE_LIMIT');if(++budget.files>policy.maxFiles)throw new Error('SERVICE_DISCOVERY_FILE_COUNT_LIMIT');budget.totalBytes+=info.size;if(budget.totalBytes>policy.maxTotalBytes)throw new Error('SERVICE_DISCOVERY_TOTAL_SIZE_LIMIT');
        const canonical=await realpath(target),relative=path.relative(root,canonical);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('SERVICE_DISCOVERY_PATH_ESCAPE');const sha256=await this.hashOwnedFile(target,root,info,signal);files.push(Object.freeze({relativePath:relative.split(path.sep).join('/'),size:info.size,sha256}));
      }
    };
    await walk(root,0);return Object.freeze(files);
  }
  private async hashOwnedFile(file:string,root:string,initial:Awaited<ReturnType<typeof lstat>>,signal:AbortSignal):Promise<string>{
    const noFollow=process.platform!=='win32'&&typeof fsConstants.O_NOFOLLOW==='number'?fsConstants.O_NOFOLLOW:0,handle=await open(file,fsConstants.O_RDONLY|noFollow);try{
      const opened=await handle.stat();if(!opened.isFile()||!sameFile(initial,opened))throw new Error('SERVICE_DISCOVERY_FILE_CHANGED');const canonical=await realpath(file);if(!inside(root,canonical))throw new Error('SERVICE_DISCOVERY_PATH_ESCAPE');const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024),expected=Number(initial.size);let position=0;
      while(position<expected){signal.throwIfAborted();const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,expected-position),position);if(!bytesRead)throw new Error('SERVICE_DISCOVERY_FILE_CHANGED');hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;}const extra=Buffer.allocUnsafe(1);if((await handle.read(extra,0,1,position)).bytesRead)throw new Error('SERVICE_DISCOVERY_FILE_CHANGED');
      const finalHandle=await handle.stat(),finalPath=await lstat(file),finalCanonical=await realpath(file);if(!sameFile(opened,finalHandle)||!sameFile(initial,finalPath)||finalCanonical!==canonical||isReparsePoint(finalPath))throw new Error('SERVICE_DISCOVERY_FILE_CHANGED');return hash.digest('hex');
    }finally{await handle.close();}
  }
}
