import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {resolveImageSkill} from './image-skill.js';
import {analysisEnabled,type AnalysisProvider,type AnalysisRole} from './analysis.js';
import {scopeKey,type Store} from './store.js';
import type { Asset, BotConfig, MediaInput, TurnSnapshot } from './types.js';
import {trusted} from './policy.js';
import {normalizeProviderUsage,type MediaUsageCall} from './usage.js';
import {validateMediaParameters,INPUT_LIMITS,VIDEO_LIMITS} from './limits.js';
import {mediaOperationRegistry,MediaOperationRegistry, type MediaOperation} from './media-operation-registry.js';
import {MEDIA_WORKER_PROTOCOL,MEDIA_WORKER_PROTOCOL_VERSION,validateMediaWorkerJob,type MediaWorkerJob,type WorkerPort} from './worker-port.js';
import {TransformSlots,transformSlots} from './transform-slots.js';
import {voiceServiceQueue} from './voice-service-queue.js';

export const MEDIA_OPERATIONS=mediaOperationRegistry.ids();
export type {MediaOperation} from './media-operation-registry.js';
export interface MediaFile {path:string;name:string;mime:string;kind:Asset['kind']}
export interface MediaResult { text?:string; coverage?:string; assets?:MediaFile[]; contextAssets?:MediaFile[]; observations?:unknown; incomplete?:boolean }
export class Assets {
  constructor(readonly store:Store,readonly root=path.join(store.home,'assets')){}
  private currentSession(scope:string):string|undefined {const binding=this.store.findBinding(scope);return binding?.key===scope&&typeof binding.sessionId==='string'&&this.store.findSession(binding.sessionId)?.scopeKey===scope?binding.sessionId:undefined;}
  async save(scope:string,input:MediaInput,bytes:Buffer,jobId?:string):Promise<Asset>{
    // Capture ownership before any I/O: a concurrent /new must not reassign an older upload.
    const sessionId=this.currentSession(scope);
    if(bytes.length>(input.kind==='video'?VIDEO_LIMITS.attachmentBytes:INPUT_LIMITS.attachmentBytes)) throw new Error('MEDIA_TOO_LARGE');
    const usage=this.store.assetUsage(scope);if(usage.scope+bytes.length>512*1024*1024||usage.total+bytes.length>2*1024*1024*1024)throw new Error('MEDIA_STORAGE_LIMIT');
    const id=randomUUID(); const name=path.basename(input.name.replaceAll('\\','/')).replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,180)||'attachment.bin';
    const folder=path.join(this.root,scope,id); await mkdir(folder,{recursive:true}); const file=path.join(folder,name);await writeFile(file,bytes,{flag:'wx'});
    const asset:Asset={id,scopeKey:scope,name,mime:input.mime,path:file,size:bytes.length,kind:input.kind,createdAt:Date.now(),jobId,sessionId};
    this.store.saveAsset(asset);return asset;
  }
  async read(scope:string,id:string):Promise<Buffer>{ const asset=this.store.asset(scope,id);const resolved=await realpath(asset.path);const root=await realpath(this.root);if(!resolved.startsWith(root+path.sep))throw new Error('ASSET_OUTSIDE_STORAGE');return readFile(resolved); }
  async resolve(scope:string,id:string):Promise<Asset>{const asset=this.store.asset(scope,id);const resolved=await realpath(asset.path);const root=await realpath(this.root);if(!resolved.startsWith(root+path.sep))throw new Error('ASSET_OUTSIDE_STORAGE');return {...asset,path:resolved};}
  recent(scope:string,kind?:string):Asset[]{const sessionId=this.currentSession(scope);return sessionId?this.store.recentAssets(scope,sessionId,kind,24):[];}
}
export class MediaService {
  readonly active=new Map<string,{scope:string;controller:AbortController;localTransform?:boolean}>();
  readonly operations:MediaOperationRegistry;
  readonly worker:WorkerPort;
  constructor(readonly store:Store,readonly assets:Assets,readonly python=process.env.BOT_PYTHON||'python',readonly analysisProvider?:AnalysisProvider,worker?:WorkerPort,operations:MediaOperationRegistry=mediaOperationRegistry,readonly slots:TransformSlots=transformSlots){this.worker=worker??{run:async()=>{throw new Error('MEDIA_WORKER_NOT_CONFIGURED');}};this.operations=operations;}
  async analysisStatus(config:BotConfig,role:AnalysisRole){try{if(!this.analysisProvider)throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');const value=await this.analysisProvider.resolve(config,role);const model=value.endpoint.protocol==='gpt_sovits'?value.endpoint.modelVersion:value.endpoint.protocol==='edge_tts'?value.endpoint.voice:value.endpoint.model;return{enabled:true,configured:true,provider:value.provider,model,keyConfigured:!!value.apiKey,protocol:value.endpoint.protocol};}catch(error){return{enabled:analysisEnabled(config,role),configured:false,error:error instanceof Error?error.message:'MEDIA_CONFIGURATION_INVALID',keyConfigured:false};}}
  cancelScope(scope:string):void{for(const item of this.active.values()) if(item.scope===scope)item.controller.abort(new Error('任务已取消'));}
  private dailyQuotaExempt(scope:string,snapshot?:TurnSnapshot):boolean {
    if(!snapshot?.trusted)return false;
    const binding=this.store.findBinding(scope);
    if(!binding||binding.key!==scope||scopeKey(binding.scope)!==scope||binding.scope.botId!==snapshot.botId)return false;
    const bot=this.store.bot(binding.scope.botId);
    return bot.id===snapshot.botId&&trusted(bot,binding.scope);
  }
  async run(scope:string,operation:MediaOperation,config:BotConfig,inputs:string[],parameters:Record<string,unknown>,signal:AbortSignal,authorize?:()=>void,snapshot?:TurnSnapshot):Promise<{text?:string;coverage?:string;assetIds:string[];contextAssetIds?:string[];incomplete?:boolean}>{
    const descriptor=this.operations.get(operation);
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
    const directory=path.join(this.store.home,'jobs',id),startedAt=Date.now();let provider:string|undefined;let requestedModel:string|undefined;
    const persist=(value:Record<string,unknown>)=>this.store.patchJob(id,value);
    let lease:Awaited<ReturnType<TransformSlots['acquire']>>|undefined;
    let releaseVoice:(()=>void)|undefined;
    const captureUsage=async()=>{try{const raw=JSON.parse(await readFile(path.join(directory,'model-usage.json'),'utf8'));if(!Array.isArray(raw))return;const modelCalls:MediaUsageCall[]=raw.filter(c=>c?.attempted===true&&typeof c.id==='string'&&Number.isSafeInteger(c.at)).map(c=>({id:c.id,attempted:true,at:c.at,provider,model:typeof c.model==='string'?c.model:requestedModel,usage:normalizeProviderUsage(c.usage)}));persist({modelCalls});const binding=this.store.findBinding(scope);if(binding)this.store.stats.upsertMediaCalls(id,binding.scope.botId,modelCalls);}catch{/* No dispatched model call is claimed without a journal entry. */}};
    this.active.set(id,{scope,controller,localTransform:descriptor.localTransform});persist({id,scope,operation,state:descriptor.localTransform?'queued':'running',startedAt});
    try{
    combined.throwIfAborted();
    if(descriptor.localTransform){lease=await this.slots.acquire(operation==='convert_gif'?2:1,combined);combined.throwIfAborted();authorize?.();persist({state:'running'});}
    if(inputs.length>INPUT_LIMITS.attachmentCount)throw new Error('MEDIA_INPUT_LIMIT');
    const source=await Promise.all(inputs.map(id=>this.assets.resolve(scope,id)));
    if(descriptor.inputKinds?.length&&source.some(item=>!descriptor.inputKinds!.includes(item.kind)))throw new Error('MEDIA_INPUT_KIND_INVALID');
    await mkdir(directory,{recursive:true});
    const role=descriptor.role;
    if(role&&!this.analysisProvider)throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');
    const connection=role?await this.analysisProvider!.resolve(config,role):undefined;
    const endpoint=connection?.endpoint??((operation==='image_generate'||operation==='image_edit')?resolveImageSkill(config):undefined);
    const gptEndpoint=connection?.endpoint.protocol==='gpt_sovits'?connection.endpoint:undefined;
    const edgeEndpoint=connection?.endpoint.protocol==='edge_tts'?connection.endpoint:undefined;
    provider=connection?.provider??(endpoint&&typeof endpoint.baseUrl==='string'?new URL(endpoint.baseUrl).hostname:undefined);requestedModel=gptEndpoint?.modelVersion??(edgeEndpoint?.voice??(endpoint&&typeof endpoint.model==='string'?endpoint.model:undefined));
    persist({provider,requestedModel});
    if(gptEndpoint){persist({state:'queued'});releaseVoice=await voiceServiceQueue.acquire(gptEndpoint.baseUrl,combined);combined.throwIfAborted();authorize?.();persist({state:'running'});}
    const credentials:Record<string,string>={};
    if(endpoint&&'keyEnv' in endpoint&&typeof endpoint.keyEnv==='string'){const keyEnv=endpoint.keyEnv;const value=connection?.apiKey??process.env[keyEnv];if(!value)throw new Error(`MISSING_PROVIDER_KEY: ${keyEnv}`);credentials[keyEnv]=value;}
    if(descriptor.inputKinds?.includes('audio')&&source[0]?.mime==='audio/silk'){
      const {decode}=await import('silk-wasm');const decoded=await decode(await this.assets.read(scope,source[0].id),24000);
      const pcm=Buffer.from(decoded.data);if(pcm.length>30*1024*1024)throw new Error('AUDIO_TOO_LONG');
      const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
      const wav=path.join(directory,'decoded.wav');await writeFile(wav,Buffer.concat([header,pcm]));source[0]={...source[0],path:wav,name:'decoded.wav',mime:'audio/wav'};
    }
      const job:MediaWorkerJob={protocol:MEDIA_WORKER_PROTOCOL,protocolVersion:MEDIA_WORKER_PROTOCOL_VERSION,id,scope,operation,handler:descriptor.handler,inputs:source.map(a=>({path:a.path,name:a.name,mime:a.mime,kind:a.kind})),parameters,endpoint:endpoint as unknown as Record<string,unknown>|undefined,output:directory,usagePath:path.join(directory,'model-usage.json'),deadline:descriptor.timeoutMs>0?Date.now()+descriptor.timeoutMs:0,timeoutMs:descriptor.timeoutMs,quotaUnits:descriptor.quotaUnits,processingSlots:lease?.slots};
      validateMediaWorkerJob(job);
      combined.throwIfAborted();
      authorize?.();
      job.dailyQuotaExempt=this.dailyQuotaExempt(scope,snapshot);
      if(!descriptor.localTransform&&!job.dailyQuotaExempt)this.store.consumeMediaQuota(`${new Date().toISOString().slice(0,10)}:${scope}:${operation}`,descriptor.quotaUnits);
      // Registered fixture/native handlers stay in the same operation registry;
      // worker-backed operations cross the versioned process boundary.
      const result=descriptor.execute
        ? await this.operations.dispatch<MediaResult>(operation,job,combined)
        : await this.worker.run(job,combined,credentials);
      combined.throwIfAborted();
      authorize?.();
      const save=async(files:MediaFile[])=>{const ids:string[]=[];for(const file of files){const resolved=await realpath(file.path);const root=await realpath(directory);if(!resolved.startsWith(root+path.sep))throw new Error('WORKER_OUTPUT_OUTSIDE_JOB');const size=(await stat(resolved)).size;if(size>(file.kind==='video'?VIDEO_LIMITS.attachmentBytes:20*1024*1024)||operation==='convert_gif'&&size>=10_000_000)throw new Error('OUTPUT_TOO_LARGE');const asset=await this.assets.save(scope,{name:file.name,mime:file.mime,kind:file.kind},await readFile(resolved),id);ids.push(asset.id);}return ids;};
      const assetIds=await save(result.assets??[]);const contextAssetIds=await save(result.contextAssets??[]);
      persist({state:'complete',assetIds,contextAssetIds,finishedAt:Date.now()});
      return {text:result.text,coverage:result.coverage,incomplete:result.incomplete,assetIds,contextAssetIds};
    }catch(error){persist({state:combined.aborted?'cancelled':'failed',finishedAt:Date.now(),error:error instanceof Error?error.message:'MEDIA_FAILED'});throw error;}finally{
      try{if(descriptor.localTransform){try{await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}catch(error){persist({cleanupError:error instanceof Error?error.message:'JOB_CLEANUP_FAILED'});}}else await captureUsage();}
      finally{this.active.delete(id);lease?.release();releaseVoice?.();}
    }
  }
}
