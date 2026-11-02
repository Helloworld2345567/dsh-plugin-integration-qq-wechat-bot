export interface ReleaseScanAllowlist {
  readonly loopback:ReadonlySet<string>;
  readonly systemPath:ReadonlyMap<string,ReadonlySet<string>>;
}
export const RELEASE_SCAN_ALLOWLIST:ReleaseScanAllowlist;
export function isReleaseTextFile(file:string):boolean;
export function validateReleaseEntry(file:string):string|undefined;
export function credentialAssignments(text:string):string[];
export function scanReleaseText(file:string,text:string,allowlist?:ReleaseScanAllowlist):string[];
