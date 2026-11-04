import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {LifecycleJournal} from './evolution-contract.js';
import {packageIdentity} from './integrity.mjs';
import {COMPATIBILITY_CODES,LIFECYCLE_PROTOCOL,assertLifecycleCompatibility,evaluateLifecycleCompatibility,lifecycleDeclaration,type CoordinatorLifecycleDeclaration,type LifecycleCompatibility,type MainLifecycleDeclaration} from './compatibility.mjs';
export {LifecycleJournal,defaultProductHome,readInstallation,packageIdentity,sha256,verifyArtifact,atomicJson,replaceFileSync} from './evolution-contract.js';
export type {Artifact,Installation,EvolutionTask,Phase} from './evolution-contract.js';
export {COMPATIBILITY_CODES,LIFECYCLE_CONTRACT_SCHEMA,LIFECYCLE_PROTOCOL,assertLifecycleCompatibility,evaluateLifecycleCompatibility,lifecycleDeclaration,lifecycleVersionSatisfies,planMainReplacement} from './compatibility.mjs';
export type {CoordinatorLifecycleDeclaration,LifecycleCompatibility,MainLifecycleDeclaration} from './compatibility.mjs';

export const MUTABLE_BUNDLE='dsh-plugin-integration-qq-wechat-bot';
export const LIFECYCLE_BUNDLE='dsh-bot-lifecycle';
export const LIFECYCLE_PROTOCOL_VERSION='2.1.0' as const;
export interface LifecycleRuntime {
  packageRoot:string;
  quiesce():Promise<void>;
  resumeProcessing():void;
  health():{ready:boolean;quiescing?:boolean;activeTasks?:number;pendingDeliveries?:number;connections?:Record<string,string>};
}
export interface RuntimeHandshake extends MainLifecycleDeclaration {protocol:typeof LIFECYCLE_PROTOCOL;instance:string;artifactIdentity:string;runtime:LifecycleRuntime}
export interface CoordinatorHandshake extends CoordinatorLifecycleDeclaration {protocol:typeof LIFECYCLE_PROTOCOL;instance:string;artifactIdentity:string;active:boolean}
const coordinatorKey=Symbol.for('sakura.lifecycle.coordinator');
const coordinatorAnchorKey=Symbol.for('sakura.lifecycle.coordinator.anchor');
const shutdownKey=Symbol.for('sakura.lifecycle.shutdown-requested');
const handshakeKey='__DSH_LIFECYCLE_HANDSHAKE__';
const coordinatorProcessKey='__DSH_LIFECYCLE_COORDINATOR__';
function packageDeclaration(root:string,role:'main'):MainLifecycleDeclaration;
function packageDeclaration(root:string,role:'coordinator'):CoordinatorLifecycleDeclaration;
function packageDeclaration(root:string,role:'main'|'coordinator'):MainLifecycleDeclaration|CoordinatorLifecycleDeclaration{return lifecycleDeclaration(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')),role) as MainLifecycleDeclaration|CoordinatorLifecycleDeclaration;}
function strings(value:unknown):value is readonly string[]{return Array.isArray(value)&&value.every(item=>typeof item==='string');}
function validRuntime(value:unknown):value is RuntimeHandshake {
  if(!value||typeof value!=='object')return false;const item=value as Partial<RuntimeHandshake>;
  try{return item.protocol===LIFECYCLE_PROTOCOL&&item.role==='main'&&typeof item.instance==='string'&&item.instance.length>=8&&typeof item.artifactIdentity==='string'&&/^[a-f0-9]{64}$/.test(item.artifactIdentity)&&typeof item.runtimeProtocol==='string'&&typeof item.coordinatorApiRange==='string'&&strings(item.capabilities)&&strings(item.requiredCoordinatorCapabilities)&&!!item.runtime&&typeof item.runtime.quiesce==='function'&&typeof item.runtime.health==='function'&&typeof item.runtime.resumeProcessing==='function'&&typeof item.runtime.packageRoot==='string'&&lifecycleDeclaration({name:item.packageName,version:item.packageVersion,dshLifecycle:{schemaVersion:item.schemaVersion,role:item.role,runtimeProtocol:item.runtimeProtocol,coordinatorApiRange:item.coordinatorApiRange,capabilities:item.capabilities,requiredCoordinatorCapabilities:item.requiredCoordinatorCapabilities}},'main').role==='main';}catch{return false;}
}
function validCoordinator(value:unknown):value is CoordinatorHandshake {
  if(!value||typeof value!=='object')return false;const item=value as Partial<CoordinatorHandshake>;
  try{return item.protocol===LIFECYCLE_PROTOCOL&&item.role==='coordinator'&&item.active===true&&typeof item.instance==='string'&&item.instance.length>=8&&typeof item.artifactIdentity==='string'&&/^[a-f0-9]{64}$/.test(item.artifactIdentity)&&typeof item.coordinatorApi==='string'&&typeof item.runtimeProtocolRange==='string'&&typeof item.mainPackageRange==='string'&&strings(item.capabilities)&&strings(item.requiredMainCapabilities)&&lifecycleDeclaration({name:item.packageName,version:item.packageVersion,dshLifecycle:{schemaVersion:item.schemaVersion,role:item.role,coordinatorApi:item.coordinatorApi,runtimeProtocolRange:item.runtimeProtocolRange,mainPackageRange:item.mainPackageRange,capabilities:item.capabilities,requiredMainCapabilities:item.requiredMainCapabilities}},'coordinator').role==='coordinator';}catch{return false;}
}
function declarations(runtime:RuntimeHandshake,coordinator:CoordinatorHandshake):LifecycleCompatibility{return evaluateLifecycleCompatibility(runtime,coordinator);}
export function lifecycleHandshake():RuntimeHandshake|undefined {const value=(globalThis as Record<string,unknown>)[handshakeKey];return validRuntime(value)?value:undefined;}
export function coordinatorHandshake():CoordinatorHandshake|undefined {const value=(globalThis as Record<symbol,unknown>)[coordinatorKey];return validCoordinator(value)?value:undefined;}
export function lifecycleCompatibility():LifecycleCompatibility {
  const runtime=lifecycleHandshake(),coordinator=coordinatorHandshake();
  if(!runtime||!coordinator)return{compatible:false,code:COMPATIBILITY_CODES.METADATA_MISSING,diagnostic:'Both lifecycle handshakes are required',negotiatedCapabilities:[]};
  if(runtime.instance!==coordinator.instance)return{compatible:false,code:COMPATIBILITY_CODES.IDENTITY_MISMATCH,diagnostic:'Lifecycle instance identities do not match',main:runtime,coordinator,negotiatedCapabilities:[]};
  return declarations(runtime,coordinator);
}
export function lifecycleRuntime():LifecycleRuntime|undefined{return lifecycleAvailable()?lifecycleHandshake()?.runtime:undefined;}
export function registerLifecycleRuntime(runtime:LifecycleRuntime,artifactIdentity:string):()=>void {
  if(!/^[a-f0-9]{64}$/.test(artifactIdentity)||packageIdentity(runtime.packageRoot)!==artifactIdentity)throw Error(`${COMPATIBILITY_CODES.ARTIFACT_MISMATCH}: main artifact identity does not match the loaded package`);
  const raw=(process as unknown as Record<string,unknown>)[coordinatorProcessKey]??(globalThis as Record<symbol,unknown>)[coordinatorAnchorKey]??(globalThis as Record<symbol,unknown>)[coordinatorKey];if(raw&&!validCoordinator(raw))throw Error(`${COMPATIBILITY_CODES.METADATA_INVALID}: installed coordinator handshake is invalid or inactive`);
  const declaration=packageDeclaration(runtime.packageRoot,'main');if(declaration.runtimeProtocol!==LIFECYCLE_PROTOCOL_VERSION)throw Error(`${COMPATIBILITY_CODES.METADATA_INVALID}: runtime protocol constant differs from package declaration`);const coordinator=coordinatorHandshake(),instance=coordinator?.instance??randomUUID();
  const handshake:RuntimeHandshake={...declaration,protocol:LIFECYCLE_PROTOCOL,instance,artifactIdentity,runtime};
  (globalThis as Record<string,unknown>)[handshakeKey]=handshake;
  if(coordinator){const compatibility=declarations(handshake,coordinator);if(!compatibility.compatible){delete (globalThis as Record<string,unknown>)[handshakeKey];throw Error(`${compatibility.code}: ${compatibility.diagnostic}`);}}
  return()=>{if(lifecycleHandshake()?.runtime===runtime)delete (globalThis as Record<string,unknown>)[handshakeKey];};
}
export function lifecycleAvailable():boolean{return lifecycleCompatibility().compatible&&Boolean(lifecycleHandshake()?.runtime);}
export function markLifecycleAvailable(value:boolean,packageRoot?:string,artifactIdentity?:string):LifecycleCompatibility {
  if(value){
    if(!packageRoot||!artifactIdentity||!/^[a-f0-9]{64}$/.test(artifactIdentity)||packageIdentity(packageRoot)!==artifactIdentity)return{compatible:false,code:COMPATIBILITY_CODES.ARTIFACT_MISMATCH,diagnostic:'Coordinator artifact identity is missing or differs from the loaded package',negotiatedCapabilities:[]};
    const declaration=packageDeclaration(packageRoot,'coordinator'),runtime=lifecycleHandshake();let coordinator=(process as unknown as Record<string,unknown>)[coordinatorProcessKey]??(globalThis as Record<symbol,unknown>)[coordinatorAnchorKey]??(globalThis as Record<symbol,unknown>)[coordinatorKey];
    if(coordinator&&!validCoordinator(coordinator))return{compatible:false,code:COMPATIBILITY_CODES.METADATA_INVALID,diagnostic:'Existing coordinator handshake is invalid',negotiatedCapabilities:[]};
    if(coordinator){const existing=coordinator as CoordinatorHandshake;if(existing.packageVersion!==declaration.packageVersion||existing.coordinatorApi!==declaration.coordinatorApi||existing.artifactIdentity!==artifactIdentity)return{compatible:false,code:COMPATIBILITY_CODES.IDENTITY_MISMATCH,diagnostic:'A different coordinator instance already owns this process',negotiatedCapabilities:[]};}
    else coordinator={...declaration,protocol:LIFECYCLE_PROTOCOL,instance:runtime?.instance??randomUUID(),artifactIdentity,active:true};
    const typed=coordinator as CoordinatorHandshake,compatibility=runtime?declarations(runtime,typed):undefined;
    if(compatibility&&!compatibility.compatible)return compatibility;
    (process as unknown as Record<string,unknown>)[coordinatorProcessKey]=typed;(globalThis as Record<symbol,unknown>)[coordinatorAnchorKey]=typed;(globalThis as Record<symbol,unknown>)[coordinatorKey]=typed;
    if(!runtime)return{compatible:false,code:COMPATIBILITY_CODES.METADATA_MISSING,diagnostic:'Main runtime has not registered yet',coordinator:typed,negotiatedCapabilities:[]};
    return compatibility!;
  }
  const coordinator=(process as unknown as Record<string,unknown>)[coordinatorProcessKey]??(globalThis as Record<symbol,unknown>)[coordinatorAnchorKey]??(globalThis as Record<symbol,unknown>)[coordinatorKey];
  if(coordinator&&typeof coordinator==='object')Object.assign(coordinator,{active:false});(globalThis as Record<symbol,unknown>)[coordinatorAnchorKey]=coordinator;(globalThis as Record<symbol,unknown>)[coordinatorKey]=coordinator;
  return lifecycleCompatibility();
}
export function assertLiveLifecycleCompatibility():LifecycleCompatibility {const runtime=lifecycleHandshake(),coordinator=coordinatorHandshake();if(!runtime||!coordinator){const error=new Error(`${COMPATIBILITY_CODES.METADATA_MISSING}: lifecycle handshake is incomplete`);Object.assign(error,{code:COMPATIBILITY_CODES.METADATA_MISSING});throw error;}if(runtime.instance!==coordinator.instance){const error=new Error(`${COMPATIBILITY_CODES.IDENTITY_MISMATCH}: lifecycle instance identities do not match`);Object.assign(error,{code:COMPATIBILITY_CODES.IDENTITY_MISMATCH});throw error;}return assertLifecycleCompatibility(runtime,coordinator);}
/** Adapter used by the composition root when wiring EvolutionService. */
export function createLifecyclePort(){return{available:lifecycleAvailable,handshake:()=>{const value=lifecycleHandshake();if(!value)return;const{runtime:ignored,...serialized}=value;void ignored;return serialized;},compatibility:lifecycleCompatibility,journal:(home:string)=>new LifecycleJournal(home)};}
/** Both independently disposable bundles may receive the same IPC event; emit one host signal only. */
export function handleLifecycleShutdown(message:unknown,emit:()=>void=()=>{process.emit('SIGTERM');}):boolean{
  if(!message||typeof message!=='object'||!('type'in message)||!('nonce'in message)||message.type!=='bot-stop'||!process.env.BOT_LAUNCH_TOKEN||message.nonce!==process.env.BOT_LAUNCH_TOKEN)return false;
  if(!(globalThis as Record<symbol,unknown>)[shutdownKey]){(globalThis as Record<symbol,unknown>)[shutdownKey]=true;emit();}
  return true;
}
