import {writeFileSync,rmSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import path from 'node:path';

/** Persist a local job writer so a restarted host does not remove its cwd. */
export function trackJobProcess(directory:string,pid:number):()=>void {
  const file=path.join(directory,`.worker-process-${pid}.json`);
  writeFileSync(file,JSON.stringify({pid}),{flag:'wx',mode:0o600});
  return()=>{try{rmSync(file,{force:true});}catch{/* Job cleanup retries a stale marker. */}};
}

export async function jobHasLiveProcess(directory:string):Promise<boolean> {
  let names:string[];
  try{names=await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
  for(const name of names){
    const match=/^\.worker-process-([1-9][0-9]*)\.json$/.exec(name);if(!match)continue;
    const pid=Number(match[1]);if(!Number.isSafeInteger(pid))throw Error('JOB_PROCESS_MARKER_INVALID');
    try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')return true;}
  }
  return false;
}
