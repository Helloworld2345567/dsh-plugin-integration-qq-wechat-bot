import type {MessageDescriptor} from '../i18n/common.js';
import {diagnosticFields} from '../i18n/diagnostics.js';
import {createHash} from 'node:crypto';
import {constants as fsConstants} from 'node:fs';
import {lstat,open,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {canonicalJsonHash,immutableJson} from './canonical-json.js';
import type {ProfileStore} from './profile-store.js';
import {profileIdSchema,serviceIdSchema,serviceProfileDiscoverySchema,serviceProfileRevisionSchema,sha256Schema,type ServiceProfileRevision} from './service-contract.js';

export interface DiscoveryLimits {maxFiles:number;maxFileBytes:number;maxTotalBytes:number;maxDepth:number;maxProfiles:number;deadlineMs:number}
export interface DiscoveredFile {relativePath:string;size:number;sha256:string}
export interface DiscoveryCandidate {profileId:string;displayName:string;modelLabel?:string;capabilities:readonly string[];managedConfig:Readonly<Record<string,unknown>>;state?:ServiceProfileRevision['state'];resourceHash?:string;resources?:readonly string[]}
export interface ServiceDiscoveryStatus {serviceId:string;state:'ready'|'partial'|'blocked'|'missing';registeredRoots:number;scannedRoots:number;profileCount:number;checkedAt:number;safeDiagnostic?:string;message?:MessageDescriptor}
export type ProfileDiscoverer=(context:{serviceId:string;root:string;files:readonly DiscoveredFile[];rootContentHash:string;signal:AbortSignal})=>Promise<readonly DiscoveryCandidate[]>;
const DEFAULT_LIMITS:DiscoveryLimits={maxFiles:10_000,maxFileBytes:4*1024*1024*1024,maxTotalBytes:16*1024*1024*1024,maxDepth:12,maxProfiles:1_000,deadlineMs:30_000};
const isReparsePoint=(info:{isSymbolicLink():boolean;mode:number})=>info.isSymbolicLink()||(process.platform==='win32'&&(info.mode&0o170000)===0o120000);
const inside=(root:string,target:string)=>{const relative=path.relative(root,target);return relative===''||!relative.startsWith('..')&&!path.isAbsolute(relative);};
const sameFile=(a:{dev:number|bigint;ino:number|bigint;size:number|bigint;mtimeMs:number|bigint},b:{dev:number|bigint;ino:number|bigint;size:number|bigint;mtimeMs:number|bigint})=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
async function assertPlainPath(target:string):Promise<void>{const absolute=path.resolve(target),parsed=path.parse(absolute);let current=parsed.root;for(const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){current=path.join(current,segment);const info=await lstat(current);if(isReparsePoint(info))throw new Error('SERVICE_DISCOVERY_REPARSE_POINT');}}

const EMPTY_RESOURCES_HASH=canonicalJsonHash([]);
const directorySource=(root:string)=>`directory:${process.platform==='win32'?path.resolve(root).toLowerCase():path.resolve(root)}`;
type PreparedCandidate=DiscoveryCandidate&{resourceHash:string};

export class ReadOnlyServiceDiscovery {
  private readonly statuses=new Map<string,ServiceDiscoveryStatus>();
  private readonly fileHashes=new Map<string,{info:Awaited<ReturnType<typeof lstat>>;sha256:string}>();
  constructor(readonly profiles:ProfileStore,readonly registeredRoots:ReadonlyMap<string,readonly string[]>,readonly limits:Partial<DiscoveryLimits>={}){}
  status(serviceId:string):ServiceDiscoveryStatus{return this.statuses.get(serviceId)??{serviceId,state:'missing',registeredRoots:this.registeredRoots.get(serviceId)?.length??0,scannedRoots:0,profileCount:0,checkedAt:0,...diagnosticFields("discoveryNoRoots")};}
  catalog(serviceId?:string):readonly ServiceProfileRevision[]{const all=this.profiles.list(serviceId),latest=new Map<string,ServiceProfileRevision>();for(const profile of all){const key=`${profile.serviceId}/${profile.profileId}`,previous=latest.get(key);if(!previous||profile.revision>previous.revision)latest.set(key,profile);}return Object.freeze([...latest.values()].sort((a,b)=>a.serviceId.localeCompare(b.serviceId)||a.profileId.localeCompare(b.profileId)));}
  private owned(serviceId:string,sourceId:string):readonly ServiceProfileRevision[]{return this.catalog(serviceId).filter(profile=>this.profiles.require(profile).discovery?.sourceId===sourceId);}
  private prepare(serviceId:string,sourceId:string,candidates:readonly DiscoveryCandidate[]):PreparedCandidate[]{
    serviceIdSchema.parse(serviceId);serviceProfileDiscoverySchema.parse({sourceId,resourceHash:EMPTY_RESOURCES_HASH});
    if(candidates.length>(this.limits.maxProfiles??DEFAULT_LIMITS.maxProfiles))throw new Error('SERVICE_DISCOVERY_PROFILE_LIMIT');
    const seen=new Set<string>();return candidates.map(candidate=>{
      const profileId=profileIdSchema.parse(candidate.profileId);if(seen.has(profileId))throw new Error(`SERVICE_DISCOVERY_PROFILE_DUPLICATE: ${profileId}`);seen.add(profileId);
      if(Object.hasOwn(candidate.managedConfig,'__discovery'))throw new Error('SERVICE_DISCOVERY_RESERVED_CONFIG');
      const previous=this.profiles.get({serviceId,profileId});if(previous&&previous.discovery?.sourceId!==sourceId)throw new Error(`SERVICE_DISCOVERY_SOURCE_COLLISION: ${profileId}`);
      if(candidate.resources?.length&&candidate.resourceHash===undefined)throw new Error('SERVICE_DISCOVERY_RESOURCE_HASH_REQUIRED');
      const resourceHash=sha256Schema.parse(candidate.resourceHash??EMPTY_RESOURCES_HASH);
      const state=previous&&['disabled','revoked'].includes(previous.state)?previous.state:candidate.state??'ready';
      const validated=serviceProfileRevisionSchema.parse({serviceId,profileId,state,capabilities:candidate.capabilities,displayName:candidate.displayName,modelLabel:candidate.modelLabel,revision:1,contentHash:resourceHash,updatedAt:0});
      return{...candidate,...validated,resourceHash,managedConfig:immutableJson(candidate.managedConfig)};
    });
  }
  private apply(serviceId:string,sourceId:string,candidates:readonly PreparedCandidate[]):void{
    for(const candidate of candidates)this.profiles.create({serviceId,profileId:candidate.profileId,state:candidate.state!,capabilities:candidate.capabilities,displayName:candidate.displayName,modelLabel:candidate.modelLabel,managedConfig:candidate.managedConfig,discovery:{sourceId,resourceHash:candidate.resourceHash}});
    const seen=new Set(candidates.map(candidate=>candidate.profileId));for(const profile of this.owned(serviceId,sourceId))if(!seen.has(profile.profileId)&&['ready','partial','blocked'].includes(profile.state))this.profiles.transition(profile,'missing');
  }
  /** Reconcile one trusted scanner's candidates without scanning its files a second time. */
  reconcile(serviceId:string,sourceId:string,candidates:readonly DiscoveryCandidate[]):readonly ServiceProfileRevision[]{
    const prepared=this.prepare(serviceId,sourceId,candidates);this.apply(serviceId,sourceId,prepared);
    const state=!prepared.length?'missing':prepared.every(item=>['blocked','missing','disabled','revoked'].includes(item.state!))?'blocked':prepared.some(item=>item.state!=='ready')?'partial':'ready';
    this.statuses.set(serviceId,{serviceId,state,registeredRoots:1,scannedRoots:1,profileCount:prepared.length,checkedAt:Date.now()});return this.catalog(serviceId);
  }
  /** A failed/missing source cannot alter manually registered or other-source Profiles. */
  failSource(serviceId:string,sourceId:string,state:'missing'|'blocked'):readonly ServiceProfileRevision[]{
    serviceIdSchema.parse(serviceId);serviceProfileDiscoverySchema.parse({sourceId,resourceHash:EMPTY_RESOURCES_HASH});
    for(const profile of this.owned(serviceId,sourceId))if(['ready','partial','blocked'].includes(profile.state)&&profile.state!==state)this.profiles.transition(profile,state);
    this.statuses.set(serviceId,{serviceId,state,registeredRoots:1,scannedRoots:0,profileCount:this.owned(serviceId,sourceId).length,checkedAt:Date.now(),...diagnosticFields(state==='missing'?"discoveryModelRootMissing":"discoveryModelRootInvalid")});return this.catalog(serviceId);
  }
  private withResources(candidate:DiscoveryCandidate,files:readonly DiscoveredFile[]):DiscoveryCandidate{
    if(candidate.resourceHash!==undefined)return candidate;
    const byPath=new Map(files.map(file=>[file.relativePath,file])),resources=[...new Set(candidate.resources??[])].sort().map(relative=>{
      if(!relative||relative.includes('\\')||relative.split('/').some(part=>!part||part==='.'||part==='..')||path.posix.isAbsolute(relative)||path.win32.isAbsolute(relative))throw new Error('SERVICE_DISCOVERY_RESOURCE_INVALID');
      const file=byPath.get(relative);if(!file)throw new Error('SERVICE_DISCOVERY_RESOURCE_MISSING');return file;
    });return{...candidate,resourceHash:canonicalJsonHash(resources)};
  }
  async refresh(serviceId:string,discoverer:ProfileDiscoverer,signal:AbortSignal):Promise<readonly ServiceProfileRevision[]>{
    serviceIdSchema.parse(serviceId);const roots=this.registeredRoots.get(serviceId)??[],checkedAt=Date.now(),policy={...DEFAULT_LIMITS,...this.limits};
    const combined=AbortSignal.any([signal,AbortSignal.timeout(policy.deadlineMs)]),budget={files:0,totalBytes:0},seenProfiles=new Set<string>(),seenRoots=new Set<string>(),batches:Array<{sourceId:string;candidates:PreparedCandidate[]}>=[];let scannedRoots=0,missingRoots=0,currentSource:string|undefined;
    try{
      for(const configured of roots){
        combined.throwIfAborted();currentSource=directorySource(configured);let root:string;
        try{const configuredPath=path.resolve(configured);await assertPlainPath(configuredPath);const info=await lstat(configuredPath);if(isReparsePoint(info)||!info.isDirectory())throw new Error('SERVICE_DISCOVERY_ROOT_INVALID');root=await realpath(configuredPath);const canonicalInfo=await lstat(root);if(isReparsePoint(canonicalInfo)||!canonicalInfo.isDirectory())throw new Error('SERVICE_DISCOVERY_ROOT_INVALID');}
        catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){missingRoots++;batches.push({sourceId:currentSource,candidates:[]});continue;}throw error;}
        const rootKey=process.platform==='win32'?root.toLowerCase():root;if(seenRoots.has(rootKey))throw new Error('SERVICE_DISCOVERY_ROOT_DUPLICATE');seenRoots.add(rootKey);scannedRoots++;
        const files=await this.scan(root,combined,policy,budget),rootContentHash=canonicalJsonHash(files,{maxBytes:2*1024*1024,maxNodes:Math.max(20_000,files.length*4)});
        const discovered=await discoverer({serviceId,root,files,rootContentHash,signal:combined});combined.throwIfAborted();if(discovered.length+seenProfiles.size>policy.maxProfiles)throw new Error('SERVICE_DISCOVERY_PROFILE_LIMIT');
        const candidates=this.prepare(serviceId,currentSource,discovered.map(candidate=>this.withResources(candidate,files)));
        for(const candidate of candidates){if(seenProfiles.has(candidate.profileId))throw new Error(`SERVICE_DISCOVERY_PROFILE_DUPLICATE: ${candidate.profileId}`);seenProfiles.add(candidate.profileId);}
        batches.push({sourceId:currentSource,candidates});
      }
      combined.throwIfAborted();for(const batch of batches)this.apply(serviceId,batch.sourceId,batch.candidates);
      const discovered=batches.flatMap(batch=>batch.candidates),state:ServiceDiscoveryStatus['state']=!scannedRoots?'missing':discovered.length&&discovered.every(profile=>['blocked','missing','disabled','revoked'].includes(profile.state!))?'blocked':missingRoots||discovered.some(profile=>profile.state!=='ready')?'partial':discovered.length?'ready':'missing';
      this.statuses.set(serviceId,{serviceId,state,registeredRoots:roots.length,scannedRoots,profileCount:discovered.length,checkedAt,...state==='missing'?{...diagnosticFields("discoveryServiceMissing")}:state==='blocked'?{...diagnosticFields("discoveryProfileUnavailable")}:{}});return this.catalog(serviceId);
    }catch(error){if(currentSource)this.failSource(serviceId,currentSource,'blocked');this.statuses.set(serviceId,{serviceId,state:'blocked',registeredRoots:roots.length,scannedRoots,profileCount:seenProfiles.size,checkedAt,...diagnosticFields(combined.aborted?"discoveryCancelled":"discoveryLimits")});throw error;}
  }
  private async scan(root:string,signal:AbortSignal,policy:DiscoveryLimits,budget:{files:number;totalBytes:number}):Promise<readonly DiscoveredFile[]>{
    const files:DiscoveredFile[]=[],seenFiles=new Set<string>();
    const walk=async(directory:string,depth:number):Promise<void>=>{
      signal.throwIfAborted();if(depth>policy.maxDepth)throw new Error('SERVICE_DISCOVERY_DEPTH_LIMIT');const canonicalDirectory=await realpath(directory);if(!inside(root,canonicalDirectory))throw new Error('SERVICE_DISCOVERY_PATH_ESCAPE');const directoryInfo=await lstat(directory);if(isReparsePoint(directoryInfo)||!directoryInfo.isDirectory())throw new Error('SERVICE_DISCOVERY_REPARSE_POINT');
      for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
        signal.throwIfAborted();const target=path.join(directory,entry.name),info=await lstat(target);if(isReparsePoint(info))throw new Error('SERVICE_DISCOVERY_REPARSE_POINT');
        if(info.isDirectory()){await walk(target,depth+1);continue;}if(!info.isFile())throw new Error('SERVICE_DISCOVERY_SPECIAL_FILE');if(info.size>policy.maxFileBytes)throw new Error('SERVICE_DISCOVERY_FILE_SIZE_LIMIT');if(++budget.files>policy.maxFiles)throw new Error('SERVICE_DISCOVERY_FILE_COUNT_LIMIT');budget.totalBytes+=info.size;if(budget.totalBytes>policy.maxTotalBytes)throw new Error('SERVICE_DISCOVERY_TOTAL_SIZE_LIMIT');
        const canonical=await realpath(target),relative=path.relative(root,canonical);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('SERVICE_DISCOVERY_PATH_ESCAPE');const cached=this.fileHashes.get(canonical),sha256=cached&&sameFile(cached.info,info)&&cached.info.ctimeMs===info.ctimeMs?cached.sha256:await this.hashOwnedFile(target,root,info,signal);this.fileHashes.set(canonical,{info,sha256});seenFiles.add(canonical);files.push(Object.freeze({relativePath:relative.split(path.sep).join('/'),size:info.size,sha256}));
      }
    };
    await walk(root,0);for(const cachedPath of this.fileHashes.keys())if(inside(root,cachedPath)&&!seenFiles.has(cachedPath))this.fileHashes.delete(cachedPath);return Object.freeze(files);
  }
  private async hashOwnedFile(file:string,root:string,initial:Awaited<ReturnType<typeof lstat>>,signal:AbortSignal):Promise<string>{
    const noFollow=process.platform!=='win32'&&typeof fsConstants.O_NOFOLLOW==='number'?fsConstants.O_NOFOLLOW:0,handle=await open(file,fsConstants.O_RDONLY|noFollow);try{
      const opened=await handle.stat();if(!opened.isFile()||!sameFile(initial,opened))throw new Error('SERVICE_DISCOVERY_FILE_CHANGED');const canonical=await realpath(file);if(!inside(root,canonical))throw new Error('SERVICE_DISCOVERY_PATH_ESCAPE');const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024),expected=Number(initial.size);let position=0;
      while(position<expected){signal.throwIfAborted();const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,expected-position),position);if(!bytesRead)throw new Error('SERVICE_DISCOVERY_FILE_CHANGED');hash.update(buffer.subarray(0,bytesRead));position+=bytesRead;}const extra=Buffer.allocUnsafe(1);if((await handle.read(extra,0,1,position)).bytesRead)throw new Error('SERVICE_DISCOVERY_FILE_CHANGED');
      const finalHandle=await handle.stat(),finalPath=await lstat(file),finalCanonical=await realpath(file);if(!sameFile(opened,finalHandle)||!sameFile(initial,finalPath)||finalCanonical!==canonical||isReparsePoint(finalPath))throw new Error('SERVICE_DISCOVERY_FILE_CHANGED');return hash.digest('hex');
    }finally{await handle.close();}
  }
}
