import {randomUUID} from 'node:crypto';
import {LifecycleJournal} from '../core/evolution-contract.js';
export {LifecycleJournal,defaultProductHome,readInstallation,packageIdentity,sha256,verifyArtifact,atomicJson} from '../core/evolution-contract.js';
export type {Artifact,Installation,EvolutionTask,Phase} from '../core/evolution-contract.js';

export const MUTABLE_BUNDLE='dsh-plugin-integration-qq-wechat-bot';
export const LIFECYCLE_BUNDLE='dsh-bot-lifecycle';
export const LIFECYCLE_PROTOCOL='dsh.lifecycle' as const;
export const LIFECYCLE_PROTOCOL_VERSION=1;
export interface LifecycleRuntime {
  packageRoot:string;
  quiesce():Promise<void>;
  resumeProcessing():void;
  health():{ready:boolean;quiescing?:boolean;activeTasks?:number;pendingDeliveries?:number;connections?:Record<string,string>};
}
const coordinatorKey=Symbol.for('sakura.lifecycle.coordinator');
const coordinatorAnchorKey=Symbol.for('sakura.lifecycle.coordinator.anchor');
const shutdownKey=Symbol.for('sakura.lifecycle.shutdown-requested');
const handshakeKey='__DSH_LIFECYCLE_HANDSHAKE__';
export interface LifecycleHandshake {protocol:typeof LIFECYCLE_PROTOCOL;version:number;instance:string;capabilities:readonly string[];runtime?:LifecycleRuntime}
function validHandshake(value:unknown):value is LifecycleHandshake {return !!value&&typeof value==='object'&&(value as any).protocol===LIFECYCLE_PROTOCOL&&(value as any).version===LIFECYCLE_PROTOCOL_VERSION&&typeof (value as any).instance==='string'&&Array.isArray((value as any).capabilities);}
type CoordinatorHandshake={protocol:typeof LIFECYCLE_PROTOCOL;version:number;instance:string;capabilities:readonly string[]};
function validCoordinator(value:unknown):value is CoordinatorHandshake {
  return validHandshake(value)&&value.capabilities.includes('coordinator.tick');
}
export function lifecycleHandshake():LifecycleHandshake|undefined {const value=(globalThis as any)[handshakeKey];return validHandshake(value)?value:undefined;}
export function lifecycleRuntime():LifecycleRuntime|undefined {
  // A runtime handshake is only actionable after the independent coordinator
  // has negotiated the same instance. This prevents an old mutable bundle from
  // being accepted merely because it left a well-shaped global behind.
  return lifecycleAvailable()?lifecycleHandshake()?.runtime:undefined;
}
export function registerLifecycleRuntime(runtime:LifecycleRuntime):()=>void {
  const handshake:LifecycleHandshake={protocol:LIFECYCLE_PROTOCOL,version:LIFECYCLE_PROTOCOL_VERSION,instance:randomUUID(),capabilities:['runtime.quiesce','runtime.health','runtime.resume'],runtime};
  (globalThis as any)[handshakeKey]=handshake;
  // Keep the coordinator object owned by the independent bundle stable while
  // refreshing only its negotiated instance; observers use object identity to
  // prove that the coordinator survived a mutable-bundle unload.
  const coordinator=(globalThis as any)[coordinatorKey];
  // Never upgrade or rewrite an incompatible coordinator in place. A stale
  // bundle must remain unavailable until the independent bundle is replaced.
  if(validCoordinator(coordinator))Object.assign(coordinator,{instance:handshake.instance});
  return()=>{if(lifecycleHandshake()?.runtime===runtime)delete (globalThis as any)[handshakeKey];};
}
// A coordinator handshake without a registered runtime is intentionally not
// actionable: evolution must fail closed until both bundles agree on a live port.
export function lifecycleAvailable():boolean {const handshake=lifecycleHandshake();const coordinator=(globalThis as any)[coordinatorKey];return Boolean(handshake?.runtime&&coordinator&&coordinator.protocol===LIFECYCLE_PROTOCOL&&coordinator.version===LIFECYCLE_PROTOCOL_VERSION&&coordinator.instance===handshake.instance&&Array.isArray(coordinator.capabilities)&&coordinator.capabilities.includes('coordinator.tick'));}
export function markLifecycleAvailable(value:boolean):void {
  // Keep the coordinator identity on the process object so Cordis bundle
  // realms can be recreated without turning a surviving coordinator into a
  // new instance. Availability still depends on the negotiated handshake.
  if(value){
    const current=lifecycleHandshake();
    const handshake=current??{protocol:LIFECYCLE_PROTOCOL,version:LIFECYCLE_PROTOCOL_VERSION,instance:randomUUID(),capabilities:['coordinator.tick']};
    let coordinator=(process as any).__DSH_LIFECYCLE_COORDINATOR__??(globalThis as any)[coordinatorAnchorKey]??(globalThis as any)[coordinatorKey];
    if(coordinator&&!validCoordinator(coordinator))return;
    if(!coordinator)coordinator={protocol:LIFECYCLE_PROTOCOL,version:LIFECYCLE_PROTOCOL_VERSION,instance:handshake.instance,capabilities:['coordinator.tick']};
    Object.assign(coordinator,{protocol:LIFECYCLE_PROTOCOL,version:LIFECYCLE_PROTOCOL_VERSION,instance:handshake.instance,capabilities:['coordinator.tick']});
    (globalThis as any)[handshakeKey]=handshake;(process as any).__DSH_LIFECYCLE_COORDINATOR__=coordinator;(globalThis as any)[coordinatorAnchorKey]=coordinator;(globalThis as any)[coordinatorKey]=coordinator;
  }
  else {const coordinator=(process as any).__DSH_LIFECYCLE_COORDINATOR__??(globalThis as any)[coordinatorAnchorKey]??(globalThis as any)[coordinatorKey];if(coordinator)Object.assign(coordinator,{capabilities:[]});(globalThis as any)[coordinatorAnchorKey]=coordinator;if(coordinator)(globalThis as any)[coordinatorKey]=coordinator;const current=lifecycleHandshake();if(current&&!current.runtime)delete (globalThis as any)[handshakeKey];}
}
/** Adapter used by the composition root when wiring EvolutionService. */
export function createLifecyclePort(){return{available:lifecycleAvailable,handshake:lifecycleHandshake,journal:(home:string)=>new LifecycleJournal(home)};}
/** Both independently disposable bundles may receive the same IPC event; emit one host signal only. */
export function handleLifecycleShutdown(message:unknown,emit:()=>void=()=>{process.emit('SIGTERM');}):boolean{
  if(!message||typeof message!=='object'||!('type'in message)||!('nonce'in message)||message.type!=='bot-stop'||!process.env.BOT_LAUNCH_TOKEN||message.nonce!==process.env.BOT_LAUNCH_TOKEN)return false;
  if(!(globalThis as any)[shutdownKey]){(globalThis as any)[shutdownKey]=true;emit();}
  return true;
}
