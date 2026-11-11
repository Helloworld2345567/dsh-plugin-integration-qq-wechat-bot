import {diagnosticFields} from '../i18n/diagnostics.js';
import path from 'node:path';
import {z} from 'zod';
import {MUSIC_SOURCES,type MusicCandidate} from './music-state.js';
import {IsolatedServiceAdapter,assertOutputFile,providerFailure,SERVICE_OPERATION_MAP} from './service-adapter-utils.js';
import {serviceFailure} from './service-errors.js';
import type {CancelResult,HealthResult,ResolvedServiceProfileRevision,ServiceAdapterJob,ServiceHealthContext,ServiceProfileRevision,ServiceResult} from './service-contract.js';
import type {ServiceShadowComparator} from './service-shadow.js';

const musicProfileSchema=z.object({home:z.string().min(1).max(4096),sources:z.array(z.enum(MUSIC_SOURCES)).min(1).max(MUSIC_SOURCES.length).refine(value=>new Set(value).size===value.length)}).strict();
const querySchema=z.object({song:z.string().trim().min(1).max(300),artist:z.string().trim().max(200).optional(),includeLyrics:z.boolean().optional()}).strict();
const selectionSchema=z.object({selection:z.object({source:z.enum(MUSIC_SOURCES),id:z.string().min(1).max(500),title:z.string().min(1).max(500),artist:z.string().min(1).max(500),album:z.string().max(500).optional(),format:z.string().max(500).optional(),version:z.string().max(500).optional(),duration:z.number().nonnegative().optional(),size:z.number().nonnegative().optional(),locator:z.unknown().optional()}).passthrough(),includeLyrics:z.boolean().optional()}).strict();
export type MusicProfileConfig=z.infer<typeof musicProfileSchema>;
export interface MusicFacadeRequest {action:'health'|'search'|'acquire';song?:string;artist?:string;selection?:unknown;includeLyrics?:boolean;outputDirectory:string;deadline:number;sources:readonly string[]}
export interface MusicFacadePort {exchange(config:MusicProfileConfig,request:MusicFacadeRequest,signal:AbortSignal):Promise<any>}
function publicCandidate(value:any):MusicCandidate {
  for(const key of ['source','id','title','artist'])if(typeof value?.[key]!=='string'||!value[key].trim()||value[key].length>500)throw Error('MUSIC_RESPONSE_INVALID');if(!(MUSIC_SOURCES as readonly string[]).includes(value.source))throw Error('MUSIC_RESPONSE_INVALID');
  const result:MusicCandidate={source:value.source,id:value.id,title:value.title,artist:value.artist};for(const key of ['album','format','version'] as const)if(typeof value[key]==='string')result[key]=value[key].slice(0,500);for(const key of ['duration','size'] as const)if(typeof value[key]==='number'&&Number.isFinite(value[key])&&value[key]>=0)result[key]=value[key];if(value.locator!==undefined)result.locator=value.locator;return result;
}
function diagnostics(result:any,sources:readonly string[]):Array<{source:string;status:string}>{const values=Array.isArray(result?.diagnostics)?result.diagnostics:[];return sources.map(source=>{const found=values.find((item:any)=>item?.source===source);return{source,status:typeof found?.status==='string'?found.status.slice(0,100):'unavailable'};});}
export class MusicServiceAdapter extends IsolatedServiceAdapter {
  constructor(readonly facade:MusicFacadePort,shadow?:ServiceShadowComparator){super('music',shadow);}
  async listProfiles(_signal:AbortSignal):Promise<readonly ServiceProfileRevision[]>{return[];}
  async health(profile:ResolvedServiceProfileRevision,signal:AbortSignal,context?:ServiceHealthContext):Promise<HealthResult>{const checkedAt=Date.now();try{if(!context)throw Error('MUSIC_HEALTH_CONTEXT_REQUIRED');const config=musicProfileSchema.parse(profile.managedConfig),result=await this.facade.exchange(config,{action:'health',outputDirectory:context.outputDirectory,deadline:Date.now()+20_000,sources:config.sources},signal),advertised=Array.isArray(result?.sources)?new Set(result.sources.filter((value:unknown):value is string=>typeof value==='string')):undefined,rows=Array.isArray(result?.diagnostics)?diagnostics(result,config.sources):config.sources.map(source=>({source,status:result?.ready===true&&advertised?.has(source)?'success':'unavailable'})),ready=result?.ready===true&&rows.every(item=>item.status==='success');return{state:ready?'ready':'degraded',checkedAt,expiresAt:checkedAt+30_000,...diagnosticFields(ready?"musicHealthy":"musicDegraded")};}catch{return{state:'unavailable',checkedAt,expiresAt:checkedAt+5000,...diagnosticFields("musicHealthFailed")};}}
  async execute(job:ServiceAdapterJob,signal:AbortSignal):Promise<ServiceResult>{return this.tracked(job,async()=>{try{
    const config=musicProfileSchema.parse(job.profile.managedConfig);signal.throwIfAborted();if(job.deadline<=Date.now())throw Error('MUSIC_TIMEOUT');
    if(job.operation===SERVICE_OPERATION_MAP.musicSearch){const query=querySchema.parse(job.parameters),result=await this.facade.exchange(config,{action:'search',song:query.song,artist:query.artist,outputDirectory:job.outputDirectory,deadline:job.deadline,sources:config.sources},signal);return{outputs:[],observations:{music:{candidates:(Array.isArray(result?.candidates)?result.candidates:[]).slice(0,10).map(publicCandidate),diagnostics:diagnostics(result,config.sources),resultType:'search'}}};}
    if(job.operation!==SERVICE_OPERATION_MAP.musicAcquire)serviceFailure({category:'INVALID_INPUT',...diagnosticFields("musicOperationUnsupported"),retryable:false,blocksService:false});
    const parsed=Object.hasOwn(job.parameters,'selection')?selectionSchema.parse(job.parameters):querySchema.parse(job.parameters),includeLyrics=parsed.includeLyrics===true,result=await this.facade.exchange(config,{action:'acquire',...('selection'in parsed?{selection:parsed.selection}:{song:parsed.song,artist:parsed.artist}),includeLyrics,outputDirectory:job.outputDirectory,deadline:job.deadline,sources:config.sources},signal),track=publicCandidate(result?.track),audio=result?.audio;
    if(!audio||audio.kind!=='audio'||typeof audio.path!=='string'||typeof audio.name!=='string'||audio.preview===true||audio.completeness==='preview'||audio.complete===false)throw Error('MUSIC_OUTPUT_NOT_FULL');const outputs:Array<{kind:'image'|'audio'|'video'|'file';handle:string;name:string}>=[{kind:'audio',handle:assertOutputFile(job,audio.path),name:path.basename(audio.name)}];
    if(includeLyrics&&result?.lyric){const lyric=result.lyric;if(lyric.kind!=='file'||typeof lyric.path!=='string'||typeof lyric.name!=='string')throw Error('MUSIC_OUTPUT_INVALID');outputs.push({kind:'file',handle:assertOutputFile(job,lyric.path),name:path.basename(lyric.name)});}return{outputs,observations:{music:{track,diagnostics:diagnostics(result,config.sources),resultType:'full'}}};
  }catch(error){providerFailure(error);}});}
  async cancel(jobId:string):Promise<CancelResult>{return this.waitCancelled(jobId);}
}
