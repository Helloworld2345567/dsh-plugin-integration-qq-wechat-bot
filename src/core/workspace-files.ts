import {copyFile,mkdir,rename,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Store} from './store.js';
import {prepareWorkingDirectory} from './workspaces.js';
import type {Asset} from './types.js';

export const mediaFolders={image:'images',video:'videos',audio:'audio',file:'files'} as const;
export type AssetOrigin='received'|'generated'|'sent';
export async function scopeWorkspace(store:Store,scope:string):Promise<string>{
  const owner=store.findBinding(scope)??store.sessionsAll().find(item=>item.scopeKey===scope)??store.list<any>('scheduled-job').find(item=>item.scopeKey===scope)??store.list<any>('proactive-config').find(item=>item.scopeKey===scope);
  if(!owner)throw Error('SESSION_NOT_FOUND');
  return prepareWorkingDirectory(store.bot(owner.scope.botId),scope,store.home);
}
export function assetFolder(workspace:string,asset:Pick<Asset,'scopeKey'|'id'|'kind'|'createdAt'|'jobId'|'origin'>):string{
  return path.join(workspace,mediaFolders[asset.kind],asset.origin??(asset.jobId?'generated':'received'),new Date(asset.createdAt).toISOString().slice(0,10),asset.scopeKey,asset.id);
}
export async function moveFile(source:string,target:string):Promise<void>{
  if(path.resolve(source)===path.resolve(target))return;
  await mkdir(path.dirname(target),{recursive:true});
  try{await rename(source,target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EXDEV')throw error;await copyFile(source,target);await rm(source);}
}
export async function exists(file:string):Promise<boolean>{try{await stat(file);return true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return false;}}
/** Readable, scoped history accompanies the native compressed log in workspace runtime storage. */
export async function writeChatHistory(store:Store,scope:string,sessionId:string,events:readonly any[]):Promise<void>{
  const workspace=await scopeWorkspace(store,scope),directory=path.join(workspace,'history',scope);await mkdir(directory,{recursive:true});
  const rows=events.filter(event=>['user/message','assistant/message','tool/result','turn/start','turn/end'].includes(event.type)&&(event.type!=='user/message'||!['runtime-context','timing'].includes(event.data.source?.kind))).map(event=>{
    if(event.type!=='assistant/message')return event;
    const {stream:_,...data}=event.data;
    return{...event,data:{...data,message:{...data.message,content:data.message.content.filter((block:any)=>block.type!=='reasoning')}}};
  });
  const file=path.join(directory,`${sessionId}.jsonl`),temporary=`${file}.tmp`;
  const previous=store.get<{file:string}>('history-location',sessionId);
  if(previous&&path.resolve(previous.file)!==path.resolve(file)&&await exists(previous.file))await moveFile(previous.file,file);
  await writeFile(temporary,rows.map(row=>JSON.stringify(row)).join('\n')+'\n',{mode:0o600});await rename(temporary,file);
  store.put('history-location',sessionId,{scopeKey:scope,sessionId,file});
}
