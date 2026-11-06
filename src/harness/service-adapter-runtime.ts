import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {runJsonProcess,jobEnvironment} from './json-process.js';
import {NodeControlledProcessPort} from './controlled-process.js';
import {ProcessWorker} from './process-worker.js';
import {MusicServiceAdapter,type MusicFacadePort,type MusicFacadeRequest,type MusicProfileConfig} from '../core/music-adapter.js';
import {MUSIC_PROTOCOL} from '../core/music-state.js';
import {GptSovitsServiceAdapter} from '../core/gpt-sovits-adapter.js';
import {BreezeTtsServiceAdapter} from '../core/breeze-tts-adapter.js';
import {RvcCliServiceAdapter} from '../core/rvc-cli-adapter.js';
import {RvcHttpCompatibilityAdapter} from '../core/rvc-http-adapter.js';
import {RvcServiceAdapter} from '../core/rvc-adapter.js';
import {VoiceModelLibrary,type VoiceModelScanner,type VoiceScannerContext} from '../core/voice-model-library.js';
import type {ProfileStore} from '../core/profile-store.js';
import type {VoiceLibrarySettingsRepository} from '../core/ports/media.js';
import {BUILTIN_SERVICE_MANIFESTS} from '../core/builtin-service-adapters.js';

export class ProcessMusicFacade implements MusicFacadePort {
  async exchange(config:MusicProfileConfig,request:MusicFacadeRequest,signal:AbortSignal):Promise<any>{
    const timeoutMs=Math.max(1,request.deadline-Date.now());
    const python=path.join(config.home,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
    const entry=path.join(config.home,'scripts','music_api.py');
    const response=await runJsonProcess(python,['-B','-u',entry],{
      protocol:MUSIC_PROTOCOL,version:1,action:request.action,song:request.song,artist:request.artist,
      selection:request.selection,purpose:'source',includeLyrics:request.includeLyrics??false,
      output:request.outputDirectory,deadline:request.deadline,sources:request.sources,
    },{cwd:request.outputDirectory,signal,timeoutMs,env:jobEnvironment(request.outputDirectory)});
    if(response.protocol!==MUSIC_PROTOCOL||response.version!==1)throw Error('MUSIC_PROTOCOL_UNSUPPORTED');
    if(response.ok!==true)throw Error(/^MUSIC_[A-Z_]+$/.test(response.error?.code??'')?response.error.code:'MUSIC_OPERATION_FAILED');
    return response.result;
  }
}

export class ProcessVoiceModelScanner implements VoiceModelScanner {
  async scan(context:VoiceScannerContext):Promise<unknown>{
    const output=path.dirname(context.cache);await mkdir(output,{recursive:true});
    return runJsonProcess(context.python,['-B',context.script,'scan','--root',context.modelsRoot,'--import','--cache',context.cache],{},
      {cwd:context.projectRoot,signal:context.signal,timeoutMs:120_000,maxOutputBytes:4*1024*1024,env:jobEnvironment(output)});
  }
  async device(context:VoiceScannerContext):Promise<'cpu'|'cuda'>{
    const output=path.dirname(context.cache);await mkdir(output,{recursive:true});
    const value=await runJsonProcess(context.python,['-B','-c','import json,torch; print(json.dumps({"cuda": torch.cuda.is_available()}))'],{},
      {cwd:context.projectRoot,signal:context.signal,timeoutMs:30_000,env:jobEnvironment(output)});
    return value?.cuda===true?'cuda':'cpu';
  }
}

export function createBuiltinServiceAdapters(python?:string){
  const worker=new ProcessWorker(python),processes=new NodeControlledProcessPort();
  return Object.freeze([
    {manifest:BUILTIN_SERVICE_MANIFESTS.music,createAdapter:()=>new MusicServiceAdapter(new ProcessMusicFacade())},
    {manifest:BUILTIN_SERVICE_MANIFESTS.voice,createAdapter:()=>new GptSovitsServiceAdapter(worker)},
    {manifest:BUILTIN_SERVICE_MANIFESTS.breeze,createAdapter:()=>new BreezeTtsServiceAdapter()},
    {manifest:BUILTIN_SERVICE_MANIFESTS.rvc,createAdapter:()=>new RvcServiceAdapter(new RvcCliServiceAdapter(processes),new RvcHttpCompatibilityAdapter(worker))},
  ]);
}

export function createVoiceModelLibrary(settings:VoiceLibrarySettingsRepository,home:string,profiles:ProfileStore):VoiceModelLibrary{
  return new VoiceModelLibrary(settings,home,profiles,new ProcessVoiceModelScanner());
}
