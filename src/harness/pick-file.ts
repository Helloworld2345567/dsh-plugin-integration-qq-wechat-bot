import {localizedError,LocalizedError} from '../core/errors.js';
import {readdir,realpath,stat} from 'node:fs/promises';
import path from 'node:path';

export interface WorkflowFileEntry {name:string;path:string;directory:boolean}
export interface WorkflowFileList {directory:string;parent?:string;entries:WorkflowFileEntry[]}

/** Browse local workflows in the authenticated panel, without a desktop subprocess. */
export async function listWorkflowFiles(current:string|undefined,signal:AbortSignal=new AbortController().signal):Promise<WorkflowFileList>{
  signal.throwIfAborted();
  const requested=current?.trim()||process.cwd();
  if(!path.isAbsolute(requested)||/[\x00-\x1f]/.test(requested))throw localizedError('filePickerPath');
  try{
    let directory=requested;
    try{if(!(await stat(requested)).isDirectory())directory=path.dirname(requested);}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&path.extname(requested).toLowerCase()==='.json')directory=path.dirname(requested);else throw error;}
    directory=await realpath(directory);
    const rows=await readdir(directory,{withFileTypes:true});
    const entries:WorkflowFileEntry[]=[];
    for(const row of rows){
      signal.throwIfAborted();
      const file=path.join(directory,row.name);
      const info=row.isSymbolicLink()?await stat(file).catch(()=>undefined):row;
      if(info?.isDirectory()||info?.isFile()&&path.extname(row.name).toLowerCase()==='.json')entries.push({name:row.name,path:file,directory:info.isDirectory()});
    }
    signal.throwIfAborted();
    entries.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name));
    const parent=path.dirname(directory);
    return{directory,...parent!==directory?{parent}:{},entries};
  }catch(error){
    signal.throwIfAborted();
    if(error instanceof LocalizedError)throw error;
    throw localizedError('workflowDirectoryInaccessible');
  }
}
