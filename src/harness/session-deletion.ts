import type {Context} from '@deepseek-ai/cordis';
import {SessionId,type SessionHeader} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-persistence';
import type {} from '@deepseek-ai/dsh-storage-domain';
import {SessionQueryError} from '@deepseek-ai/dsh-session-query';
import {rm} from 'node:fs/promises';
import path from 'node:path';

/** The pinned JSONL backend exposes locate(); Harness has no generic delete API yet. */
export async function deleteNativeSessions(ctx:Pick<Context,'sessionPersistence'|'storageDomain'|'sessions'|'sessionQuery'>,sessionIds:readonly string[],dispose:(id:string)=>Promise<void>):Promise<void>{
  const ids=new Set(sessionIds),persistence=ctx.sessionPersistence;
  const snapshots=await persistence.list();
  for(let changed=true;changed;){changed=false;for(const {header} of snapshots)if(header.parentSession&&ids.has(header.parentSession)&&!ids.has(header.id)){ids.add(header.id);changed=true;}}
  const backend=persistence as typeof persistence & {locate?:(header:SessionHeader)=>{kind:string;path:string}};
  const directories=new Set<string>();
  for(const {header} of snapshots)if(ids.has(header.id)){
    const artifact=backend.locate?.(header);
    if(artifact?.kind!=='jsonl'||!/^session\.v\d+\.jsonl(?:\.zstd)?$/.test(path.basename(artifact.path)))throw Error('当前会话存储不支持删除，请使用随插件安装的 JSONL 存储');
    directories.add(path.dirname(artifact.path));
  }
  for(const id of ids)await dispose(id);
  for(const id of ids)if(ctx.sessions.get(SessionId(id)))throw Error('会话仍被使用，请停止相关任务后重试删除');
  await persistence.flush();
  const cache=ctx.storageDomain?.get('session_projcache');
  for(const id of ids)await cache?.table('sessions').delete(id);
  // locate() supplies the exact session-owned directory, including all log generations.
  for(const directory of directories)await rm(directory,{recursive:true,force:true});
  // A public search reconciles vanished logs and removes their full-text index rows.
  if(ids.size)try{await ctx.sessionQuery.searchSessions({query:'bot-history-deletion',limit:1});}catch(error){
    // The shipped default disables search and never opens an index.
    if(!(error instanceof SessionQueryError)||error.code!=='SESSION_QUERY_SEARCH_DISABLED')throw error;
  }
}
