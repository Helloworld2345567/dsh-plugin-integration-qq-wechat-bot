export const bundleName:string;
export const lifecycleBundleName:string;
export interface LifecycleArtifact {path:string;sha256:string;identity:string;packageVersion:string;lifecycle:Record<string,unknown>}
export interface LifecyclePair {main:LifecycleArtifact;coordinator:LifecycleArtifact}
export function hashFile(file:string):Promise<string>;
export function identity(root:string):Promise<string>;
export function atomicJson(file:string,value:unknown):Promise<void>;
export function archivePackage(source:string,home:string):Promise<{path:string;sha256:string}>;
export function archiveEmbeddedLifecycle(mainArchive:{path:string;sha256:string},home:string):Promise<{path:string;sha256:string}>;
export function acquireProductOperation(home:string,kind:'install'|'start'):Promise<()=>Promise<void>>;
export function assertLauncherStopped(home:string):Promise<void>;
export function validateLifecyclePair(mainArchive:{path:string;sha256:string},lifecycleArchive:{path:string;sha256:string}):Promise<unknown>;
export function preflightLifecycleInstall(home:string,mainArchive:{path:string;sha256:string},lifecycleArchive:{path:string;sha256:string}):Promise<unknown>;
export function readInstalledPair(profile:string):Promise<{mainIdentity:string;coordinatorIdentity:string;main:Record<string,unknown>;coordinator:Record<string,unknown>;compatibility:{compatible:boolean}}>;
export function installOfflineLifecyclePair(input:{home:string;candidate:LifecyclePair;previous?:LifecyclePair;install:(file:string,name:string)=>Promise<void>;verify:(options?:unknown)=>Promise<LifecyclePair>;prepare?:()=>Promise<void>;commit?:(installed:LifecyclePair)=>Promise<void>;finalize?:()=>Promise<void>;restoreMetadata?:()=>Promise<void>;metadataBefore?:Record<string,string|undefined>}):Promise<unknown>;
export function assertNoActiveOfflineTransaction(home:string):Promise<void>;
export function recoverInterruptedOfflinePair(home:string,profile:string,install:(file:string,name:string)=>Promise<void>,finalize?:()=>Promise<void>):Promise<unknown>;
export function recoverInterruptedHotUpgrade(home:string,install:(archive:string)=>Promise<unknown>,profile?:string):Promise<unknown>;
export function verifyInstalledLifecycleCombination(home:string,profile?:string):Promise<any>;
export function verifyLauncherLifecycleState(home:string,profile?:string):Promise<any>;
export interface VerifiedInstallationArtifact {path:string;sha256:string;layers:string[]}
export function readVerifiedInstallationArtifact(home:string):Promise<VerifiedInstallationArtifact>;
export function restoreVerifiedInstallation(artifact:VerifiedInstallationArtifact,install:(file:string,options:{layers:string[];rollback:true})=>Promise<unknown>):Promise<VerifiedInstallationArtifact>;
export function recordInstallation(input:{home:string;sourceRoot:string;installedFrom:string;archive:{path:string;sha256:string;identity?:string;packageVersion?:string;lifecycle?:Record<string,unknown>};installedRoot:string;layers?:string[];verifySource?:boolean;lifecycle?:LifecycleArtifact}):Promise<void>;
export function recoverFailedUpgrade(home:string,taskId:string,install:(archive:string)=>Promise<unknown>):Promise<void>;
