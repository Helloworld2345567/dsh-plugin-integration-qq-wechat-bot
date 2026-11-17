import {randomUUID} from 'node:crypto';
import type {Assets,MediaService} from '../core/media.js';
import type {BindingRepository} from '../core/ports/session.js';
import type {AssetRepository, SingingStateRepository} from '../core/ports/media.js';
import type {BotConfig,BotInstance,SessionBinding,TurnSnapshot,Output} from '../core/types.js';
import {allowedNow,mediaConfigNow} from '../core/policy.js';
import {assertSingingSession,singingCandidates,saveSingingCandidates,publicSingingCandidates,type SingingCandidate,type SingingAttempt,type SingingTurn} from '../core/singing-state.js';
import {acquireMusicSource,musicAuthorization,type MusicToolRepositories} from './music-tool.js';
import {publicMusicTrack} from '../core/music-state.js';
import {ServiceContractError} from '../core/service-errors.js';

export interface SingingContext {binding:SessionBinding;snapshot:TurnSnapshot;singing:SingingTurn;assets:Output[]}
export interface SingingToolRepositories {bindings:BindingRepository;singing:SingingStateRepository;assets:AssetRepository}
interface Dependencies {repos:SingingToolRepositories & MusicToolRepositories;assets:Assets;media:MediaService;current:()=>BotConfig;bot:()=>BotInstance;authorizeMusic?:()=>void;music?:SingingAttempt['music'];candidate?:SingingCandidate}
function text(value:unknown,max=300):string|undefined {return typeof value==='string'&&value.trim()&&value.length<=max?value.trim():undefined;}
function url(value:unknown):string {try{const parsed=new URL(String(value));if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port&&parsed.port!=='443')throw Error();return parsed.toString();}catch{throw Error('SINGING_SOURCE_INVALID');}}
function publicError(error:unknown):string {const code=error instanceof ServiceContractError?error.serviceError.providerCode??'':error instanceof Error?error.message:'';return /^SINGING_[A-Z_]+$/.test(code)?code:'SINGING_CONVERSION_FAILED';}

