import {randomUUID} from 'node:crypto';
import {mkdir,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const WINDOWS_REPLACE_RETRY_CODES=new Set(['EPERM','EACCES','EBUSY']);

/** Durable JSON replacement with bounded Windows ownership retries and cleanup. */
export async function atomicJson(file,value,options={}){
  await mkdir(path.dirname(file),{recursive:true});const temporary=`${file}.${randomUUID()}.tmp`,renameFile=options.renameFile??rename,sleep=options.sleep??delay,platform=options.platform??process.platform;
  try{
    await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});
    for(let attempt=0;;attempt++)try{await renameFile(temporary,file);break;}catch(error){
      if(platform!=='win32'||!WINDOWS_REPLACE_RETRY_CODES.has(String(error?.code))||attempt>=9)throw error;
      await sleep(Math.min(100,5*2**attempt));
    }
  }finally{await rm(temporary,{force:true});}
}
