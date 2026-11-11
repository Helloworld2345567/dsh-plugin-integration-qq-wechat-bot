import {localizedError} from '../core/errors.js';
import type {Context} from '@deepseek-ai/cordis';
import {SessionId,type SessionHeader} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-persistence';
import type {} from '@deepseek-ai/dsh-storage-domain';
import type {} from '@deepseek-ai/dsh-session-query';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import {rm} from 'node:fs/promises';
import path from 'node:path';

/** The pinned JSONL backend exposes locate(); Harness has no generic delete API yet. */
export async function deleteNativeSessions(ctx:Pick<Context,'sessionPersistence'|'storageDomain'|'sessionQuery'|'emit'>,sessionIds:readonly string[],release:(ids:readonly string[],remove:()=>Promise<string[]>)=>Promise<string[]>):Promise<string[]>{
  const ids=new Set(sessionIds),persistence=ctx.sessionPersistence;
  const backend=persistence as typeof persistence & {locate?:(header:SessionHeader)=>{kind:string;path:string}};
  const directories=new Set<string>();
  const collect=(snapshots:Awaited<ReturnType<typeof persistence.list>>)=>{
    // A fork records its parent too, but is an independent conversation.
    for(let changed=true;changed;){changed=false;for(const {header} of snapshots)if(header.origin==='subagent'&&header.parentSession&&ids.has(header.parentSession)&&!ids.has(header.id)){ids.add(header.id);changed=true;}}
    for(const {header} of snapshots)if(ids.has(header.id)){
      const artifact=backend.locate?.(header);
      if(artifact?.kind!=='jsonl'||!/^session\.v\d+\.jsonl(?:\.zstd)?$/.test(path.basename(artifact.path))||path.basename(path.dirname(artifact.path))!==header.id)throw localizedError('sessionStorageUnsupported');
      directories.add(path.dirname(artifact.path));
    }
  };
  collect(await persistence.list());
  return release([...ids],async()=>{
    await persistence.flush();
    // Admission is closed and descendants drained; include children published during the first listing.
    collect(await persistence.list());
    const cache=ctx.storageDomain?.get('session_projcache');
    for(const id of ids)await cache?.table('sessions').delete(id);
    // locate() supplies the exact session-owned directory, including all log generations.
    for(const directory of directories)await rm(directory,{recursive:true,force:true});
    // A public search reconciles vanished logs and removes their full-text index rows.
    if(ids.size)try{await ctx.sessionQuery.searchSessions({query:'bot-history-deletion',limit:1});}catch(error){
      // Host and plugin can load distinct error constructors; route on the public stable code.
      // Disabled search never opens an index, so there is nothing to reconcile.
      if(typeof error!=='object'||error===null||!('code' in error)||error.code!=='SESSION_QUERY_SEARCH_DISABLED')throw error;
    }
    // Cold sessions have no session/disposed event; update open web clients too.
    for(const id of ids)ctx.emit('api-session/removed',SessionId(id));
    return [...ids];
  });
}
