export interface AtomicJsonOptions {
  renameFile?:(source:string,target:string)=>Promise<void>;
  sleep?:(milliseconds:number)=>Promise<unknown>;
  platform?:NodeJS.Platform;
}
export function atomicJson(file:string,value:unknown,options?:AtomicJsonOptions):Promise<void>;
