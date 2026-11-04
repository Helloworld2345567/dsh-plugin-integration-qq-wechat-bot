export const LIFECYCLE_CONTRACT_SCHEMA:1;
export const LIFECYCLE_PROTOCOL:'dsh.lifecycle';
export const COMPATIBILITY_CODES:Readonly<Record<'METADATA_MISSING'|'METADATA_INVALID'|'PROTOCOL_INCOMPATIBLE'|'COORDINATOR_TOO_OLD'|'COORDINATOR_API_INCOMPATIBLE'|'MAIN_TOO_OLD'|'MAIN_VERSION_INCOMPATIBLE'|'CAPABILITY_MISSING'|'IDENTITY_MISMATCH'|'ARTIFACT_MISMATCH'|'OFFLINE_PAIR_REQUIRED',string>>;
export interface MainLifecycleDeclaration {schemaVersion:1;role:'main';packageName:string;packageVersion:string;runtimeProtocol:string;coordinatorApiRange:string;capabilities:readonly string[];requiredCoordinatorCapabilities:readonly string[]}
export interface CoordinatorLifecycleDeclaration {schemaVersion:1;role:'coordinator';packageName:string;packageVersion:string;coordinatorApi:string;runtimeProtocolRange:string;mainPackageRange:string;capabilities:readonly string[];requiredMainCapabilities:readonly string[]}
export type LifecycleDeclaration=MainLifecycleDeclaration|CoordinatorLifecycleDeclaration;
export interface LifecycleCompatibility {compatible:boolean;code:string;diagnostic:string;main?:MainLifecycleDeclaration&{instance?:string;artifactIdentity?:string};coordinator?:CoordinatorLifecycleDeclaration&{instance?:string;artifactIdentity?:string};negotiatedCapabilities:readonly string[]}
export function parseLifecycleVersion(value:unknown,label?:string):Readonly<{major:number;minor:number;patch:number;text:string}>;
export function compareLifecycleVersions(left:string|{major:number;minor:number;patch:number},right:string|{major:number;minor:number;patch:number}):number;
export function lifecycleVersionSatisfies(version:string,range:string):boolean;
export function lifecycleDeclaration(manifest:unknown,expectedRole?:'main'|'coordinator'):LifecycleDeclaration;
export function evaluateLifecycleCompatibility(main:MainLifecycleDeclaration,coordinator:CoordinatorLifecycleDeclaration):LifecycleCompatibility;
export function planMainReplacement(candidateMain:MainLifecycleDeclaration,currentCoordinator:CoordinatorLifecycleDeclaration):LifecycleCompatibility&{mode:'main-hot'|'offline-pair';cause?:string};
export function assertLifecycleCompatibility(main:MainLifecycleDeclaration,coordinator:CoordinatorLifecycleDeclaration):LifecycleCompatibility;
