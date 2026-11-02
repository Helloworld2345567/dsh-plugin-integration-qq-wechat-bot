import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile,rename,cp } from 'node:fs/promises';
import path from 'node:path';
import {resolveImageSkill} from './image-skill.js';
import {analysisEnabled,type AnalysisProvider,type AnalysisRole} from './analysis.js';
import {scopeKey,type Store} from './store.js';
import type { Asset, BotConfig, MediaInput, TurnSnapshot } from './types.js';
import {trusted} from './policy.js';
import {normalizeProviderUsage,type MediaUsageCall} from './usage.js';
import {validateMediaParameters,INPUT_LIMITS,VIDEO_LIMITS,AUDIO_LIMITS,isAudioInput} from './limits.js';
import {mediaOperationRegistry,MediaOperationRegistry, type MediaOperation} from './media-operation-registry.js';
import {MEDIA_WORKER_PROTOCOL,MEDIA_WORKER_PROTOCOL_VERSION,validateMediaWorkerJob,type MediaWorkerJob,type WorkerPort} from './worker-port.js';
import {TransformSlots,transformSlots} from './transform-slots.js';
import {voiceServiceQueue} from './voice-service-queue.js';
import {acquireSingingService,confirmSingingStopped,normalizeSingingServiceUrl,markSingingServiceStarted,markSingingServiceFinished} from './singing-service.js';
import {assetFolder,scopeWorkspace,moveFile,exists,type AssetOrigin} from './workspace-files.js';
import {MUSIC_PROTOCOL,type MusicData,type MusicHealth} from './music-state.js';