export async function executeSingingTool(live:SingingContext,args:Record<string,any>,signal:AbortSignal,deps:Dependencies):Promise<string>{
  const {assets,media}=deps,binding=live.binding;
  const authorize=()=>{signal.throwIfAborted();assertSingingSession(deps.repos.bindings,binding);if(!allowedNow('bot_sing',live.snapshot,deps.current(),deps.bot(),binding.scope))throw Error('SINGING_DISABLED');deps.authorizeMusic?.();};
  authorize();
  const selectedCandidate=args.candidate??args.number;
  const action=args.action??'list';
  if(action==='list')return JSON.stringify(publicSingingCandidates(singingCandidates({bindings:deps.repos.bindings,singing:deps.repos.singing},binding)));
  if(action==='sing'){
    live.singing.attempted=true;
    const selectionKey=JSON.stringify([args.song,args.artist,args.candidateSet,selectedCandidate]);
    const currentConfig=mediaConfigNow(live.snapshot,deps.current()),options=currentConfig.media.singing;
    const selection=live.snapshot.services.singing;if(!options?.enabled||!selection?.snapshot||!['ready','partial'].includes(selection.state))throw Error('SINGING_CONFIGURATION_INVALID');
    const authorizeMusic=musicAuthorization(live,signal,deps);authorizeMusic();
    const acquired=await acquireMusicSource(live,args.candidateSet!==undefined||selectedCandidate!==undefined?{candidateSet:args.candidateSet,candidate:selectedCandidate}:{song:args.song,artist:args.artist},signal,deps,authorize);
    authorize();authorizeMusic();
    const candidate={number:1,title:acquired.track!.title,assetId:acquired.sourceAssetId};
    const response=JSON.parse(await executeSingingTool(live,{action:'convert',candidate:1,sourceType:'mixed',format:'mp3'},signal,{...deps,authorizeMusic,candidate,music:{selectionKey,track:acquired.track!}}));
    return JSON.stringify({...response,track:publicMusicTrack(acquired.track!)});
  }
  if(action==='prepare'){
    if(args.inputs!==undefined&&(!Array.isArray(args.inputs)||args.inputs.length>1)||args.candidates!==undefined&&(!Array.isArray(args.candidates)||args.candidates.length>5)||args.inputs?.length&&args.candidates?.length||args.url!==undefined&&(args.candidates?.length||args.inputs?.length))throw Error('SINGING_SOURCE_INVALID');
    const candidates:Omit<SingingCandidate,'number'>[]=[];
    for(const id of args.inputs??[]){
      const asset=await assets.resolve(binding.key,String(id)).catch(()=>{throw Error('SINGING_ATTACHMENT_INVALID');});
      if(asset.sessionId!==binding.sessionId||!['audio','file'].includes(asset.kind))throw Error('SINGING_ATTACHMENT_INVALID');
      candidates.push({title:asset.name,assetId:asset.id});
    }
    if(args.url!==undefined){
      const direct=url(args.url);candidates.push({title:text(args.title)??direct,url:direct,source:direct});
    }
    if(args.candidates?.length){
      if(!allowedNow('web_fetch',live.snapshot,deps.current(),deps.bot(),binding.scope))throw Error('SINGING_NETWORK_DISABLED');
      for(const item of args.candidates){if(!item||!text(item.title))throw Error('SINGING_SOURCE_INVALID');candidates.push({title:text(item.title)!,url:url(item.url),...(item.source?{source:url(item.source)}:{}),...(text(item.license)?{license:text(item.license)}:{})});}
    }
    authorize();return JSON.stringify(publicSingingCandidates(saveSingingCandidates({bindings:deps.repos.bindings,singing:deps.repos.singing},binding,candidates,candidates.length===0)));
  }
  if(action!=='convert')throw Error('SINGING_ACTION_INVALID');
  live.singing.attempted=true;
  const request=randomUUID();
  const candidates=singingCandidates({bindings:deps.repos.bindings,singing:deps.repos.singing},binding);
  if(!deps.candidate&&(!candidates||args.candidateSet!==candidates.id))throw Error('SINGING_CANDIDATES_STALE');
  const candidate=deps.candidate??candidates?.candidates.find(item=>item.number===selectedCandidate);
  if(!candidate)throw Error('SINGING_CANDIDATE_INVALID: Use candidate from candidates[].candidate; it must be a positive integer within the returned candidate list.');
  const candidateUrl=candidate.url?url(candidate.url):undefined;
  const config=mediaConfigNow(live.snapshot,deps.current()),format=args.format??config.media.singing?.defaultOutput??'mp3';
  if(!live.snapshot.services.singing?.snapshot||!['ready','partial'].includes(live.snapshot.services.singing.state))throw Error('SINGING_CONFIGURATION_INVALID');
  if(args.sourceType!=='vocals'&&args.sourceType!=='mixed')throw Error('SINGING_SOURCE_TYPE_REQUIRED');
  if(!['wav','mp3'].includes(format))throw Error('SINGING_FORMAT_INVALID');
  if(candidateUrl&&!allowedNow('web_fetch',live.snapshot,deps.current(),deps.bot(),binding.scope))throw Error('SINGING_NETWORK_DISABLED');
  const authorizeSource=()=>{authorize();if(candidateUrl&&!allowedNow('web_fetch',live.snapshot,deps.current(),deps.bot(),binding.scope))throw Error('SINGING_NETWORK_DISABLED');if(candidate.assetId&&deps.repos.assets.asset(binding.key,candidate.assetId).sessionId!==binding.sessionId)throw Error('SINGING_ATTACHMENT_INVALID');};
  authorizeSource();
  deps.repos.singing.saveAttempt(binding.key,{request,state:'running',format,...(deps.music?{music:deps.music}:{})} satisfies SingingAttempt);
  if(candidates&& !deps.candidate)deps.repos.singing.saveCandidates(binding.key,{...candidates,waiting:false});
  try{
    const result=await media.run(binding.key,'singing_convert',config,candidate.assetId?[candidate.assetId]:[],{sourceType:args.sourceType,format,...(candidateUrl?{url:candidateUrl}:{})},signal,authorizeSource,live.snapshot);
    authorizeSource();
    if(result.assetIds.length!==1)throw Error('SINGING_OUTPUT_INVALID');
    for(const assetId of result.assetIds){const asset=deps.repos.assets.asset(binding.key,assetId);if(asset.sessionId!==binding.sessionId||asset.kind!=='audio')throw Error('SINGING_OUTPUT_INVALID');if(!live.assets.some(item=>item.assetId===assetId))live.assets.push({type:'asset',assetId});}
    deps.repos.singing.saveAttempt(binding.key,{request,state:'succeeded',assetIds:result.assetIds,format,...(deps.music?{music:deps.music}:{})} satisfies SingingAttempt);
    return JSON.stringify({status:'succeeded',registeredForDelivery:true,format,files:result.assetIds.map(id=>deps.repos.assets.asset(binding.key,id).name),delivery:{format,bytes:deps.repos.assets.asset(binding.key,result.assetIds[0]).size}});
  }catch(error){const safe=publicError(error),code=safe==='SINGING_SERVICE_STATE_UNKNOWN'?safe:signal.aborted?'SINGING_CANCELLED':safe;deps.repos.singing.saveAttempt(binding.key,{request,state:'failed',code,format,...(deps.music?{music:deps.music}:{})} satisfies SingingAttempt);throw Error(code);}
}
