export const bundleName:string;
export function hashFile(file:string):Promise<string>;
export function identity(root:string):Promise<string>;
export function atomicJson(file:string,value:unknown):Promise<void>;
export function archivePackage(source:string,home:string):Promise<{path:string;sha256:string}>;
export interface VerifiedInstallationArtifact {path:string;sha256:string;layers:string[]}
export function readVerifiedInstallationArtifact(home:string):Promise<VerifiedInstallationArtifact>;
export function restoreVerifiedInstallation(artifact:VerifiedInstallationArtifact,install:(file:string,options:{layers:string[];rollback:true})=>Promise<unknown>):Promise<VerifiedInstallationArtifact>;
export function recordInstallation(input:{home:string;sourceRoot:string;installedFrom:string;archive:{path:string;sha256:string};installedRoot:string;layers?:string[];verifySource?:boolean}):Promise<void>;
export function recoverFailedUpgrade(home:string,taskId:string,install:(archive:string)=>Promise<unknown>):Promise<void>;
