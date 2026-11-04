export function sha256(file:string):string;
export function identityPatterns(manifest:Record<string,unknown>):string[];
export function identityFileIncluded(manifest:Record<string,unknown>,file:string):boolean;
export function hashPackageEntries(entries:Array<{path:string;data:Uint8Array|string}>):string;
export function packageIdentity(root:string):string;
export function sourceFiles(root:string):Record<string,string>;
export function sourceDigest(files:Record<string,string>):string;
