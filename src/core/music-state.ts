import {randomUUID} from 'node:crypto';
import type {Store} from './store.js';
import type {SessionBinding,TurnSnapshot} from './types.js';

export const MUSIC_PROTOCOL='musicdl_json_v1';
export const MUSIC_DELIVERY_BYTES=20_000_000;
export const MUSIC_SOURCES=['MiguMusicClient','KuwoMusicClient','QQMusicClient','NeteaseMusicClient'] as const;
export interface MusicCandidate {source:string;id:string;title:string;artist:string;album?:string;duration?:number;format?:string;size?:number;version?:string;locator?:unknown}
export interface MusicData {candidates?:MusicCandidate[];track?:MusicCandidate;diagnostics?:Array<{source:string;status:string}>}
export interface MusicHealth {configured:boolean;ready:boolean;protocol:typeof MUSIC_PROTOCOL;sources:Array<{id:string;available:boolean}>;error?:string}
export interface MusicCandidates {id:string;scope:string;sessionId:string;generation:number;candidates:MusicCandidate[];createdAt:number}
export interface MusicAcquisition {scope:string;sessionId:string;generation:number;request:string;selectionKey:string;state:'running'|'succeeded'|'failed';sourceAssetId?:string;lyricAssetId?:string;track?:MusicCandidate;deliveryState?:'running'|'succeeded'|'failed';deliveryAssetIds?:string[];deliveryCode?:string;code?:string}

export function assertMediaSession(store:Store,binding:SessionBinding,code='MUSIC_SESSION_CHANGED'):void {
  const current=store.findBinding(binding.key);
  if(!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation)throw Error(code);
}
export function clearMusicState(store:Store,scope:string):void {for(const kind of ['music-candidates','music-acquisition'])store.put(kind,scope,null);}
export function saveMusicCandidates(store:Store,binding:SessionBinding,candidates:MusicCandidate[]):MusicCandidates {
  assertMediaSession(store,binding);
  const value={id:randomUUID(),scope:binding.key,sessionId:binding.sessionId,generation:binding.generation,candidates,createdAt:Date.now()};
  store.put('music-candidates',binding.key,value);return value;
}
export function musicCandidates(store:Store,binding:SessionBinding):MusicCandidates|undefined {
  assertMediaSession(store,binding);const value=store.get<MusicCandidates>('music-candidates',binding.key);
  return value?.sessionId===binding.sessionId&&value.generation===binding.generation?value:undefined;
}
export function publicMusicTrack(value:MusicCandidate){const {locator:_,id:__,...safe}=value;return safe;}
export function publicMusicCandidates(value:MusicCandidates){return {status:'prepared',candidateSet:value.id,candidates:value.candidates.map((item,index)=>({number:index+1,...publicMusicTrack(item)}))};}
export function musicRequestKey(binding:SessionBinding,snapshot:TurnSnapshot,selection:unknown):string {return JSON.stringify([binding.sessionId,binding.generation,snapshot.sourceIds,snapshot.sourceIds.length?undefined:snapshot.startedAt,selection]);}
