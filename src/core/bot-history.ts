import {rm} from 'node:fs/promises';
import path from 'node:path';
import {scopeKey,type Store} from './store.js';

/** Ownership is taken from persisted channel identities, never from model paths. */
export function botHistory(store:Store,botId:string){
  const rows=(store.db.prepare('SELECT kind,id,json FROM records').all() as {kind:string;id:string;json:string}[]).map(row=>({...row,value:JSON.parse(row.json)}));
  const scopes=new Set<string>(),sessions=new Set<string>(),jobs=new Set<string>(),automations=new Set<string>();
  for(const row of rows){const value=row.value;
    if(value?.scope?.botId===botId){scopes.add(scopeKey(value.scope));if(row.kind==='session')sessions.add(row.id);if(row.kind==='binding')sessions.add(value.sessionId);}
    if(row.kind==='stats-session'&&value.botId===botId)sessions.add(value.sessionId);
  }
  for(const message of store.allMessages())if(message.scope.botId===botId)scopes.add(scopeKey(message.scope));
  for(const delivery of store.deliveries())if(delivery.botId===botId){scopes.add(delivery.scopeKey);sessions.add(delivery.sessionId);}
  const owns=(value:any)=>value?.botId===botId||value?.scope?.botId===botId||scopes.has(value?.scope)||scopes.has(value?.scopeKey)||sessions.has(value?.sessionId)||sessions.has(value?.rootSessionId);
  for(const row of rows)if(owns(row.value)){if(row.kind==='job')jobs.add(row.id);if(['scheduled-job','proactive-config'].includes(row.kind))automations.add(row.id);}
  const ids=new Set([...scopes,...sessions,...automations]);
  const records=rows.filter(row=>!['bot','config','config-version','persona-files'].includes(row.kind)&&(owns(row.value)||ids.has(row.id)||
    (['failure','media-quota'].includes(row.kind)&&row.id.split(':').some(part=>ids.has(part)))||
    (row.kind==='cursor'&&row.id===botId)||(row.kind==='channel-cursor'&&row.id===`${store.bot(botId).channel}:${botId}`)||
    (row.kind==='reply-sequence'&&JSON.parse(row.id)[0]===botId)));
  return{scopes,sessions,jobs,records};
}

export async function deleteBotFiles(store:Store,assetsRoot:string,history:ReturnType<typeof botHistory>):Promise<void>{
  for(const [root,ids] of [[assetsRoot,history.scopes],[path.join(store.home,'jobs'),history.jobs]] as const){
    for(const id of ids){const target=path.resolve(root,id);if(path.dirname(target)!==path.resolve(root))throw Error('BOT_HISTORY_PATH_INVALID');await rm(target,{recursive:true,force:true});}
  }
}

export function deleteBotRecords(store:Store,botId:string,history:ReturnType<typeof botHistory>):void{
  store.transaction(()=>{
    for(const row of history.records)store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(row.kind,row.id);
    for(const scope of history.scopes)for(const table of ['inbox','deliveries','memory','forgotten','memory_sources','asset_index'])store.db.prepare(`DELETE FROM ${table} WHERE scope=?`).run(scope);
    store.db.prepare('DELETE FROM deliveries WHERE bot_id=?').run(botId);
    for(const table of ['stats_usage_calls','stats_message_facts'])store.db.prepare(`DELETE FROM ${table} WHERE bot=?`).run(botId);
    for(const table of ['stats_group_projection','stats_projection_meta'])store.db.prepare(`DELETE FROM ${table} WHERE json_extract(json,'$.botId')=?`).run(botId);
    store.db.prepare("UPDATE collection_revisions SET revision=revision+1 WHERE name IN ('sessions','assets')").run();
  });
}
