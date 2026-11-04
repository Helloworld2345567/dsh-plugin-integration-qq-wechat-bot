export interface ArchiveLimits {maxArchiveBytes:number;maxEntries:number;maxEntryBytes:number;maxExpandedBytes:number;maxDepth:number}
export interface ArchiveEntry {path:string;type:'file'|'directory';size:number}
export interface ArchiveValidation {format:'tgz';compressedBytes:number;expandedBytes:number;entries:readonly ArchiveEntry[]}
export const DEFAULT_ARCHIVE_LIMITS:Readonly<ArchiveLimits>;
export function validatePackageArchive(file:string,limits?:Partial<ArchiveLimits>):Promise<ArchiveValidation>;
export function readPackageArchiveJson(file:string,entry?:string):Promise<Record<string,unknown>>;
export function readPackageArchiveFiles(file:string,prefix:string):Promise<ReadonlyArray<Readonly<{path:string;data:Buffer}>>>;
export function packageArchiveIdentity(file:string):Promise<string>;
