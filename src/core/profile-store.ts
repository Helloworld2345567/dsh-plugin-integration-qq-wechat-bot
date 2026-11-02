import {serviceProfileRevisionSchema,type ResolvedServiceProfileRevision,type ServiceProfileRef,type ServiceProfileRevision} from './service-contract.js';
import {canonicalJsonHash,immutableJson} from './canonical-json.js';

export interface ProfileRecord extends ServiceProfileRevision {readonly managedConfig:Readonly<Record<string,unknown>>}
export interface ProfileRepository {
  get(serviceId:string,profileId:string,revision:number):ProfileRecord|undefined;
  latest(serviceId:string,profileId:string):ProfileRecord|undefined;
  list(serviceId?:string):readonly ProfileRecord[];
  save(record:ProfileRecord):void;
}

export function profileContentHash(managedConfig:Readonly<Record<string,unknown>>):string{return canonicalJsonHash(managedConfig);}
export function profileKey(ref:ServiceProfileRef):string{return`${ref.serviceId}/${ref.profileId}`;}

export class InMemoryProfileRepository implements ProfileRepository {
  private readonly records=new Map<string,ProfileRecord>();
  get(serviceId:string,profileId:string,revision:number):ProfileRecord|undefined{return this.records.get(`${serviceId}/${profileId}@${revision}`);}
  latest(serviceId:string,profileId:string):ProfileRecord|undefined{return this.list(serviceId).filter(record=>record.profileId===profileId).sort((a,b)=>b.revision-a.revision)[0];}
  list(serviceId?:string):readonly ProfileRecord[]{return [...this.records.values()].filter(record=>!serviceId||record.serviceId===serviceId).sort((a,b)=>a.serviceId.localeCompare(b.serviceId)||a.profileId.localeCompare(b.profileId)||a.revision-b.revision);}
  save(record:ProfileRecord):void{const key=`${record.serviceId}/${record.profileId}@${record.revision}`;if(this.records.has(key))throw new Error('PROFILE_REVISION_IMMUTABLE');this.records.set(key,Object.freeze({...record,capabilities:Object.freeze([...record.capabilities]),managedConfig:immutableJson(record.managedConfig)}));}
}

export class ProfileStore {
  constructor(private readonly repository:ProfileRepository=new InMemoryProfileRepository()){}
  create(input:Omit<ServiceProfileRevision,'revision'|'contentHash'|'updatedAt'> & {managedConfig:Readonly<Record<string,unknown>>;updatedAt?:number}):ResolvedServiceProfileRevision {
    const previous=this.repository.latest(input.serviceId,input.profileId),contentHash=profileContentHash(input.managedConfig);
    if(previous?.contentHash===contentHash&&previous.state===input.state&&previous.displayName===input.displayName&&previous.modelLabel===input.modelLabel&&JSON.stringify(previous.capabilities)===JSON.stringify(input.capabilities))return previous;
    const {managedConfig:_managedConfig,...publicInput}=input;
    const publicRecord=serviceProfileRevisionSchema.parse({...publicInput,revision:(previous?.revision??0)+1,contentHash,updatedAt:input.updatedAt??Date.now()});
    const frozen:ProfileRecord={...publicRecord,managedConfig:immutableJson(input.managedConfig)};this.repository.save(frozen);return frozen;
  }
  import(record:ProfileRecord):ResolvedServiceProfileRevision {
    const {managedConfig:_managedConfig,...publicRecord}=record;serviceProfileRevisionSchema.parse(publicRecord);if(profileContentHash(record.managedConfig)!==record.contentHash)throw new Error('PROFILE_CONTENT_HASH_MISMATCH');
    const latest=this.repository.latest(record.serviceId,record.profileId);if(latest&&record.revision<=latest.revision)throw new Error('PROFILE_REVISION_NOT_MONOTONIC');this.repository.save(record);return record;
  }
  get(ref:ServiceProfileRef,revision?:number):ResolvedServiceProfileRevision|undefined{return revision===undefined?this.repository.latest(ref.serviceId,ref.profileId):this.repository.get(ref.serviceId,ref.profileId,revision);}
  require(ref:ServiceProfileRef,revision?:number):ResolvedServiceProfileRevision{const value=this.get(ref,revision);if(!value)throw new Error('PROFILE_MISSING');return value;}
  list(serviceId?:string):readonly ServiceProfileRevision[]{return this.repository.list(serviceId).map(({managedConfig:_managedConfig,...profile})=>profile);}
  publicProjection(record:ResolvedServiceProfileRevision):ServiceProfileRevision {const {managedConfig:_managedConfig,...profile}=record;return profile;}
}
