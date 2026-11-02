import {createHash,createPublicKey,verify} from 'node:crypto';
import {constants as fsConstants,createReadStream} from 'node:fs';
import {access,lstat,open,readdir,readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {ServiceCatalog,type ServiceCatalogReservations} from './service-catalog.js';
import {SERVICE_HOST_API_VERSION,SERVICE_MANIFEST_FILE,parseServicePluginManifest,type ServiceAdapter,type ServicePluginManifest} from './service-contract.js';

export type ServicePluginSource='builtin'|'bundled';
export interface ServicePluginRegistration {
  readonly root:string;
  readonly source:ServicePluginSource;
  readonly expectedArtifactSha256:string;
  readonly allowlisted:boolean;
  readonly revoked:boolean;
  readonly installedAt:number;
  readonly previousVersion?:string;
  readonly publicKeys?:Readonly<Record<string,string>>;
  readonly createAdapter:(manifest:ServicePluginManifest)=>ServiceAdapter|Promise<ServiceAdapter>;
}
export interface InstalledServicePluginRecord {
  readonly serviceId:string;readonly packageId:string;readonly version:string;readonly manifestVersion:number;readonly source:ServicePluginSource;readonly artifactSha256:string;readonly signature?:string;readonly hostApiRange:string;readonly dependencies:ServicePluginManifest['dependencies'];readonly allowlisted:boolean;readonly revoked:boolean;readonly installedAt:number;readonly previousVersion?:string;
}
export interface ValidatedServicePlugin {readonly registration:ServicePluginRegistration;readonly manifest:ServicePluginManifest;readonly record:InstalledServicePluginRecord;readonly root:string;readonly entry:string}

const parseVersion=(value:string):[number,number,number]=>{const match=/^(\d+)\.(\d+)\.(\d+)/.exec(value);if(!match)throw new Error(`SERVICE_VERSION_INVALID: ${value}`);return[Number(match[1]),Number(match[2]),Number(match[3])];};
const compare=(a:[number,number,number],b:[number,number,number])=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2];
export function versionSatisfies(version:string,range:string):boolean {
  const current=parseVersion(version),trimmed=range.trim();if(trimmed==='*')return true;
  return trimmed.split(/\s*\|\|\s*/).some(part=>{
    if(/^\^\d+\.\d+\.\d+$/.test(part)){const min=parseVersion(part.slice(1)),max:[number,number,number]=min[0]>0?[min[0]+1,0,0]:min[1]>0?[0,min[1]+1,0]:[0,0,min[2]+1];return compare(current,min)>=0&&compare(current,max)<0;}
    if(/^~\d+\.\d+\.\d+$/.test(part)){const min=parseVersion(part.slice(1)),max:[number,number,number]=[min[0],min[1]+1,0];return compare(current,min)>=0&&compare(current,max)<0;}
    if(/^\d+\.\d+\.\d+$/.test(part))return compare(current,parseVersion(part))===0;
    const conditions=part.split(/\s+/).filter(Boolean);return conditions.length>0&&conditions.every(condition=>{const match=/^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(condition);if(!match)return false;const relation=compare(current,parseVersion(match[2]));return match[1]==='>='?relation>=0:match[1]==='<='?relation<=0:match[1]==='>'?relation>0:match[1]==='<'?relation<0:relation===0;});
  });
}

