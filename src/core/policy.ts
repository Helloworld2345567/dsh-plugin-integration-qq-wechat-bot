import type {SystemLocale} from '../i18n/common.js';
import {skillToolManifests} from './skill-operations.js';
import type { BotConfig, BotInstance, CallerScope, ServiceProfileRole, TurnServiceSelection, TurnSnapshot } from './types.js';
import {imageSkillEnabled} from './image-skill.js';
import {analysisEnabled} from './analysis.js';
import type {ProfileStore} from './profile-store.js';
export const BUSINESS_TOOLS = new Set([...skillToolManifests.map(manifest=>manifest.tool.name),'image_generation','bot_media','bot_voice','bot_voice_control','bot_send_file','bot_remember','bot_forget_memory','bot_read_social','skill','bot_stats','bot_evolve','bot_model','bot_session','bot_persona','bot_skills','bot_schedule','bot_proactive']);
export const NATIVE_HOST_TOOLS = new Set(['pwsh','bash','read','write','edit','read_file','write_file','str_replace','list_directory','glob','grep','terminal','read_terminal','write_terminal']);
export const CHANNEL_WEB_TOOLS=new Set(['web_search','web_fetch']);
export function trusted(bot:BotInstance,scope:CallerScope):boolean { return scope.kind==='private' && bot.trustedUsers.includes(scope.senderId); }
export function permitted(name:string,config:BotConfig,bot:BotInstance,scope:CallerScope):boolean {
  if(!bot.enabled || bot.archived) return false;
  if(name==='bot_session'||name==='bot_skills')return true;
  if(name==='bot_stats'||name==='bot_model'||name==='bot_persona'||name==='bot_voice_control'||name==='bot_schedule'||name==='bot_proactive')return trusted(bot,scope);
  if(name==='bot_evolve')return trusted(bot,scope)&&config.allowHostTools;
  if(name==='bot_voice')return config.skills.includes('voice-generation')&&config.tools.includes('bot_voice')&&config.media.voice?.enabled===true;
  if(name==='bot_sing')return config.skills.includes('singing-conversion')&&config.tools.includes('bot_sing')&&config.media.singing?.enabled===true;
  if(name==='bot_music')return config.skills.includes('music-download')&&config.tools.includes('bot_music')&&config.media.music?.enabled===true;
  if(name==='image_generation')return imageSkillEnabled(config);
  const skillTool=skillToolManifests.find(manifest=>manifest.tool.name===name);
  if(skillTool)return config.skills.includes(skillTool.skill)&&config.tools.includes('bot_media')&&(!skillTool.enabledRoles?.length||skillTool.enabledRoles.some(role=>(role==='tts'?config.media.voice:config.media[role])?.enabled!==false));
  if(CHANNEL_WEB_TOOLS.has(name))return config.tools.includes(name);
  if(BUSINESS_TOOLS.has(name)) return name==='skill' ? config.skills.length>0 : config.tools.includes(name);
  return trusted(bot,scope) && config.allowHostTools && (config.hostTools.includes(name) || NATIVE_HOST_TOOLS.has(name));
}
const roleForTool=(name:string):ServiceProfileRole|undefined=>name==='bot_voice'?'voice':name==='bot_sing'?'singing':name==='bot_music'?'music':undefined;
function frozenServiceAllowed(name:string,snapshot:TurnSnapshot):boolean {
  const role=roleForTool(name);if(!role)return true;
  const service=snapshot.services[role];return service?.enabled===true&&['ready','partial'].includes(service.state)&&(role==='voice'&&snapshot.config.media.voice?.protocol==='edge_tts'||!!service.snapshot);
}
export function allowedNow(name:string,snapshot:TurnSnapshot,current:BotConfig,bot:BotInstance,scope:CallerScope):boolean {
  return frozenServiceAllowed(name,snapshot)&&permitted(name,snapshot.config as BotConfig,{...bot,trustedUsers:snapshot.trusted?[scope.senderId]:[]},scope)&&permitted(name,current,bot,scope);
}
/** Keep frozen business preferences, but remove roles revoked since turn/start. */
export function mediaConfigNow(snapshot:TurnSnapshot,current:BotConfig):BotConfig {
  return {...snapshot.config,media:{...snapshot.config.media,...Object.fromEntries(Object.entries(current.media).filter(([,value])=>value?.enabled===false).map(([role])=>[role,{...snapshot.config.media[role as keyof BotConfig['media']],enabled:false}]))}} as BotConfig;
}
export function permissionsRevoked(snapshot:TurnSnapshot,current:BotConfig,bot:BotInstance,scope:CallerScope):boolean {
  return !bot.enabled||bot.archived||current.archived||(snapshot.trusted&&!trusted(bot,scope))||snapshot.config.tools.some(name=>!current.tools.includes(name))||(snapshot.config.allowHostTools&&!current.allowHostTools)||snapshot.config.hostTools.some(name=>!current.hostTools.includes(name))||snapshot.config.skills.some(name=>!current.skills.includes(name))||(imageSkillEnabled(snapshot.config)&&!imageSkillEnabled(current))||(['asr','video'] as const).some(role=>analysisEnabled(snapshot.config,role)&&!analysisEnabled(current,role))||(snapshot.config.media.voice?.enabled===true&&current.media.voice?.enabled!==true)||(snapshot.config.media.singing?.enabled===true&&current.media.singing?.enabled!==true)||(snapshot.config.media.music?.enabled===true&&current.media.music?.enabled!==true);
}
function freezeService(role:ServiceProfileRole,config:BotConfig,profiles?:ProfileStore):Readonly<TurnServiceSelection>|undefined {
  const options=config.media[role];if(!options)return;
  if(options.enabled!==true)return Object.freeze({role,enabled:false,state:'disabled'});
  if(role==='voice'&&config.media.voice?.protocol==='edge_tts')return Object.freeze({role,enabled:true,state:'ready'});
  if(!options.profileRef)return Object.freeze({role,enabled:true,state:'missing'});
  const profile=profiles?.get(options.profileRef);
  if(!profile)return Object.freeze({role,enabled:true,profileRef:Object.freeze({...options.profileRef}),state:'missing'});
  const selection:TurnServiceSelection={role,enabled:true,profileRef:Object.freeze({...options.profileRef}),state:profile.state,snapshot:Object.freeze({serviceId:profile.serviceId,profileId:profile.profileId,profileRevision:profile.revision,profileContentHash:profile.contentHash})};
  return Object.freeze(selection);
}
export function freezeTurn(config:BotConfig,bot:BotInstance,scope:CallerScope,sourceIds:string[],profiles?:ProfileStore,systemLocale:SystemLocale='zh'):TurnSnapshot {
  const frozenConfig=deepFreeze(structuredClone(config));const services=Object.freeze(Object.fromEntries((['voice','singing','music'] as const).map(role=>[role,freezeService(role,config,profiles)]).filter(([,value])=>value!==undefined)));
  return Object.freeze({systemLocale,config:frozenConfig,personaId:config.id,personaRevision:config.revision,services,botId:bot.id,trusted:trusted(bot,scope),sourceIds:Object.freeze([...sourceIds]) as string[],startedAt:Date.now()});
}
function deepFreeze<T>(value:T):Readonly<T> { if(value && typeof value==='object') {Object.freeze(value); for(const child of Object.values(value)) deepFreeze(child);} return value; }
