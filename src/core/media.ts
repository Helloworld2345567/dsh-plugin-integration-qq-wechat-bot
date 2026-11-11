import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rm, stat, writeFile,rename,cp } from 'node:fs/promises';
import path from 'node:path';
import {resolveImageSkill} from './image-skill.js';
import {analysisEnabled,type AnalysisProvider,type AnalysisRole} from './analysis.js';
import {scopeKey} from './identity.js';
import type {RuntimeRepositories} from './ports/application.js';
import type { Asset, BotConfig, MediaInput, TurnSnapshot } from './types.js';
import {trusted} from './policy.js';
import {normalizeProviderUsage,type MediaUsageCall} from './usage.js';
import {validateMediaParameters,INPUT_LIMITS,VIDEO_LIMITS,AUDIO_LIMITS,isAudioInput} from './limits.js';
import {mediaOperationRegistry,MediaOperationRegistry,serviceOperationFor,type MediaOperation} from './media-operation-registry.js';
import {MEDIA_WORKER_PROTOCOL,MEDIA_WORKER_PROTOCOL_VERSION,validateMediaWorkerJob,type MediaWorkerJob,type WorkerPort} from './worker-port.js';
import {TransformSlots,transformSlots} from './transform-slots.js';
import {assetFolder,moveFile,exists,type AssetOrigin} from './media-paths.js';
import {type MusicData} from './music-state.js';
import type {ServiceRuntime} from './service-runtime.js';
import {ServiceContractError} from './service-errors.js';

