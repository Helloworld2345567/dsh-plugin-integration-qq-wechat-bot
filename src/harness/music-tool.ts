import type {Assets,MediaService} from '../core/media.js';
import type {Store} from '../core/store.js';
import type {BotConfig,BotInstance,SessionBinding,TurnSnapshot,Output} from '../core/types.js';
import {allowedNow,mediaConfigNow} from '../core/policy.js';
import {assertMediaSession,musicCandidates,musicRequestKey,saveMusicCandidates,publicMusicCandidates,publicMusicTrack,MUSIC_DELIVERY_BYTES,type MusicAcquisition,type MusicCandidate} from '../core/music-state.js';

export interface MusicContext {binding:SessionBinding;snapshot:TurnSnapshot;assets:Output[]}
export interface MusicDependencies {store:Store;assets:Assets;media:MediaService;current:()=>BotConfig;bot:()=>BotInstance}
function safeError(error:unknown):string {const code=error instanceof Error?error.message:'';if(code==='SINGING_SESSION_CHANGED')return 'MUSIC_SESSION_CHANGED';return /^MUSIC_[A-Z_]+$/.test(code)?code:'MUSIC_OPERATION_FAILED';}
function query(args:Record<string,any>):{song:string;artist?:string}{
  if(typeof args.song!=='string'||!args.song.trim()||args.song.length>300||args.artist!==undefined&&(typeof args.artist!=='string'||args.artist.length>200))throw Error('MUSIC_QUERY_INVALID');
  return {song:args.song.trim(),...(args.artist?.trim()?{artist:args.artist.trim()}:{})};
}
export function musicAuthorization(live:MusicContext,signal:AbortSignal,deps:MusicDependencies):()=>void {
  const binding={...live.binding};return ()=>{signal.throwIfAborted();assertMediaSession(deps.store,binding);if(!allowedNow('bot_music',live.snapshot,deps.current(),deps.bot(),binding.scope))throw Error('MUSIC_DISABLED');};
}
function recordDownload(live:MusicContext,track:MusicCandidate,deps:MusicDependencies):void {
  const config=deps.store.config(live.snapshot.config.id);if(config.revision!==live.snapshot.config.revision)return;
  deps.store.saveCapabilityStatus(`${config.id}:${config.revision}:music`,{configId:config.id,revision:config.revision,role:'music',status:'PASS',source:'download',updatedAt:Date.now(),evidence:`完整下载并校验：${track.artist}《${track.title}》；音源 ${track.source}。`});
}
export async function acquireMusicSource(live:MusicContext,args:Record<string,any>,signal:AbortSignal,deps:MusicDependencies,extraAuthorize?:()=>void):Promise<MusicAcquisition>{
  const binding={...live.binding},authorizeMusic=musicAuthorization(live,signal,deps),authorize=()=>{authorizeMusic();extraAuthorize?.();};authorize();
  let parameters:Record<string,unknown>;
  if(args.candidateSet!==undefined||args.candidate!==undefined){
    if(args.song!==undefined||args.artist!==undefined)throw Error('MUSIC_QUERY_INVALID');
    const candidates=musicCandidates(deps.store,binding);
    if(!candidates||args.candidateSet!==candidates.id)throw Error('MUSIC_CANDIDATES_STALE');
    if(!Number.isInteger(args.candidate)||args.candidate<1||args.candidate>candidates.candidates.length)throw Error('MUSIC_CANDIDATE_INVALID');
    parameters={selection:candidates.candidates[args.candidate-1]};
  }else parameters=query(args);
  parameters={...parameters,includeLyrics:live.snapshot.config.media.music?.includeLyrics===true};
  const selectionKey=JSON.stringify(parameters),request=musicRequestKey(binding,live.snapshot,'acquire');
  const previous=deps.store.get<MusicAcquisition>('music-acquisition',binding.key);
  const selected=parameters.selection as MusicCandidate|undefined;
  const sameTrack=previous?.selectionKey===selectionKey||!!previous?.track&&(selected?selected.source===previous.track.source&&selected.id===previous.track.id:parameters.song===previous.track.title&&(!parameters.artist||parameters.artist===previous.track.artist));
  if(previous?.state==='succeeded'&&previous.sessionId===binding.sessionId&&previous.generation===binding.generation&&sameTrack){
    const source=await deps.assets.resolve(binding.key,previous.sourceAssetId!);authorize();if(source.sessionId!==binding.sessionId)throw Error('MUSIC_ATTACHMENT_INVALID');
    const retryDelivery=previous.request!==request&&previous.deliveryState!=='succeeded';
    const reused={...previous,request,selectionKey,...(retryDelivery?{deliveryState:undefined,deliveryCode:undefined,deliveryAssetIds:undefined}:{})};deps.store.put('music-acquisition',binding.key,reused);return reused;
  }
  if(previous?.request===request){
    if(previous.state==='running')throw Error('MUSIC_ALREADY_RUNNING');
    if(previous.state==='failed')throw Error(previous.code??'MUSIC_ALREADY_ATTEMPTED');
    throw Error('MUSIC_ALREADY_ACQUIRED');
  }
  const record:MusicAcquisition={scope:binding.key,sessionId:binding.sessionId,generation:binding.generation,request,selectionKey,state:'running'};
  deps.store.put('music-acquisition',binding.key,record);
  try{
    const result=await deps.media.run(binding.key,'music_acquire',mediaConfigNow(live.snapshot,deps.current()),[],parameters,signal,authorize,live.snapshot);authorize();
    const files=result.assetIds.map(id=>deps.store.asset(binding.key,id));
    const audio=files.filter(file=>file.kind==='audio'),lyrics=files.filter(file=>file.kind==='file');
    if(audio.length!==1||lyrics.length>1||files.length!==audio.length+lyrics.length||!result.music?.track)throw Error('MUSIC_OUTPUT_INVALID');
    if(files.some(file=>file.sessionId!==binding.sessionId))throw Error('MUSIC_ATTACHMENT_INVALID');
    const complete={...record,state:'succeeded' as const,sourceAssetId:audio[0].id,lyricAssetId:lyrics[0]?.id,track:result.music.track};
    deps.store.put('music-acquisition',binding.key,complete);recordDownload(live,complete.track,deps);return complete;
  }catch(error){const code=signal.aborted?'MUSIC_CANCELLED':safeError(error);deps.store.put('music-acquisition',binding.key,{...record,state:'failed',code});throw Error(code);}
}
export async function executeMusicTool(live:MusicContext,args:Record<string,any>,signal:AbortSignal,deps:MusicDependencies):Promise<string>{
  const authorize=musicAuthorization(live,signal,deps);authorize();
  if(args.action==='search'){
    const result=await deps.media.run(live.binding.key,'music_search',mediaConfigNow(live.snapshot,deps.current()),[],query(args),signal,authorize,live.snapshot);authorize();
    return JSON.stringify({...publicMusicCandidates(saveMusicCandidates(deps.store,live.binding,result.music?.candidates??[])),sources:result.music?.diagnostics??[]});
  }
  if(args.action!=='download')throw Error('MUSIC_ACTION_INVALID');
  // Lyrics are a frozen persona preference, never a model/tool override.
  const record=await acquireMusicSource(live,args,signal,deps),scope=live.binding.key;
  if(record.deliveryState==='running')throw Error('MUSIC_ALREADY_RUNNING');
  if(record.deliveryState==='failed')throw Error(record.deliveryCode??'MUSIC_ALREADY_ATTEMPTED');
  let ids=record.deliveryAssetIds,reused=!!ids;
  if(!ids){
    deps.store.put('music-acquisition',scope,{...record,deliveryState:'running'});
    try{
      const source=await deps.assets.resolve(scope,record.sourceAssetId!);authorize();
      if(record.track?.format?.replace(/^\./,'').toLowerCase()==='mp3'&&source.size<MUSIC_DELIVERY_BYTES)ids=[source.id];
      else {const result=await deps.media.run(scope,'music_delivery',mediaConfigNow(live.snapshot,deps.current()),[source.id],{},signal,authorize,live.snapshot);authorize();ids=result.assetIds;}
      if(ids.length!==1||deps.store.asset(scope,ids[0]).size>=MUSIC_DELIVERY_BYTES||deps.store.asset(scope,ids[0]).kind!=='audio')throw Error('MUSIC_OUTPUT_INVALID');
      deps.store.put('music-acquisition',scope,{...record,deliveryState:'succeeded',deliveryAssetIds:ids});
    }catch(error){const code=safeError(error);deps.store.put('music-acquisition',scope,{...record,deliveryState:'failed',deliveryCode:code});throw Error(code);}
  }
  authorize();const deliver=[...ids];if(live.snapshot.config.media.music?.includeLyrics===true&&record.lyricAssetId)deliver.push(record.lyricAssetId);
  for(const assetId of deliver){const asset=deps.store.asset(scope,assetId);if(asset.sessionId!==live.binding.sessionId)throw Error('MUSIC_ATTACHMENT_INVALID');if(!live.assets.some(item=>item.assetId===assetId))live.assets.push({type:'asset',assetId});}
  const audio=deps.store.asset(scope,ids[0]);
  return JSON.stringify({status:'succeeded',reused,registeredForDelivery:true,track:publicMusicTrack(record.track!),delivery:{format:'mp3',bytes:audio.size,transcoded:audio.id!==record.sourceAssetId},files:deliver.map(id=>deps.store.asset(scope,id).name)});
}