export const MEDIA_OPERATIONS=mediaOperationRegistry.ids();
export type {MediaOperation} from './media-operation-registry.js';
export interface MediaFile {path:string;name:string;mime:string;kind:Asset['kind']}
export interface MediaResult { text?:string; coverage?:string; assets?:MediaFile[]; contextAssets?:MediaFile[]; observations?:unknown; incomplete?:boolean; music?:MusicData }
export class Assets {
  constructor(readonly store:Store,readonly root=path.join(store.home,'assets')){}
  workspace(scope:string):Promise<string>{return scopeWorkspace(this.store,scope);}
  private currentSession(scope:string):string|undefined {const binding=this.store.findBinding(scope);return binding?.key===scope&&typeof binding.sessionId==='string'&&this.store.findSession(binding.sessionId)?.scopeKey===scope?binding.sessionId:undefined;}
  async save(scope:string,input:MediaInput,bytes:Buffer,jobId?:string,origin:AssetOrigin=jobId?'generated':'received',expectedSession?:string,expectedGeneration?:number,authorize?:()=>void,serviceSnapshot?:import('./service-contract.js').TurnServiceSnapshot):Promise<Asset>{
    // Capture ownership before any I/O: a concurrent /new must not reassign an older upload.
    const sessionId=this.currentSession(scope);
    if(expectedSession!==undefined&&(sessionId!==expectedSession||expectedGeneration!==undefined&&this.store.findBinding(scope)?.generation!==expectedGeneration))throw Error('SINGING_SESSION_CHANGED');
    const maxBytes=input.kind==='video'
      ? VIDEO_LIMITS.attachmentBytes
      : isAudioInput(input)
        ? origin==='generated'?AUDIO_LIMITS.outputBytes:AUDIO_LIMITS.inputBytes
        : INPUT_LIMITS.attachmentBytes;
    if(bytes.length>maxBytes) throw new Error('MEDIA_TOO_LARGE');
    const usage=this.store.assetUsage(scope);if(usage.scope+bytes.length>512*1024*1024||usage.total+bytes.length>2*1024*1024*1024)throw new Error('MEDIA_STORAGE_LIMIT');
    const id=randomUUID(); const name=path.basename(input.name.replaceAll('\\','/')).replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,180)||'attachment.bin';
    const workspace=await this.workspace(scope),createdAt=Date.now();
    const folder=assetFolder(workspace,{id,scopeKey:scope,kind:input.kind,createdAt,jobId,origin});await mkdir(folder,{recursive:true});const file=path.join(folder,name);await writeFile(file,bytes,{flag:'wx'});
    try{if(expectedSession!==undefined&&(this.currentSession(scope)!==expectedSession||expectedGeneration!==undefined&&this.store.findBinding(scope)?.generation!==expectedGeneration))throw Error('SINGING_SESSION_CHANGED');authorize?.();}catch(error){await rm(folder,{recursive:true,force:true});throw error;}
    const asset:Asset={id,scopeKey:scope,name,mime:input.mime,path:file,size:bytes.length,kind:input.kind,createdAt,jobId,sessionId,workspace,origin,...serviceSnapshot?{serviceSnapshot}:{}};
    this.store.saveAsset(asset);return asset;
  }
  async read(scope:string,id:string):Promise<Buffer>{return readFile((await this.resolve(scope,id)).path);}
  async resolve(scope:string,id:string):Promise<Asset>{const asset=this.store.asset(scope,id);const resolved=await realpath(asset.path);const root=await realpath(asset.workspace?assetFolder(asset.workspace,asset):this.root);if(!resolved.startsWith(root+path.sep))throw new Error('ASSET_OUTSIDE_STORAGE');return {...asset,path:resolved};}
  async migrate(scope?:string):Promise<void>{
    for(const asset of this.store.list<Asset>('asset').filter(asset=>!scope||asset.scopeKey===scope)){
      const workspace=await this.workspace(asset.scopeKey),origin=asset.origin??(asset.jobId?'generated':'received');
      const target=path.join(assetFolder(workspace,{...asset,origin}),path.basename(asset.path));
      if(path.resolve(asset.path)===path.resolve(target)&&asset.workspace)continue;
      const source=await exists(asset.path)?asset.path:path.join(this.root,asset.scopeKey,asset.id,path.basename(asset.path));
      if(await exists(source)){await moveFile(source,target);this.store.saveAsset({...asset,path:target,workspace,origin});}
    }
    for(const job of this.store.jobs().filter(job=>!scope||job.scope===scope)){
      const legacy=path.join(this.store.home,'jobs',job.id);if(!await exists(legacy))continue;
      const workspace=await this.workspace(job.scope),directory=path.join(workspace,'.bot','jobs',job.scope,job.id);
      await mkdir(path.dirname(directory),{recursive:true});try{await rename(legacy,directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='EXDEV')throw error;await cp(legacy,directory,{recursive:true,errorOnExist:true,force:false});await rm(legacy,{recursive:true});}
      this.store.patchJob(job.id,{directory,workspace});
    }
  }
  recent(scope:string,kind?:string):Asset[]{const sessionId=this.currentSession(scope);return sessionId?this.store.recentAssets(scope,sessionId,kind,24):[];}
}
export class MediaService {
  readonly active=new Map<string,{scope:string;controller:AbortController;localTransform?:boolean}>();
  readonly operations:MediaOperationRegistry;
  readonly worker:WorkerPort;
  constructor(readonly store:Store,readonly assets:Assets,readonly python=process.env.BOT_PYTHON||'python',readonly analysisProvider?:AnalysisProvider,worker?:WorkerPort,operations:MediaOperationRegistry=mediaOperationRegistry,readonly slots:TransformSlots=transformSlots){this.worker=worker??{run:async()=>{throw new Error('MEDIA_WORKER_NOT_CONFIGURED');}};this.operations=operations;}
  async analysisStatus(config:BotConfig,role:AnalysisRole){try{if(!this.analysisProvider)throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');const value=await this.analysisProvider.resolve(config,role);const model=value.endpoint.protocol==='gpt_sovits'?value.endpoint.modelVersion:value.endpoint.protocol==='edge_tts'?value.endpoint.voice:value.endpoint.model;return{enabled:true,configured:true,provider:value.provider,model,keyConfigured:!!value.apiKey,protocol:value.endpoint.protocol};}catch(error){return{enabled:analysisEnabled(config,role),configured:false,error:error instanceof Error?error.message:'MEDIA_CONFIGURATION_INVALID',keyConfigured:false};}}
  async musicHealth(signal:AbortSignal=new AbortController().signal):Promise<MusicHealth>{
    if(!this.worker.musicHealth)return {configured:false,ready:false,protocol:MUSIC_PROTOCOL,sources:[],error:'MUSIC_NOT_CONFIGURED'};
    const root=path.join(this.store.home,'.tmp');await mkdir(root,{recursive:true});const output=await mkdtemp(path.join(root,'music-probe-'));
    try{return await this.worker.musicHealth(signal,output);}finally{await rm(output,{recursive:true,force:true});}
  }
  cancelScope(scope:string):void{for(const item of this.active.values()) if(item.scope===scope)item.controller.abort(new Error('任务已取消'));}
  private dailyQuotaExempt(scope:string,snapshot?:TurnSnapshot):boolean {
    if(!snapshot?.trusted)return false;
    const binding=this.store.findBinding(scope);
    if(!binding||binding.key!==scope||scopeKey(binding.scope)!==scope||binding.scope.botId!==snapshot.botId)return false;
    const bot=this.store.bot(binding.scope.botId);
    return bot.id===snapshot.botId&&trusted(bot,binding.scope);
  }
  async run(scope:string,operation:MediaOperation,config:BotConfig,inputs:string[],parameters:Record<string,unknown>,signal:AbortSignal,authorize?:()=>void,snapshot?:TurnSnapshot):Promise<{text?:string;coverage?:string;assetIds:string[];contextAssetIds?:string[];incomplete?:boolean;music?:MusicData}>{
    const descriptor=this.operations.get(operation);
    const serviceRole=operation==='voice_speak'?'voice':operation==='singing_convert'?'singing':operation.startsWith('music_')?'music':undefined;
    if(config.schemaVersion===4&&serviceRole&&!(serviceRole==='voice'&&config.media.voice?.protocol==='edge_tts'))throw Error('PROFILE_ADAPTER_REQUIRED');
    const singing=operation==='singing_convert'?config.media.singing:undefined;
    const sessionBound=operation==='singing_convert'||operation.startsWith('music_');
    const expectedBinding=sessionBound?this.store.findBinding(scope):undefined;
    const singingSession=expectedBinding?.sessionId;
    const assertSession=()=>{if(!sessionBound)return;const current=this.store.findBinding(scope);if(!expectedBinding||current?.sessionId!==expectedBinding.sessionId||current.generation!==expectedBinding.generation)throw Error(operation==='singing_convert'?'SINGING_SESSION_CHANGED':'MUSIC_SESSION_CHANGED');};
    assertSession();
    if(operation==='singing_convert'){
      if(!singing?.enabled||!singing.serviceUrl||!singing.modelVersion||!singing.singingModelId||!singing.singingWeightsPath)throw Error('SINGING_CONFIGURATION_INVALID');
      if(inputs.length>1||inputs.length===0&&!parameters.url||inputs.length&&parameters.url)throw Error('SINGING_SOURCE_INVALID');
      if(parameters.sourceType==='mixed'&&singing.separation.status!=='configured')throw Error('SINGING_SEPARATION_UNCONFIGURED');
      if(parameters.sourceType!=='vocals'&&parameters.sourceType!=='mixed')throw Error('SINGING_SOURCE_TYPE_REQUIRED');
      if(parameters.format!==undefined&&!['wav','mp3'].includes(String(parameters.format)))throw Error('SINGING_FORMAT_INVALID');
      parameters={sourceType:parameters.sourceType,format:parameters.format??singing.defaultOutput,...(parameters.url?{url:parameters.url}:{})};
    }
    if(operation==='image_understand')throw new Error('IMAGE_READ_USE_NATIVE_CHAT_MODEL');
    if(descriptor.role==='tts'){
      const voice=config.media.voice;
      parameters={...parameters};
      if(parameters.voice===undefined&&voice?.voice!==undefined)parameters.voice=voice.voice;
      if(parameters.format===undefined)parameters.format=voice?.format??'mp3';
    }
    validateMediaParameters(operation,inputs,parameters);
    const other=[...this.active.values()].filter(a=>!a.localTransform);
    if(!descriptor.localTransform&&(other.length>=2||other.some(a=>a.scope===scope)))throw new Error('MEDIA_CONCURRENCY_LIMIT');
    const id=randomUUID();const controller=new AbortController(); const combined=AbortSignal.any([signal,controller.signal,...(descriptor.timeoutMs>0?[AbortSignal.timeout(descriptor.timeoutMs)]:[])]);
    this.active.set(id,{scope,controller,localTransform:descriptor.localTransform});
    const workspace=await this.assets.workspace(scope).catch(error=>{this.active.delete(id);throw error;}),directory=path.join(workspace,'.bot','jobs',scope,id),startedAt=Date.now();let provider:string|undefined;let requestedModel:string|undefined;
    const persist=(value:Record<string,unknown>)=>this.store.patchJob(id,value);
    let lease:Awaited<ReturnType<TransformSlots['acquire']>>|undefined;
    let releaseVoice:(()=>void)|undefined;
    let releaseSinging:(()=>void)|undefined, singingDispatched=false;
    const captureUsage=async()=>{try{const raw=JSON.parse(await readFile(path.join(directory,'model-usage.json'),'utf8'));if(!Array.isArray(raw))return;const modelCalls:MediaUsageCall[]=raw.filter(c=>c?.attempted===true&&typeof c.id==='string'&&Number.isSafeInteger(c.at)).map(c=>({id:c.id,attempted:true,at:c.at,provider,model:typeof c.model==='string'?c.model:requestedModel,usage:normalizeProviderUsage(c.usage)}));persist({modelCalls});const binding=this.store.findBinding(scope);if(binding)this.store.stats.upsertMediaCalls(id,binding.scope.botId,modelCalls);}catch{/* No dispatched model call is claimed without a journal entry. */}};
    const serviceSnapshot=operation==='voice_speak'?snapshot?.services.voice?.snapshot:operation==='singing_convert'?snapshot?.services.singing?.snapshot:operation.startsWith('music_')?snapshot?.services.music?.snapshot:undefined;
    persist({id,scope,operation,directory,workspace,state:descriptor.localTransform?'queued':'running',startedAt,...serviceSnapshot?{serviceId:serviceSnapshot.serviceId,profileId:serviceSnapshot.profileId,profileRevision:serviceSnapshot.profileRevision,profileContentHash:serviceSnapshot.profileContentHash}:{}});
    try{
    combined.throwIfAborted();
    if(descriptor.localTransform){lease=await this.slots.acquire(operation==='convert_gif'?2:1,combined);combined.throwIfAborted();authorize?.();persist({state:'running'});}
    if(inputs.length>INPUT_LIMITS.attachmentCount)throw new Error('MEDIA_INPUT_LIMIT');
    const source=await Promise.all(inputs.map(id=>this.assets.resolve(scope,id)));
    if(sessionBound&&source.some(item=>!singingSession||item.sessionId!==singingSession))throw Error(singing?'SINGING_ATTACHMENT_INVALID':'MUSIC_ATTACHMENT_INVALID');
    if(descriptor.inputKinds?.length&&source.some(item=>!descriptor.inputKinds!.includes(item.kind)))throw new Error('MEDIA_INPUT_KIND_INVALID');
    await mkdir(directory,{recursive:true});
    const role=descriptor.role;
    if(role&&!this.analysisProvider)throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');
    const connection=role?await this.analysisProvider!.resolve(config,role):undefined;
    const endpoint=singing?{...singing,baseUrl:normalizeSingingServiceUrl(singing.serviceUrl!),jobId:id}:connection?.endpoint??((operation==='image_generate'||operation==='image_edit')?resolveImageSkill(config):undefined);
    const gptEndpoint=connection?.endpoint.protocol==='gpt_sovits'?connection.endpoint:undefined;
    const edgeEndpoint=connection?.endpoint.protocol==='edge_tts'?connection.endpoint:undefined;
    provider=connection?.provider??(endpoint&&typeof endpoint.baseUrl==='string'?new URL(endpoint.baseUrl).hostname:undefined);requestedModel=singing?.singingModelId??gptEndpoint?.modelVersion??(edgeEndpoint?.voice??(endpoint&&'model' in endpoint&&typeof endpoint.model==='string'?endpoint.model:undefined));
    persist({provider,requestedModel});
    if(gptEndpoint){persist({state:'queued'});releaseVoice=await voiceServiceQueue.acquire(gptEndpoint.baseUrl,combined);combined.throwIfAborted();authorize?.();persist({state:'running'});}
    if(singing){persist({state:'queued'});releaseSinging=await acquireSingingService(this.store,singing.serviceUrl!,combined);combined.throwIfAborted();authorize?.();persist({state:'running',singingJobId:id});}
    const credentials:Record<string,string>={};
    if(endpoint&&'keyEnv' in endpoint&&typeof endpoint.keyEnv==='string'){const keyEnv=endpoint.keyEnv;const value=connection?.apiKey??process.env[keyEnv];if(!value)throw new Error(`MISSING_PROVIDER_KEY: ${keyEnv}`);credentials[keyEnv]=value;}
    if(descriptor.inputKinds?.includes('audio')&&source[0]){
      // Tencent can label SILK as AMR, including an optional AMR wrapper.
      // Inspect the codec header so genuine AMR and other audio stay with ffmpeg.
      const {decode,isSilk}=await import('silk-wasm');const file=await open(source[0].path,'r');const prefix=Buffer.alloc(16);
      const {bytesRead}=await file.read(prefix,0,prefix.length,0).finally(()=>file.close());
      const offset=prefix.subarray(0,6).toString('ascii')==='#!AMR\n'?6:0;
      if(isSilk(prefix.subarray(offset,bytesRead))){
        const decoded=await decode((await this.assets.read(scope,source[0].id)).subarray(offset),24000);
        const pcm=Buffer.from(decoded.data);if(pcm.length>30*1024*1024)throw new Error('AUDIO_TOO_LONG');
        const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
        const wav=path.join(directory,'decoded.wav');await writeFile(wav,Buffer.concat([header,pcm]));source[0]={...source[0],path:wav,name:'decoded.wav',mime:'audio/wav'};
      }
    }
      const job:MediaWorkerJob={protocol:MEDIA_WORKER_PROTOCOL,protocolVersion:MEDIA_WORKER_PROTOCOL_VERSION,id,scope,operation,handler:descriptor.handler,inputs:source.map(a=>({path:a.path,name:a.name,mime:a.mime,kind:a.kind})),parameters,endpoint:endpoint as unknown as Record<string,unknown>|undefined,output:directory,usagePath:path.join(directory,'model-usage.json'),deadline:descriptor.timeoutMs>0?Date.now()+descriptor.timeoutMs:0,timeoutMs:descriptor.timeoutMs,quotaUnits:descriptor.quotaUnits,processingSlots:lease?.slots};
      validateMediaWorkerJob(job);
      combined.throwIfAborted();
      authorize?.();
      job.dailyQuotaExempt=this.dailyQuotaExempt(scope,snapshot);
      if(!descriptor.localTransform&&!job.dailyQuotaExempt)this.store.consumeMediaQuota(`${new Date().toISOString().slice(0,10)}:${scope}:${operation}`,descriptor.quotaUnits);
      // Registered fixture/native handlers stay in the same operation registry;
      // worker-backed operations cross the versioned process boundary.
      singingDispatched=!!singing;
      if(singing)markSingingServiceStarted(this.store,singing.serviceUrl!,id);
      const result=descriptor.execute
        ? await this.operations.dispatch<MediaResult>(operation,job,combined)
        : await this.worker.run(job,combined,credentials);
      combined.throwIfAborted();
      authorize?.();
      if(singing&&((result.assets?.length??0)!==1||result.assets![0].kind!=='audio'||result.contextAssets?.length))throw Error('SINGING_OUTPUT_INVALID');
      const save=async(files:MediaFile[])=>{const ids:string[]=[];for(const file of files){const resolved=await realpath(file.path);const root=await realpath(directory);if(!resolved.startsWith(root+path.sep))throw new Error('WORKER_OUTPUT_OUTSIDE_JOB');const size=(await stat(resolved)).size;const maxBytes=file.kind==='video'?VIDEO_LIMITS.attachmentBytes:file.kind==='audio'?AUDIO_LIMITS.outputBytes:20*1024*1024;if(size>maxBytes||operation==='convert_gif'&&size>=10_000_000)throw new Error('OUTPUT_TOO_LARGE');const bytes=await readFile(resolved);combined.throwIfAborted();authorize?.();assertSession();const asset=await this.assets.save(scope,{name:file.name,mime:file.mime,kind:file.kind},bytes,id,'generated',sessionBound?singingSession:undefined,expectedBinding?.generation,sessionBound?()=>{combined.throwIfAborted();authorize?.();assertSession();}:undefined,serviceSnapshot);assertSession();ids.push(asset.id);}return ids;};
      const assetIds=await save(result.assets??[]);const contextAssetIds=await save(result.contextAssets??[]);
      persist({state:'complete',assetIds,contextAssetIds,finishedAt:Date.now()});
      if(singing)markSingingServiceFinished(this.store,singing.serviceUrl!);
      assertSession();return {text:result.text,coverage:result.coverage,incomplete:result.incomplete,assetIds,contextAssetIds,...(result.music?{music:result.music}:{})};
    }catch(error){if(singing&&singingDispatched)try{await confirmSingingStopped(this.store,singing.serviceUrl!,id);}catch(unknown){error=unknown;}persist({state:error instanceof Error&&error.message==='SINGING_SERVICE_STATE_UNKNOWN'?'unknown':combined.aborted?'cancelled':'failed',finishedAt:Date.now(),error:error instanceof Error?error.message:'MEDIA_FAILED'});throw error;}finally{
      try{if(!descriptor.localTransform)await captureUsage();try{await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch(error){persist({cleanupError:error instanceof Error?error.message:'JOB_CLEANUP_FAILED'});}}
      finally{this.active.delete(id);lease?.release();releaseVoice?.();releaseSinging?.();}
    }
  }
}
