import {serviceProfileRevisionSchema,serviceProfileDiscoverySchema,type ServiceProfileDiscovery,type ProfileState,type ResolvedServiceProfileRevision,type ServiceProfileRef,type ServiceProfileRevision,type TurnServiceSnapshot} from './service-contract.js';
import {canonicalJsonHash,immutableJson} from './canonical-json.js';
import type {ProfileRecord,ProfileRepository} from './ports/service.js';

export type {ProfileRecord,ProfileRepository};

export function profileContentHash(managedConfig:Readonly<Record<string,unknown>>,discovery?:Readonly<ServiceProfileDiscovery>):string{return canonicalJsonHash(discovery?{managedConfig,resourceHash:discovery.resourceHash}:managedConfig);}
export function profileKey(ref:ServiceProfileRef):string{return`${ref.serviceId}/${ref.profileId}`;}
const recordKey=(serviceId:string,profileId:string,revision:number)=>`${serviceId}/${profileId}@${revision}`;
const freezeRecord=(record:ProfileRecord):ProfileRecord=>Object.freeze({...record,capabilities:Object.freeze([...record.capabilities]),managedConfig:immutableJson(record.managedConfig),...(record.discovery?{discovery:immutableJson(record.discovery)}:{})});

export class InMemoryProfileRepository implements ProfileRepository {
  private readonly records=new Map<string,ProfileRecord>();
  get(serviceId:string,profileId:string,revision:number):ProfileRecord|undefined{return this.records.get(recordKey(serviceId,profileId,revision));}
  latest(serviceId:string,profileId:string):ProfileRecord|undefined{return this.list(serviceId).filter(record=>record.profileId===profileId).sort((a,b)=>b.revision-a.revision)[0];}
  list(serviceId?:string):readonly ProfileRecord[]{return [...this.records.values()].filter(record=>!serviceId||record.serviceId===serviceId).sort((a,b)=>a.serviceId.localeCompare(b.serviceId)||a.profileId.localeCompare(b.profileId)||a.revision-b.revision);}
  save(record:ProfileRecord):void{const key=recordKey(record.serviceId,record.profileId,record.revision);if(this.records.has(key))throw new Error('PROFILE_REVISION_IMMUTABLE');this.records.set(key,freezeRecord(record));}
}

