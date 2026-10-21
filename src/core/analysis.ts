import type {BotConfig} from './types.js';
export type AnalysisRole='asr'|'video';
export interface AnalysisEndpoint {baseUrl:string;model:string;keyEnv:string;protocol:'chat_completions'|'transcriptions';headers?:Record<string,string>}
export interface AnalysisConnection {provider:string;endpoint:AnalysisEndpoint;apiKey:string}
export interface AnalysisProvider {resolve(config:BotConfig,role:AnalysisRole):Promise<AnalysisConnection>}
export function analysisEnabled(config:Readonly<BotConfig>,role?:AnalysisRole):boolean{
  return config.skills.includes('media-analysis')&&config.tools.includes('bot_media')&&(role?config.media[role]?.enabled!==false:config.media.asr?.enabled!==false||config.media.video?.enabled!==false);
}
