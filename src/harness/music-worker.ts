import path from 'node:path';
import type {WorkerPort,MediaWorkerJob,WorkerCredentials} from '../core/worker-port.js';
import type {MediaResult} from '../core/media.js';
import {MUSIC_PROTOCOL,MUSIC_SOURCES,type MusicCandidate,type MusicHealth} from '../core/music-state.js';
import {validateMediaWorkerJob} from '../core/worker-port.js';
import {runJsonProcess,jobEnvironment} from './json-process.js';

export interface MusicConfig {home?:string;sources:string[]}
export function resolveMusicConfig(value?:{home?:string;sources?:string[]}):MusicConfig {
  const home=value?.home?.trim()||process.env.BOT_MUSIC_HOME?.trim();
  const sources=value?.sources??['MiguMusicClient','KuwoMusicClient'];
  if(!sources.length||sources.some(source=>!(MUSIC_SOURCES as readonly string[]).includes(source))||new Set(sources).size!==sources.length)throw Error('MUSIC_SOURCES_INVALID');
  return {home:home?path.resolve(home):undefined,sources:[...sources]};
}
function candidate(value:any):MusicCandidate {
  for(const key of ['source','id','title','artist'])if(typeof value?.[key]!=='string'||!value[key].trim()||value[key].length>500)throw Error('MUSIC_RESPONSE_INVALID');
  if(!(MUSIC_SOURCES as readonly string[]).includes(value.source))throw Error('MUSIC_RESPONSE_INVALID');
  const result:MusicCandidate={source:value.source,id:value.id,title:value.title,artist:value.artist};
  for(const key of ['album','format','version'] as const)if(typeof value[key]==='string')result[key]=value[key].slice(0,500);
  for(const key of ['duration','size'] as const)if(typeof value[key]==='number'&&Number.isFinite(value[key])&&value[key]>=0)result[key]=value[key];
  if(value.locator!==undefined){if(Buffer.byteLength(JSON.stringify(value.locator))>32*1024)throw Error('MUSIC_RESPONSE_INVALID');result.locator=value.locator;}
  return result;
}
export class MusicProcessWorker implements WorkerPort {
  constructor(readonly fallback:WorkerPort,readonly config:MusicConfig){}
  private async exchange(request:Record<string,unknown>,output:string,signal:AbortSignal,timeoutMs:number){
    if(!this.config.home)throw Error('MUSIC_NOT_CONFIGURED');
    const python=path.join(this.config.home,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    const entry=path.join(this.config.home,'scripts','music_api.py');
    const response=await runJsonProcess(python,['-B','-u',entry],{...request,protocol:MUSIC_PROTOCOL,version:1,output,deadline:Date.now()+timeoutMs,sources:this.config.sources},{cwd:output,signal,timeoutMs,env:jobEnvironment(output)}).catch(error=>{if(signal.aborted)throw Error('MUSIC_CANCELLED');if(error?.code==='ENOENT')throw Error('MUSIC_ENVIRONMENT_UNAVAILABLE');throw error;});
    if(response.protocol!==MUSIC_PROTOCOL||response.version!==1)throw Error('MUSIC_PROTOCOL_UNSUPPORTED');
    if(response.ok!==true)throw Error(/^MUSIC_[A-Z_]+$/.test(response.error?.code??'')?response.error.code:'MUSIC_OPERATION_FAILED');
    if(!response.result||typeof response.result!=='object')throw Error('MUSIC_RESPONSE_INVALID');return response.result;
  }
  async musicHealth(signal:AbortSignal,output:string):Promise<MusicHealth>{
    const base:MusicHealth={configured:!!this.config.home,ready:false,protocol:MUSIC_PROTOCOL,sources:this.config.sources.map(id=>({id,available:false}))};
    if(!this.config.home)return {...base,error:'MUSIC_NOT_CONFIGURED'};
    try{const result=await this.exchange({action:'health'},output,signal,20_000);return {...base,ready:result.ready===true,sources:this.config.sources.map(id=>({id,available:result.ready===true})),...(result.ready===true?{}:{error:'MUSIC_ENVIRONMENT_UNAVAILABLE'})};}catch(error){return {...base,error:error instanceof Error&&/^MUSIC_[A-Z_]+$/.test(error.message)?error.message:'MUSIC_ENVIRONMENT_UNAVAILABLE'};}
  }
  async run(job:MediaWorkerJob,signal:AbortSignal,credentials:WorkerCredentials={}):Promise<MediaResult>{
    if(!['music_search','music_acquire'].includes(job.operation))return this.fallback.run(job,signal,credentials);
    validateMediaWorkerJob(job);
    const includeLyrics=job.operation==='music_acquire'&&job.parameters.includeLyrics===true;
    const result=await this.exchange({action:job.operation==='music_search'?'search':'acquire',song:job.parameters.song,artist:job.parameters.artist,selection:job.parameters.selection,purpose:'source',includeLyrics},job.output,signal,job.timeoutMs||240_000);
    const diagnostics=Array.isArray(result.diagnostics)?result.diagnostics.slice(0,4).map((value:any)=>({source:String(value.source).slice(0,100),status:String(value.status).slice(0,100)})):[];
    if(job.operation==='music_search')return {music:{candidates:(Array.isArray(result.candidates)?result.candidates:[]).slice(0,10).map(candidate),diagnostics}};
    const track=candidate(result.track),audio=result.audio;
    if(!audio||audio.kind!=='audio'||typeof audio.path!=='string'||typeof audio.name!=='string'||typeof audio.mime!=='string')throw Error('MUSIC_OUTPUT_INVALID');
    const assets=[audio];if(includeLyrics&&result.lyric){if(result.lyric.kind!=='file'||typeof result.lyric.path!=='string'||typeof result.lyric.name!=='string'||typeof result.lyric.mime!=='string')throw Error('MUSIC_OUTPUT_INVALID');assets.push(result.lyric);}
    return {assets,music:{track,diagnostics}};
  }
}
