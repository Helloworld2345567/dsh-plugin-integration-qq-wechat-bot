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
interface Dependencies {repos:SingingToolRepositories & MusicToolRepositories;assets:Assets;media:MediaService;current:()=>BotConfig;bot:()=>BotInstance}
function text(value:unknown,max=300):string|undefined {return typeof value==='string'&&value.trim()&&value.length<=max?value.trim():undefined;}
function url(value:unknown):string {try{const parsed=new URL(String(value));if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port&&parsed.port!=='443')throw Error();return parsed.toString();}catch{throw Error('SINGING_SOURCE_INVALID');}}
function publicError(error:unknown):string {const code=error instanceof ServiceContractError?error.serviceError.providerCode??'':error instanceof Error?error.message:'';return /^SINGING_[A-Z_]+$/.test(code)?code:'SINGING_CONVERSION_FAILED';}

export async function executeSingingTool(live:SingingContext,args:Record<string,any>,signal:AbortSignal,deps:Dependencies):Promise<string>{
  const {assets}=deps,binding=live.binding;
  const authorize=()=>{signal.throwIfAborted();assertSingingSession(deps.repos.bindings,binding);if(!allowedNow('bot_sing',live.snapshot,deps.current(),deps.bot(),binding.scope))throw Error('SINGING_DISABLED');};
  authorize();
  const action=args.action??'list';
  if(action==='list')return JSON.stringify(publicSingingCandidates(singingCandidates({bindings:deps.repos.bindings,singing:deps.repos.singing},binding)));
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
  if(action!=='sing'&&action!=='convert')throw Error('SINGING_ACTION_INVALID');
  const turn=live.singing;
  turn.attempted=true;
  const authorizeMusic=musicAuthorization(live,signal,deps);
  if(action==='sing'||(args.append!==true&&turn.registered?.track))authorizeMusic();
  if(args.append!==true){
    if(turn.registered){
      return JSON.stringify({status:'already_registered',registeredForDelivery:true,...turn.registered});
    }
    if(turn.active)return JSON.stringify({status:'in_progress'});
  }
  // Reserve before acquiring a source. Parent and child tools share this turn.
  turn.active=(turn.active??0)+1;
  try{
    const result=await convertSong(live,args,signal,deps,()=>{
      authorize();
      if(action==='sing')authorizeMusic();
    });
    turn.registered??=result;
    return JSON.stringify({status:'succeeded',registeredForDelivery:true,...result});
  }finally{turn.active--;}
}

async function convertSong(live:SingingContext,args:Record<string,any>,signal:AbortSignal,deps:Dependencies,authorize:()=>void):Promise<NonNullable<SingingTurn['registered']>>{
  const binding=live.binding,config=mediaConfigNow(live.snapshot,deps.current());
  const service=live.snapshot.services.singing;
  if(!service?.snapshot||!['ready','partial'].includes(service.state))throw Error('SINGING_CONFIGURATION_INVALID');
  const selected=args.candidate??args.number;
  const named=args.action==='sing';
  let candidate:SingingCandidate,music:SingingAttempt['music'];
  if(named){
    const query=args.candidateSet!==undefined||selected!==undefined?{candidateSet:args.candidateSet,candidate:selected}:{song:args.song,artist:args.artist};
    const acquired=await acquireMusicSource(live,query,signal,deps,authorize);
    candidate={number:1,title:acquired.track!.title,assetId:acquired.sourceAssetId};
    music={selectionKey:JSON.stringify([args.song,args.artist,args.candidateSet,selected]),track:acquired.track!};
  }else{
    const candidates=singingCandidates({bindings:deps.repos.bindings,singing:deps.repos.singing},binding);
    if(!candidates||args.candidateSet!==candidates.id)throw Error('SINGING_CANDIDATES_STALE');
    const chosen=candidates.candidates.find(item=>item.number===selected);
    if(!chosen)throw Error('SINGING_CANDIDATE_INVALID: Use candidate from candidates[].candidate; it must be a positive integer within the returned candidate list.');
    candidate=chosen;
  }
  const sourceType=named?'mixed':args.sourceType,format=named?'mp3':args.format??config.media.singing?.defaultOutput??'mp3';
  const candidateUrl=candidate.url?url(candidate.url):undefined;
  if(sourceType!=='vocals'&&sourceType!=='mixed')throw Error('SINGING_SOURCE_TYPE_REQUIRED');
  if(!['wav','mp3'].includes(format))throw Error('SINGING_FORMAT_INVALID');
  const authorizeSource=()=>{authorize();if(candidateUrl&&!allowedNow('web_fetch',live.snapshot,deps.current(),deps.bot(),binding.scope))throw Error('SINGING_NETWORK_DISABLED');if(candidate.assetId&&deps.repos.assets.asset(binding.key,candidate.assetId).sessionId!==binding.sessionId)throw Error('SINGING_ATTACHMENT_INVALID');};
  authorizeSource();
  const attempt={request:randomUUID(),format,...(music?{music}:{})};
  deps.repos.singing.saveAttempt(binding.key,{...attempt,state:'running'});
  try{
    const result=await deps.media.run(binding.key,'singing_convert',config,candidate.assetId?[candidate.assetId]:[],{sourceType,format,...(candidateUrl?{url:candidateUrl}:{})},signal,authorizeSource,live.snapshot);
    authorizeSource();
    if(result.assetIds.length!==1)throw Error('SINGING_OUTPUT_INVALID');
    const asset=deps.repos.assets.asset(binding.key,result.assetIds[0]);
    if(asset.sessionId!==binding.sessionId||asset.kind!=='audio')throw Error('SINGING_OUTPUT_INVALID');
    deps.repos.singing.saveAttempt(binding.key,{...attempt,state:'succeeded',assetIds:result.assetIds});
    if(!live.assets.some(item=>item.assetId===asset.id))live.assets.push({type:'asset',assetId:asset.id});
    return {title:candidate.title,...(music?{track:publicMusicTrack(music.track)}:{}),format,files:[asset.name],delivery:{stage:'converted_audio',format,bytes:asset.size}};
  }catch(error){const safe=publicError(error),code=safe==='SINGING_SERVICE_STATE_UNKNOWN'?safe:signal.aborted?'SINGING_CANCELLED':safe;deps.repos.singing.saveAttempt(binding.key,{...attempt,state:'failed',code});throw Error(code);}
}
