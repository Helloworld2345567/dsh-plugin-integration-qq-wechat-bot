import {randomUUID} from 'node:crypto';
import type {SessionBinding,TurnSnapshot} from './types.js';
import type {BindingRepository} from './ports/session.js';
import type {MusicCandidate, MusicCandidates, MusicAcquisition, MusicStateRepository} from './ports/media.js';

export const MUSIC_PROTOCOL='musicdl_json_v1';
export const MUSIC_DELIVERY_BYTES=20_000_000;
export const MUSIC_SOURCES=['MiguMusicClient','KuwoMusicClient','QQMusicClient','NeteaseMusicClient'] as const;
export interface MusicData {candidates?:MusicCandidate[];track?:MusicCandidate;diagnostics?:Array<{source:string;status:string}>}
export type {MusicCandidate,MusicCandidates,MusicAcquisition};

export interface MusicSessionPorts {
  bindings: BindingRepository;
  music: MusicStateRepository;
}

export function assertMediaSession(bindings:BindingRepository,binding:SessionBinding,code='MUSIC_SESSION_CHANGED'):void {
  const current=bindings.findBinding(binding.key);
  if(!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation)throw Error(code);
}
export function clearMusicState(music:MusicStateRepository,scope:string):void {music.clear(scope);}
export function saveMusicCandidates(ports:MusicSessionPorts,binding:SessionBinding,candidates:MusicCandidate[]):MusicCandidates {
  assertMediaSession(ports.bindings,binding);
  const value:MusicCandidates={id:randomUUID(),scope:binding.key,sessionId:binding.sessionId,generation:binding.generation,candidates,createdAt:Date.now()};
  ports.music.saveCandidates(binding.key,value);return value;
}
export function musicCandidates(ports:MusicSessionPorts,binding:SessionBinding):MusicCandidates|undefined {
  assertMediaSession(ports.bindings,binding);const value=ports.music.candidates(binding.key);
  return value?.sessionId===binding.sessionId&&value.generation===binding.generation?value:undefined;
}
export function publicMusicTrack(value:MusicCandidate){const {locator:_,id:__,...safe}=value;return safe;}
export function publicMusicCandidates(value:MusicCandidates){return {status:'prepared',candidateSet:value.id,candidates:value.candidates.map((item,index)=>({number:index+1,...publicMusicTrack(item)}))};}
export function musicRequestKey(binding:SessionBinding,snapshot:TurnSnapshot,selection:unknown):string {return JSON.stringify([binding.sessionId,binding.generation,snapshot.sourceIds,snapshot.sourceIds.length?undefined:snapshot.startedAt,selection]);}
