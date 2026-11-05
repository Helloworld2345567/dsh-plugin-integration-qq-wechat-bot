import type {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import type {Asset,BotConfig,Delivery,SessionBinding,TurnSnapshot} from '../src/core/types.js';
import type {SessionActionRecord} from '../src/core/session-actions.js';

/**
 * Infrastructure-only compatibility seeds.  Ordinary tests use named
 * repositories; raw records stay centralized here for malformed/legacy rows
 * that cannot be produced by a current application contract.
 */
export function seedAppliedConfig(persistence:SqlitePersistence,config:BotConfig,version=true):void {
  persistence.database.records.put('config',config.id,config);
  if(version)persistence.database.records.put('config-version',`${config.id}:${config.revision}`,config);
}
export function seedLegacyBinding(persistence:SqlitePersistence,key:string,value:unknown):void {
  persistence.database.records.put('binding',key,value);
}
export function seedLegacyAssetMetadata(persistence:SqlitePersistence,asset:Asset):void {
  persistence.database.records.put('asset',asset.id,asset);
}
export function seedLegacyCursor(persistence:SqlitePersistence,botId:string,value:unknown):void {
  persistence.database.records.put('cursor',botId,value);
}
export function readCursorRecord(persistence:SqlitePersistence,kind:'cursor'|'channel-cursor',id:string):unknown {
  return persistence.database.records.get(kind,id);
}
export function seedQuota(persistence:SqlitePersistence,key:string,value:number):void {
  persistence.database.records.put('media-quota',key,value);
}
export function readQuota(persistence:SqlitePersistence,key:string):number|undefined {
  return persistence.database.records.get<number>('media-quota',key);
}
export function seedSessionAction(persistence:SqlitePersistence,record:SessionActionRecord):void {
  persistence.sessionActions.saveSessionAction(record.id,record);
}
export function seedTurnSnapshot(persistence:SqlitePersistence,sessionId:string,snapshot:TurnSnapshot):void {
  persistence.turnSnapshots.saveTurnSnapshot(sessionId,snapshot);
}
export function seedBotHistoryAggregate(persistence:SqlitePersistence,binding:SessionBinding):void {
  persistence.database.db.prepare('INSERT OR REPLACE INTO memory VALUES(?,?,?,?,?,?,?,?)').run(binding.key,'name','private memory','source','quote',1,0,Date.now());
  persistence.database.records.put('scheduled-job',binding.sessionId,{botId:binding.scope.botId,scopeKey:binding.key,scope:binding.scope});
  persistence.database.records.put('job-run',`run:${binding.sessionId}`,{scopeKey:binding.key});
  persistence.database.records.put('stats-session',binding.sessionId,{botId:binding.scope.botId,sessionId:binding.sessionId});
  persistence.database.records.put('stats-native',`fact:${binding.sessionId}`,{sessionId:binding.sessionId,text:'private fact'});
  persistence.database.records.put('turn-snapshot',binding.sessionId,{botId:binding.scope.botId});
}
export function botHistorySentinelCounts(persistence:SqlitePersistence):{memory:number;native:number;replySequence:number} {
  return {
    memory:Number((persistence.database.db.prepare('SELECT COUNT(*) n FROM memory').get() as {n:number|bigint}).n),
    native:persistence.database.records.count('stats-native'),
    replySequence:persistence.database.records.count('reply-sequence'),
  };
}
export function mutateLegacyDelivery(persistence:SqlitePersistence,id:string,value:Delivery,outputIndex?:number):void {
  if(outputIndex===undefined)persistence.database.db.prepare('UPDATE deliveries SET json=? WHERE id=?').run(JSON.stringify(value),id);
  else persistence.database.db.prepare('UPDATE deliveries SET json=?,output_index=? WHERE id=?').run(JSON.stringify(value),outputIndex,id);
}
export function clearReplySequences(persistence:SqlitePersistence):void {
  persistence.database.db.prepare("DELETE FROM records WHERE kind='reply-sequence'").run();
}
export function installFailingPersonaTrigger(persistence:SqlitePersistence):void {
  persistence.database.db.exec("CREATE TRIGGER fail_persona BEFORE UPDATE ON records WHEN NEW.kind='config' BEGIN SELECT RAISE(ABORT,'fixture commit failure'); END");
}
export function seedMediaJob(persistence:SqlitePersistence,id:string,value:unknown):void {
  persistence.jobs.saveJob(id,value);
}
export function seedMalformedStatsBinding(persistence:SqlitePersistence,key:string,value:unknown):void {
  seedLegacyBinding(persistence,key,value);
}
export function seedLegacyDeliveryState(persistence:SqlitePersistence,delivery:Delivery,state:Delivery['state'],sentAt?:number):void {
  persistence.database.db.prepare('UPDATE deliveries SET state=?,json=? WHERE id=?').run(state,JSON.stringify({...delivery,state,...sentAt===undefined?{}:{sentAt}}),delivery.id);
}