export const MEDIA_OPERATIONS=mediaOperationRegistry.ids();
export type {MediaOperation} from './media-operation-registry.js';
export interface MediaFile {path:string;name:string;mime:string;kind:Asset['kind']}
export interface MediaResult { text?:string; coverage?:string; assets?:MediaFile[]; contextAssets?:MediaFile[]; observations?:unknown; incomplete?:boolean; music?:MusicData }
export class Assets {
  constructor(readonly deps:Pick<RuntimeRepositories,'sessions'|'deliveries'|'media'|'unitOfWork'|'storage'|'workspace'>,readonly root=path.join(deps.storage.home,'assets')){}
  workspace(scope:string):Promise<string>{return this.deps.workspace.scope(scope);}
  private currentSession(scope:string):string|undefined {const binding=this.deps.sessions.findBinding(scope);return binding?.key===scope&&typeof binding.sessionId==='string'&&this.deps.sessions.findSession(binding.sessionId)?.scopeKey===scope?binding.sessionId:undefined;}
  bindingCurrent(binding:Pick<import('./types.js').SessionBinding,'key'|'sessionId'|'generation'>):boolean {const current=this.deps.sessions.findBinding(binding.key);return current?.sessionId===binding.sessionId&&current.generation===binding.generation;}
  generated(scope:string,sessionId:string,jobId:string,kind?:Asset['kind']):Asset[]{return this.deps.media.assets.allAssets().filter(asset=>asset.jobId===jobId&&asset.scopeKey===scope&&asset.sessionId===sessionId&&(!kind||asset.kind===kind));}
  hasDelivery(scope:string,assetId:string):boolean{return this.deps.deliveries.findByAsset(scope,assetId).length>0;}
  async removeUnclaimed(scope:string,id:string):Promise<boolean>{
    const asset=this.deps.media.assets.asset(scope,id);
    if(this.hasDelivery(scope,id))return false;
    if(!asset.workspace)throw Error('ASSET_CLEANUP_WORKSPACE_REQUIRED');
    const folder=assetFolder(asset.workspace,asset),relative=path.relative(path.resolve(asset.workspace),path.resolve(folder));
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.resolve(asset.path)!==path.join(path.resolve(folder),asset.name))throw Error('ASSET_CLEANUP_PATH_INVALID');
    await rm(folder,{recursive:true,force:true});
    this.deps.media.assets.deleteAsset(scope,id);
    return true;
  }
  async save(scope:string,input:MediaInput,bytes:Buffer,jobId?:string,origin:AssetOrigin=jobId?'generated':'received',expectedSession?:string,expectedGeneration?:number,authorize?:()=>void):Promise<Asset>{
    // Capture ownership before any I/O: a concurrent /new must not reassign an older upload.
    const sessionId=this.currentSession(scope);
    if(expectedSession!==undefined&&(sessionId!==expectedSession||expectedGeneration!==undefined&&this.deps.sessions.findBinding(scope)?.generation!==expectedGeneration))throw Error('SINGING_SESSION_CHANGED');
    const maxBytes=input.kind==='video'
      ? VIDEO_LIMITS.attachmentBytes
      : isAudioInput(input)
        ? origin==='generated'?AUDIO_LIMITS.outputBytes:AUDIO_LIMITS.inputBytes
        : INPUT_LIMITS.attachmentBytes;
    if(bytes.length>maxBytes) throw new Error('MEDIA_TOO_LARGE');
    const id=randomUUID(); const name=path.basename(input.name.replaceAll('\\','/')).replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,180)||'attachment.bin';
    const workspace=await this.workspace(scope),createdAt=Date.now();
    const folder=assetFolder(workspace,{id,scopeKey:scope,kind:input.kind,createdAt,jobId,origin});await mkdir(folder,{recursive:true});const file=path.join(folder,name);await writeFile(file,bytes,{flag:'wx'});
    try{if(expectedSession!==undefined&&(this.currentSession(scope)!==expectedSession||expectedGeneration!==undefined&&this.deps.sessions.findBinding(scope)?.generation!==expectedGeneration))throw Error('SINGING_SESSION_CHANGED');authorize?.();}catch(error){await rm(folder,{recursive:true,force:true});throw error;}
    const asset:Asset={id,scopeKey:scope,name,mime:input.mime,path:file,size:bytes.length,kind:input.kind,createdAt,jobId,sessionId,workspace,origin};
    this.deps.media.assets.saveAsset(asset);return asset;
  }
  async read(scope:string,id:string):Promise<Buffer>{return readFile((await this.resolve(scope,id)).path);}
  async resolve(scope:string,id:string):Promise<Asset>{const asset=this.deps.media.assets.asset(scope,id);const resolved=await realpath(asset.path);const root=await realpath(asset.workspace?assetFolder(asset.workspace,asset):this.root);if(!resolved.startsWith(root+path.sep))throw new Error('ASSET_OUTSIDE_STORAGE');return {...asset,path:resolved};}
  async migrate(scope?:string):Promise<void>{
    for(const asset of this.deps.media.assets.allAssets().filter(asset=>!scope||asset.scopeKey===scope)){
      const workspace=await this.workspace(asset.scopeKey),origin=asset.origin??(asset.jobId?'generated':'received');
      const target=path.join(assetFolder(workspace,{...asset,origin}),path.basename(asset.path));
      if(path.resolve(asset.path)===path.resolve(target)&&asset.workspace)continue;
      const source=await exists(asset.path)?asset.path:path.join(this.root,asset.scopeKey,asset.id,path.basename(asset.path));
      if(await exists(source)){await moveFile(source,target);this.deps.media.assets.saveAsset({...asset,path:target,workspace,origin});}
    }
    for(const job of this.deps.media.jobs.jobs().filter(job=>!scope||job.scope===scope)){
      const legacy=path.join(this.deps.storage.home,'jobs',job.id);if(!await exists(legacy))continue;
      const workspace=await this.workspace(job.scope!),directory=path.join(workspace,'.bot','jobs',job.scope!,job.id);
      await mkdir(path.dirname(directory),{recursive:true});try{await rename(legacy,directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='EXDEV')throw error;await cp(legacy,directory,{recursive:true,errorOnExist:true,force:false});await rm(legacy,{recursive:true});}
      this.deps.media.jobs.patchJob(job.id,{directory,workspace});
    }
  }
  recent(scope:string,kind?:string):Asset[]{const sessionId=this.currentSession(scope);return sessionId?this.deps.media.assets.recentAssets(scope,sessionId,kind,24):[];}
}
export class MediaService {
  readonly active=new Map<string,{scope:string;controller:AbortController;localTransform?:boolean}>();
  readonly operations:MediaOperationRegistry;
  readonly worker:WorkerPort;
  constructor(readonly deps:Pick<RuntimeRepositories,'sessions'|'bots'|'media'|'stats'|'storage'>,readonly assets:Assets,readonly python=process.env.BOT_PYTHON||'python',readonly analysisProvider?:AnalysisProvider,worker?:WorkerPort,operations:MediaOperationRegistry=mediaOperationRegistry,readonly slots:TransformSlots=transformSlots,readonly serviceRuntime?:ServiceRuntime){this.worker=worker??{run:async()=>{throw new Error('MEDIA_WORKER_NOT_CONFIGURED');}};this.operations=operations;}
  async analysisStatus(config:BotConfig,role:AnalysisRole){try{if(!this.analysisProvider)throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');const value=await this.analysisProvider.resolve(config,role);const model=value.endpoint.protocol==='edge_tts'?value.endpoint.voice:value.endpoint.model;return{enabled:true,configured:true,provider:value.provider,model,keyConfigured:!!value.apiKey,protocol:value.endpoint.protocol};}catch(error){return{enabled:analysisEnabled(config,role),configured:false,error:error instanceof Error?error.message:'MEDIA_CONFIGURATION_INVALID',keyConfigured:false};}}
  cancelScope(scope:string):void{for(const item of this.active.values()) if(item.scope===scope)item.controller.abort(new Error('任务已取消'));}
  private dailyQuotaExempt(scope:string,snapshot?:TurnSnapshot):boolean {
    if(!snapshot?.trusted)return false;
    const binding=this.deps.sessions.findBinding(scope);
    if(!binding||binding.key!==scope||scopeKey(binding.scope)!==scope||binding.scope.botId!==snapshot.botId)return false;
    const bot=this.deps.bots.bot(binding.scope.botId);
    return bot.id===snapshot.botId&&trusted(bot,binding.scope);
  }
  async run(scope:string,operation:MediaOperation,config:BotConfig,inputs:string[],parameters:Record<string,unknown>,signal:AbortSignal,authorize?:()=>void,snapshot?:TurnSnapshot):Promise<{text?:string;coverage?:string;assetIds:string[];contextAssetIds?:string[];incomplete?:boolean;music?:MusicData}>{
    const descriptor=this.operations.get(operation);
    const serviceRole=operation==='voice_speak'?'voice':operation==='singing_convert'?'singing':operation.startsWith('music_')?'music':undefined;
    const useService=!!serviceRole&&operation!=='music_delivery'&&!(serviceRole==='voice'&&config.media.voice?.protocol==='edge_tts');
    if(useService&&(!this.serviceRuntime||!snapshot?.services[serviceRole!]?.snapshot))throw Error('PROFILE_ADAPTER_REQUIRED');
    const sessionBound=operation==='singing_convert'||operation.startsWith('music_');
    const expectedBinding=sessionBound?this.deps.sessions.findBinding(scope):undefined;
    if(useService&&operation==='music_acquire')parameters={...parameters,includeLyrics:snapshot!.config.media.music?.includeLyrics===true};
    const singingSession=expectedBinding?.sessionId;
    const assertSession=()=>{if(!sessionBound)return;const current=this.deps.sessions.findBinding(scope);if(!expectedBinding||current?.sessionId!==expectedBinding.sessionId||current.generation!==expectedBinding.generation)throw Error(operation==='singing_convert'?'SINGING_SESSION_CHANGED':'MUSIC_SESSION_CHANGED');};
    assertSession();
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
    const persist=(value:Record<string,unknown>)=>this.deps.media.jobs.patchJob(id,value);
    let lease:Awaited<ReturnType<TransformSlots['acquire']>>|undefined;
    const captureUsage=async()=>{try{const raw=JSON.parse(await readFile(path.join(directory,'model-usage.json'),'utf8'));if(!Array.isArray(raw))return;const modelCalls:MediaUsageCall[]=raw.filter(c=>c?.attempted===true&&typeof c.id==='string'&&Number.isSafeInteger(c.at)).map(c=>({id:c.id,attempted:true,at:c.at,provider,model:typeof c.model==='string'?c.model:requestedModel,usage:normalizeProviderUsage(c.usage)}));persist({modelCalls});const binding=this.deps.sessions.findBinding(scope);if(binding)this.deps.stats.projection.upsertMediaCalls(id,binding.scope.botId,modelCalls);}catch{/* No dispatched model call is claimed without a journal entry. */}};
    persist({id,scope,operation,directory,workspace,state:descriptor.localTransform?'queued':'running',startedAt});
    try{
    combined.throwIfAborted();
    if(descriptor.localTransform){lease=await this.slots.acquire(operation==='convert_gif'?2:1,combined);combined.throwIfAborted();authorize?.();persist({state:'running'});}
    if(inputs.length>INPUT_LIMITS.attachmentCount)throw new Error('MEDIA_INPUT_LIMIT');
    const source=await Promise.all(inputs.map(id=>this.assets.resolve(scope,id)));
    if(sessionBound&&source.some(item=>!singingSession||item.sessionId!==singingSession))throw Error(operation==='singing_convert'?'SINGING_ATTACHMENT_INVALID':'MUSIC_ATTACHMENT_INVALID');
    if(descriptor.inputKinds?.length&&source.some(item=>!descriptor.inputKinds!.includes(item.kind)))throw new Error('MEDIA_INPUT_KIND_INVALID');
    await mkdir(directory,{recursive:true});
    const role=descriptor.role;
    if(role&&!useService&&!this.analysisProvider)throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');
    const connection=role&&!useService?await this.analysisProvider!.resolve(config,role):undefined;
    const endpoint=connection?.endpoint??((operation==='image_generate'||operation==='image_edit')?resolveImageSkill(config):undefined);
    const edgeEndpoint=connection?.endpoint.protocol==='edge_tts'?connection.endpoint:undefined;
    provider=connection?.provider??(endpoint&&typeof endpoint.baseUrl==='string'?new URL(endpoint.baseUrl).hostname:undefined);requestedModel=(edgeEndpoint?.voice??(endpoint&&'model' in endpoint&&typeof endpoint.model==='string'?endpoint.model:undefined));
    persist({provider,requestedModel});
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
      if(!descriptor.localTransform&&!job.dailyQuotaExempt)this.deps.media.quota.consume(`${new Date().toISOString().slice(0,10)}:${scope}:${operation}`,descriptor.quotaUnits);
      // Registered fixture/native handlers stay in the same operation registry;
      // worker-backed operations cross the versioned process boundary.
      let result:MediaResult;
      if(useService){
        const frozen=snapshot!.services[serviceRole!]!.snapshot!,serviceOperation=serviceOperationFor(operation,frozen.serviceId);if(!serviceOperation)throw Error('SERVICE_OPERATION_MAPPING_MISSING');
        const selectedParameters:Record<string,unknown>=operation==='voice_speak'?Object.fromEntries(['text','style','speed','format'].filter(key=>parameters[key]!==undefined).map(key=>[key,parameters[key]])):operation==='singing_convert'?Object.fromEntries(['sourceType','format'].filter(key=>parameters[key]!==undefined).map(key=>[key,parameters[key]])):operation==='music_search'?Object.fromEntries(['song','artist'].filter(key=>parameters[key]!==undefined).map(key=>[key,parameters[key]])):operation==='music_acquire'?Object.fromEntries(['song','artist','selection','includeLyrics'].filter(key=>parameters[key]!==undefined).map(key=>[key,parameters[key]])):{};
        const serviceResult=await this.serviceRuntime!.execute({operation:serviceOperation,profile:{serviceId:frozen.serviceId,profileId:frozen.profileId},profileRevision:frozen.profileRevision,profileContentHash:frozen.profileContentHash,inputHandles:source.map(item=>item.id),resolvedInputs:source.map(item=>({handle:item.id,kind:item.kind,path:item.path,name:item.name,mime:item.mime})),parameters:selectedParameters,outputDirectory:directory,idempotencyKey:createHash('sha256').update(JSON.stringify([scope,snapshot!.personaId,snapshot!.personaRevision,snapshot!.sourceIds,serviceOperation,selectedParameters,source.map(item=>item.id)])).digest('hex'),deadline:descriptor.timeoutMs>0?Date.now()+descriptor.timeoutMs:Date.now()+15*60*1000,scopeKey:scope,signal:combined,authorize});
        result={text:serviceResult.text,assets:serviceResult.outputs.map(output=>({path:output.path,name:path.basename(output.relativePath),mime:output.mime,kind:output.kind})),observations:serviceResult.observations};
        const music=(serviceResult.observations as any)?.music;if(music)result.music=music;
      }else result=descriptor.execute
        ? await this.operations.dispatch<MediaResult>(operation,job,combined)
        : await this.worker.run(job,combined,credentials);
      combined.throwIfAborted();
      authorize?.();
      const save=async(files:MediaFile[])=>{const ids:string[]=[];for(const file of files){const resolved=await realpath(file.path);const root=await realpath(directory);if(!resolved.startsWith(root+path.sep))throw new Error('WORKER_OUTPUT_OUTSIDE_JOB');const size=(await stat(resolved)).size;const maxBytes=file.kind==='video'?VIDEO_LIMITS.attachmentBytes:file.kind==='audio'?AUDIO_LIMITS.outputBytes:20*1024*1024;if(size>maxBytes||operation==='convert_gif'&&size>=10_000_000)throw new Error('OUTPUT_TOO_LARGE');const bytes=await readFile(resolved);combined.throwIfAborted();authorize?.();assertSession();const asset=await this.assets.save(scope,{name:file.name,mime:file.mime,kind:file.kind},bytes,id,'generated',sessionBound?singingSession:undefined,expectedBinding?.generation,sessionBound?()=>{combined.throwIfAborted();authorize?.();assertSession();}:undefined);assertSession();ids.push(asset.id);}return ids;};
      const assetIds=await save(result.assets??[]);const contextAssetIds=await save(result.contextAssets??[]);
      persist({state:'complete',assetIds,contextAssetIds,finishedAt:Date.now()});
      assertSession();return {text:result.text,coverage:result.coverage,incomplete:result.incomplete,assetIds,contextAssetIds,...(result.music?{music:result.music}:{})};
    }catch(error){const serviceError=error instanceof ServiceContractError?error.serviceError:undefined;persist({state:serviceError?.category==='UNKNOWN_STATE'||error instanceof Error&&error.message==='SINGING_SERVICE_STATE_UNKNOWN'?'unknown':combined.aborted||serviceError?.category==='CANCELLED'?'cancelled':'failed',finishedAt:Date.now(),error:serviceError?.category??(error instanceof Error?error.message:'MEDIA_FAILED')});throw error;}finally{
      try{if(!descriptor.localTransform)await captureUsage();try{await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch(error){persist({cleanupError:error instanceof Error?error.message:'JOB_CLEANUP_FAILED'});}}
      finally{this.active.delete(id);lease?.release();}
    }
  }
}