function isReparsePoint(info:{isSymbolicLink():boolean;mode:number}):boolean {return info.isSymbolicLink()||(process.platform==='win32'&&(info.mode&0o170000)===0o120000);}
async function assertNormalPath(root:string,target:string,kind:'file'|'directory'):Promise<void>{
  const relative=path.relative(root,target);if(relative===''&&kind==='file'||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('SERVICE_PLUGIN_PATH_OUTSIDE_PACKAGE');
  let current=root;for(const segment of relative.split(path.sep).filter(Boolean)){current=path.join(current,segment);const info=await lstat(current);if(isReparsePoint(info))throw new Error('SERVICE_PLUGIN_REPARSE_POINT_REJECTED');}
  const info=await lstat(target);if(kind==='file'?!info.isFile():!info.isDirectory())throw new Error(`SERVICE_PLUGIN_${kind.toUpperCase()}_REQUIRED`);
  const canonicalRoot=await realpath(root),canonicalTarget=await realpath(target),inside=canonicalTarget===canonicalRoot||canonicalTarget.startsWith(canonicalRoot+path.sep);if(!inside)throw new Error('SERVICE_PLUGIN_PATH_OUTSIDE_PACKAGE');
}
export async function computeServiceArtifactHash(root:string):Promise<string>{
  const hash=createHash('sha256');let files=0,total=0;
  const walk=async(directory:string,prefix=''):Promise<void>=>{for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const relative=prefix?`${prefix}/${entry.name}`:entry.name,target=path.join(directory,entry.name),info=await lstat(target);if(isReparsePoint(info))throw new Error('SERVICE_PLUGIN_REPARSE_POINT_REJECTED');if(entry.isDirectory()){await walk(target,relative);continue;}if(!entry.isFile())throw new Error('SERVICE_PLUGIN_SPECIAL_FILE_REJECTED');if(++files>10_000)throw new Error('SERVICE_PLUGIN_FILE_LIMIT');total+=info.size;if(total>512*1024*1024)throw new Error('SERVICE_PLUGIN_SIZE_LIMIT');hash.update(relative).update('\0');if(relative===SERVICE_MANIFEST_FILE){const raw=JSON.parse(await readFile(target,'utf8')) as Record<string,unknown>;delete raw.signature;raw.artifactSha256='0'.repeat(64);hash.update(JSON.stringify(raw));}else await new Promise<void>((resolve,reject)=>{const stream=createReadStream(target);stream.on('data',chunk=>hash.update(chunk));stream.on('error',reject);stream.on('end',resolve);});hash.update('\0');}};await walk(root);return hash.digest('hex');
}
function signaturePayload(manifest:ServicePluginManifest):Buffer {const {signature:_signature,...payload}=manifest;return Buffer.from(JSON.stringify(payload));}
function verifyManifestSignature(manifest:ServicePluginManifest,keys:Readonly<Record<string,string>>={}):void {
  if(!manifest.signature)return;const match=/^ed25519:([a-zA-Z0-9_-]+):(.+)$/.exec(manifest.signature);if(!match)throw new Error('SERVICE_PLUGIN_SIGNATURE_INVALID');const pem=keys[match[1]];if(!pem)throw new Error('SERVICE_PLUGIN_SIGNATURE_KEY_UNKNOWN');let signature:Buffer;try{signature=Buffer.from(match[2],'base64');}catch{throw new Error('SERVICE_PLUGIN_SIGNATURE_INVALID');}if(!verify(null,signaturePayload(manifest),createPublicKey(pem),signature))throw new Error('SERVICE_PLUGIN_SIGNATURE_INVALID');
}

export async function validateServicePlugin(registration:ServicePluginRegistration,hostApiVersion=SERVICE_HOST_API_VERSION):Promise<ValidatedServicePlugin>{
  if(!registration.allowlisted)throw new Error('SERVICE_PLUGIN_NOT_ALLOWLISTED');if(registration.revoked)throw new Error('SERVICE_PLUGIN_REVOKED');if(!/^[a-f0-9]{64}$/.test(registration.expectedArtifactSha256))throw new Error('SERVICE_PLUGIN_EXPECTED_HASH_INVALID');
  const root=path.resolve(registration.root);await assertNormalPath(root,root,'directory');
  const manifestPath=path.join(root,SERVICE_MANIFEST_FILE);await assertNormalPath(root,manifestPath,'file');if((await stat(manifestPath)).size>512*1024)throw new Error('SERVICE_PLUGIN_MANIFEST_TOO_LARGE');
  const manifest=parseServicePluginManifest(JSON.parse(await readFile(manifestPath,'utf8')));if(!versionSatisfies(hostApiVersion,manifest.hostApiRange))throw new Error(`SERVICE_PLUGIN_HOST_API_UNSUPPORTED: ${manifest.serviceId}`);
  const entry=path.resolve(root,...manifest.entry.split('/'));await assertNormalPath(root,entry,'file');await access(entry,fsConstants.R_OK);const handle=await open(entry,'r');await handle.close();
  const actualHash=await computeServiceArtifactHash(root);if(actualHash!==registration.expectedArtifactSha256||actualHash!==manifest.artifactSha256)throw new Error(`SERVICE_PLUGIN_HASH_MISMATCH: ${manifest.serviceId}`);verifyManifestSignature(manifest,registration.publicKeys);
  return{registration,manifest,root,entry,record:{serviceId:manifest.serviceId,packageId:manifest.packageId,version:manifest.version,manifestVersion:manifest.manifestVersion,source:registration.source,artifactSha256:actualHash,signature:manifest.signature,hostApiRange:manifest.hostApiRange,dependencies:manifest.dependencies,allowlisted:registration.allowlisted,revoked:registration.revoked,installedAt:registration.installedAt,previousVersion:registration.previousVersion}};
}

