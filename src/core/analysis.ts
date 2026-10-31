import type {BotConfig,GptSovitsConfig} from './types.js';
/** ASR/video use the native model connection; TTS is local Edge TTS or GPT-SoVITS. */
export type AnalysisRole='asr'|'video'|'tts';
export type AnalysisProtocol='chat_completions'|'transcriptions'|'edge_tts'|'gpt_sovits';
export interface NativeAnalysisEndpoint {baseUrl:string;model:string;keyEnv:string;protocol:Exclude<AnalysisProtocol,'gpt_sovits'|'edge_tts'>;headers?:Record<string,string>}
export interface EdgeTtsEndpoint {protocol:'edge_tts';voice:string;baseUrl?:never;model?:never;keyEnv?:never}
export type GptSovitsEndpoint=GptSovitsConfig&{protocol:'gpt_sovits';voice:string;model?:never;keyEnv?:never;headers?:never};
export type AnalysisEndpoint=NativeAnalysisEndpoint|EdgeTtsEndpoint|GptSovitsEndpoint;
export interface AnalysisConnection {provider:string;endpoint:AnalysisEndpoint;apiKey?:string}
export interface AnalysisProvider {resolve(config:BotConfig,role:AnalysisRole):Promise<AnalysisConnection>}
export function analysisEnabled(config:Readonly<BotConfig>,role?:AnalysisRole):boolean{
  // Voice is a separately opt-in skill and permission so enabling media analysis
  // cannot unexpectedly create paid TTS calls. `voice` is the only public config key.
  if(role==='tts'){
    const media=config.media as Record<string,any>;
    const options=media.voice;
    return config.skills.includes('voice-generation')&&config.tools.includes('bot_voice')&&options?.enabled===true;
  }
  const enabled=config.skills.includes('media-analysis')&&config.tools.includes('bot_media');
  if(!enabled)return false;
  if(role)return (config.media as Record<string,any>)[role]?.enabled!==false;
  return (config.media as Record<string,any>).asr?.enabled!==false||(config.media as Record<string,any>).video?.enabled!==false;
}