export interface ProfileSnapshotStatus {state:ProfileState;current?:ResolvedServiceProfileRevision}
export class ProfileStore {
  constructor(private readonly repository:ProfileRepository=new InMemoryProfileRepository()){}
  create(input:Omit<ServiceProfileRevision,'revision'|'contentHash'|'updatedAt'> & {managedConfig:Readonly<Record<string,unknown>>;discovery?:Readonly<ServiceProfileDiscovery>;updatedAt?:number}):ResolvedServiceProfileRevision {
    const discovery=input.discovery===undefined?undefined:serviceProfileDiscoverySchema.parse(input.discovery),previous=this.repository.latest(input.serviceId,input.profileId),contentHash=profileContentHash(input.managedConfig,discovery);
    if(previous?.contentHash===contentHash&&previous.discovery?.sourceId===discovery?.sourceId&&previous.state===input.state&&previous.displayName===input.displayName&&previous.modelLabel===input.modelLabel&&JSON.stringify(previous.capabilities)===JSON.stringify(input.capabilities))return freezeRecord(previous);
    const {managedConfig:_managedConfig,discovery:_discovery,...publicInput}=input;
    const publicRecord=serviceProfileRevisionSchema.parse({...publicInput,revision:(previous?.revision??0)+1,contentHash,updatedAt:input.updatedAt??Date.now()});
    const frozen:ProfileRecord={...publicRecord,managedConfig:immutableJson(input.managedConfig),...(discovery?{discovery:immutableJson(discovery)}:{})};this.repository.save(frozen);return freezeRecord(frozen);
  }
  transition(ref:ServiceProfileRef,state:Extract<ProfileState,'blocked'|'missing'|'disabled'|'revoked'>,updatedAt=Date.now()):ResolvedServiceProfileRevision {
    const previous=this.require(ref);return this.create({...previous,state,updatedAt,managedConfig:previous.managedConfig});
  }
  import(record:ProfileRecord):ResolvedServiceProfileRevision {
    const {managedConfig:_managedConfig,discovery,...publicRecord}=record;serviceProfileRevisionSchema.parse(publicRecord);if(discovery)serviceProfileDiscoverySchema.parse(discovery);if(profileContentHash(record.managedConfig,discovery)!==record.contentHash)throw new Error('PROFILE_CONTENT_HASH_MISMATCH');
    const latest=this.repository.latest(record.serviceId,record.profileId);if(latest&&record.revision<=latest.revision)throw new Error('PROFILE_REVISION_NOT_MONOTONIC');this.repository.save(record);return freezeRecord(record);
  }
  get(ref:ServiceProfileRef,revision?:number):ResolvedServiceProfileRevision|undefined{const value=revision===undefined?this.repository.latest(ref.serviceId,ref.profileId):this.repository.get(ref.serviceId,ref.profileId,revision);return value?freezeRecord(value):undefined;}
  require(ref:ServiceProfileRef,revision?:number):ResolvedServiceProfileRevision{const value=this.get(ref,revision);if(!value)throw new Error('PROFILE_MISSING');return value;}
  list(serviceId?:string):readonly ServiceProfileRevision[]{return this.repository.list(serviceId).map(({managedConfig:_managedConfig,discovery:_discovery,...profile})=>Object.freeze({...profile,capabilities:Object.freeze([...profile.capabilities])}));}
  publicProjection(record:ResolvedServiceProfileRevision):ServiceProfileRevision {const {managedConfig:_managedConfig,discovery:_discovery,...profile}=record;return Object.freeze({...profile,capabilities:Object.freeze([...profile.capabilities])});}
  snapshot(ref:ServiceProfileRef):TurnServiceSnapshot {const profile=this.require(ref);return Object.freeze({serviceId:profile.serviceId,profileId:profile.profileId,profileRevision:profile.revision,profileContentHash:profile.contentHash});}
  snapshotStatus(snapshot:TurnServiceSnapshot):ProfileSnapshotStatus {
    const current=this.get({serviceId:snapshot.serviceId,profileId:snapshot.profileId});if(!current)return{state:'missing'};
    // Configuration updates affect only the next turn. Safety transitions and
    // replaced resources immediately block snapshots that can no longer be used.
    if(['blocked','missing','disabled','revoked'].includes(current.state))return{state:current.state,current};
    const frozen=this.get({serviceId:snapshot.serviceId,profileId:snapshot.profileId},snapshot.profileRevision);
    if(!frozen||frozen.contentHash!==snapshot.profileContentHash)return{state:'missing',current};
    // A safety transition is a one-way fence for every older turn/job. Restoring
    // the profile creates a new revision for future turns; it never revives old work.
    const newer=this.repository.list(snapshot.serviceId).filter(record=>record.profileId===snapshot.profileId&&record.revision>snapshot.profileRevision).sort((a,b)=>b.revision-a.revision);
    const safety=newer.find(record=>['blocked','missing','disabled','revoked'].includes(record.state));
    if(safety)return{state:safety.state,current};
    // Discovered model paths refer to mutable files. Replacing their contents
    // invalidates older jobs even when a later refresh restores the old files.
    const resources=frozen.discovery;
    if(resources&&newer.some(record=>record.discovery?.sourceId===resources.sourceId&&record.discovery.resourceHash!==resources.resourceHash))return{state:'blocked',current};
    return{state:frozen.state,current};
  }
  assertExecutable(snapshot:TurnServiceSnapshot):ResolvedServiceProfileRevision {
    const status=this.snapshotStatus(snapshot);if(!['ready','partial'].includes(status.state))throw new Error(`PROFILE_${status.state.toUpperCase()}`);
    return this.require({serviceId:snapshot.serviceId,profileId:snapshot.profileId},snapshot.profileRevision);
  }
}
