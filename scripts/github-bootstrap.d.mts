import type {LookupAddress} from 'node:dns';
import type {ArchiveLimits} from './archive-validation.mjs';
export interface BootstrapInput {repository:string;/** Fixed semver release tag; commit SHAs are not accepted. */ref:string;asset:string;sha256:string;home:string;sourceDir?:string}
export interface DownloadOptions {allowlist?:ReadonlySet<string>;lookup?:(hostname:string,options:{all:true;verbatim:true})=>Promise<LookupAddress[]>;request?:(url:URL,file:string,options:{signal:AbortSignal;addresses:LookupAddress[];timeoutMs:number;maxBytes:number})=>Promise<{bytes?:number;redirect?:URL}>;timeoutMs?:number;maxBytes?:number;maxRedirects?:number;signal?:AbortSignal}
export interface BootstrapDependencies {tempRoot?:string;download?:(url:URL,file:string,options:{signal:AbortSignal})=>Promise<unknown>;install:(file:string,options:{layers:readonly string[];rollback?:boolean})=>Promise<unknown>;verifyHealth?:(context:{home:string;sha256:string})=>Promise<unknown>;layers?:readonly string[];archiveLimits?:Partial<ArchiveLimits>;signal?:AbortSignal}
export const GITHUB_HOSTS:ReadonlySet<string>;export const BOOTSTRAP_STATES:readonly string[];
export function validateBootstrapInput(input:unknown):Readonly<BootstrapInput>;
export function githubAssetUrl(input:BootstrapInput):URL;
export function isPrivateAddress(address:string):boolean;
export function validateDownloadUrl(input:string|URL,allowlist?:ReadonlySet<string>):URL;
export function downloadGithubAsset(url:string|URL,file:string,options?:DownloadOptions):Promise<{bytes:number|undefined}>;
export function sha256File(file:string):Promise<string>;
export function readRollbackArtifact(home:string):Promise<{path:string;sha256:string;layers:string[]}|undefined>;
export function bootstrapGithub(input:BootstrapInput,deps:BootstrapDependencies):Promise<Readonly<{journal:string;state:string;sha256:string}>>;