export class ServicePluginHost {
  readonly catalog:ServiceCatalog;
  readonly records:readonly InstalledServicePluginRecord[];
  private readonly adapters=new Map<string,ServiceAdapter>();
  private accepting=true;
  private disposed=false;
  private constructor(readonly plugins:readonly ValidatedServicePlugin[],reservations:ServiceCatalogReservations){this.catalog=new ServiceCatalog(plugins.map(plugin=>plugin.manifest),reservations);this.records=Object.freeze(plugins.map(plugin=>Object.freeze({...plugin.record})));}
  static async create(registrations:readonly ServicePluginRegistration[],hostApiVersion=SERVICE_HOST_API_VERSION,reservations:ServiceCatalogReservations={}):Promise<ServicePluginHost>{
    const plugins:ValidatedServicePlugin[]=[];for(const registration of registrations)plugins.push(await validateServicePlugin(registration,hostApiVersion));
    const host=new ServicePluginHost(Object.freeze(plugins),reservations);host.assertDependencies();const created:ServiceAdapter[]=[];try{for(const plugin of plugins){const adapter=await plugin.registration.createAdapter(plugin.manifest);if(adapter.serviceId!==plugin.manifest.serviceId)throw new Error(`SERVICE_ADAPTER_ID_MISMATCH: ${plugin.manifest.serviceId}`);host.adapters.set(adapter.serviceId,adapter);created.push(adapter);}return host;}catch(error){await Promise.allSettled(created.reverse().map(adapter=>adapter.dispose()));throw error;}
  }
  private assertDependencies():void{for(const plugin of this.plugins)for(const dependency of plugin.manifest.dependencies){const installed=this.catalog.service(dependency.serviceId);if(!installed){if(!dependency.optional)throw new Error(`SERVICE_PLUGIN_DEPENDENCY_MISSING: ${plugin.manifest.serviceId} -> ${dependency.serviceId}`);continue;}if(!versionSatisfies(installed.manifest.version,dependency.versionRange))throw new Error(`SERVICE_PLUGIN_DEPENDENCY_VERSION: ${plugin.manifest.serviceId} -> ${dependency.serviceId}`);}}
  adapter(serviceId:string):ServiceAdapter {if(!this.accepting)throw new Error('SERVICE_PLUGIN_HOST_NOT_ACCEPTING');return this.lifecycleAdapter(serviceId);}
  lifecycleAdapter(serviceId:string):ServiceAdapter {if(this.disposed)throw new Error('SERVICE_PLUGIN_HOST_DISPOSED');const value=this.adapters.get(serviceId);if(!value)throw new Error(`SERVICE_ADAPTER_NOT_REGISTERED: ${serviceId}`);return value;}
  stopAccepting():void{this.accepting=false;}
  async dispose():Promise<void>{if(this.disposed)return;this.stopAccepting();this.disposed=true;const adapters=[...this.adapters.values()].reverse();this.adapters.clear();const results=await Promise.allSettled(adapters.map(adapter=>adapter.dispose()));const failure=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');if(failure)throw failure.reason;}
}
