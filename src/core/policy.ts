import type { BotConfig, BotInstance, CallerScope, TurnSnapshot } from './types.js';
import {imageSkillEnabled} from './image-skill.js';
import {analysisEnabled} from './analysis.js';
export const BUSINESS_TOOLS = new Set(['media_analysis','image_generation','bot_media','bot_send_file','bot_remember','bot_forget_memory','bot_read_social','skill','bot_stats','bot_evolve','bot_model','bot_session','bot_persona','bot_skills']);
export const NATIVE_HOST_TOOLS = new Set(['pwsh','bash','read','write','edit','read_file','write_file','str_replace','list_directory','glob','grep','terminal','read_terminal','write_terminal']);
export const CHANNEL_WEB_TOOLS=new Set(['web_search','web_fetch']);
export function trusted(bot:BotInstance,scope:CallerScope):boolean { return scope.kind==='private' && bot.trustedUsers.includes(scope.senderId); }
export function permitted(name:string,config:BotConfig,bot:BotInstance,scope:CallerScope):boolean {
  if(!bot.enabled || bot.archived) return false;
  if(name==='bot_session'||name==='bot_skills')return true;
  if(name==='bot_stats'||name==='bot_model'||name==='bot_persona')return trusted(bot,scope);
  if(name==='bot_evolve')return trusted(bot,scope)&&config.allowHostTools;
  if(name==='image_generation')return imageSkillEnabled(config);
  if(name==='media_analysis')return analysisEnabled(config);
  if(CHANNEL_WEB_TOOLS.has(name))return config.tools.includes(name);
  if(BUSINESS_TOOLS.has(name)) return name==='skill' ? config.skills.length>0 : config.tools.includes(name);
  return trusted(bot,scope) && config.allowHostTools && (config.hostTools.includes(name) || NATIVE_HOST_TOOLS.has(name));
}
export function allowedNow(name:string,snapshot:TurnSnapshot,current:BotConfig,bot:BotInstance,scope:CallerScope):boolean {
  return permitted(name,snapshot.config as BotConfig,{...bot,trustedUsers:snapshot.trusted ? [scope.senderId] : []},scope) && permitted(name,current,bot,scope);
}
/** Keep the frozen provider selection, but remove roles revoked since turn/start. */
export function mediaConfigNow(snapshot:TurnSnapshot,current:BotConfig):BotConfig {
  return {...snapshot.config,media:{...snapshot.config.media,...Object.fromEntries(Object.entries(current.media).filter(([,value])=>value?.enabled===false).map(([role])=>[role,{...snapshot.config.media[role as keyof BotConfig['media']],enabled:false}]))}} as BotConfig;
}
export function permissionsRevoked(snapshot:TurnSnapshot,current:BotConfig,bot:BotInstance,scope:CallerScope):boolean {
  return !bot.enabled||bot.archived||current.archived||(snapshot.trusted&&!trusted(bot,scope))||snapshot.config.tools.some(name=>!current.tools.includes(name))||(snapshot.config.allowHostTools&&!current.allowHostTools)||snapshot.config.hostTools.some(name=>!current.hostTools.includes(name))||snapshot.config.skills.some(name=>!current.skills.includes(name))||(imageSkillEnabled(snapshot.config)&&!imageSkillEnabled(current))||(['asr','video'] as const).some(role=>analysisEnabled(snapshot.config,role)&&!analysisEnabled(current,role));
}
export function freezeTurn(config:BotConfig,bot:BotInstance,scope:CallerScope,sourceIds:string[]):TurnSnapshot { return Object.freeze({config:deepFreeze(structuredClone(config)),botId:bot.id,trusted:trusted(bot,scope),sourceIds:[...sourceIds],startedAt:Date.now()}); }
function deepFreeze<T>(value:T):Readonly<T> { if(value && typeof value==='object') {Object.freeze(value); for(const child of Object.values(value)) deepFreeze(child);} return value; }
