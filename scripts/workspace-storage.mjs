import {mkdir,readdir,rename,cp,rm,stat} from 'node:fs/promises';
import path from 'node:path';

const exists=async file=>{try{await stat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
/** Move existing storage without overwriting another installation's data. Run with the host stopped. */
export async function moveStorage(source,target){
  if(path.resolve(source)===path.resolve(target)||!await exists(source))return;
  if(await exists(target)){
    const sourceInfo=await stat(source),targetInfo=await stat(target);
    if(!sourceInfo.isDirectory()||!targetInfo.isDirectory())throw Error(`Storage migration conflict: ${target}`);
    for(const name of await readdir(source))await moveStorage(path.join(source,name),path.join(target,name));
    await rm(source);return;
  }
  await mkdir(path.dirname(target),{recursive:true});
  try{await rename(source,target);}catch(error){if(error.code!=='EXDEV')throw error;await cp(source,target,{recursive:true,errorOnExist:true,force:false});await rm(source,{recursive:true});}
}
export async function configureWorkspaceStorage(home,workspaceRoot,patch){
  const root=path.join(workspaceRoot,'.runtime');await mkdir(root,{recursive:true});
  for(const name of ['sessions','storages','attachments'])await moveStorage(path.join(home,name),path.join(root,name));
  const overrides=[
    {id:'session-persistence-jsonl',config:{root:path.join(root,'sessions')}},
    {id:'storage-json',config:{root:path.join(root,'storages')}},
    {id:'attachment-local',config:{dshHome:root}},
  ];
  for(const entry of overrides){const previous=patch.find(item=>item.id===entry.id);if(previous)previous.config={...previous.config,...entry.config};else patch.push(entry);}
  return patch;
}
