import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
export async function lifecycleSourceDigest(root){
  const source=path.join(root,'src'),files=[];
  async function walk(directory,prefix=''){for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const relative=prefix?`${prefix}/${entry.name}`:entry.name,target=path.join(directory,entry.name);if(entry.isDirectory())await walk(target,relative);else if(entry.isFile())files.push(relative);else throw Error('LIFECYCLE_SOURCE_SPECIAL_FILE_REJECTED');}}
  await walk(source);const hash=createHash('sha256');for(const file of files)hash.update(file).update('\0').update(await readFile(path.join(source,file))).update('\0');return{algorithm:'sha256',digest:hash.digest('hex'),files};
}
