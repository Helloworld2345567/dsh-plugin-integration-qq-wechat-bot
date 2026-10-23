import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { packageRoot } from './paths.js';
import {resolveImageSkill} from './image-skill.js';
import {analysisEnabled,type AnalysisProvider,type AnalysisRole} from './analysis.js';
import type { Store } from './store.js';
import type { Asset, BotConfig, MediaInput } from './types.js';
import {normalizeProviderUsage,type MediaUsageCall} from './usage.js';
import {validateMediaParameters,INPUT_LIMITS} from './limits.js';

export const MEDIA_OPERATIONS=['image_generate','image_edit','image_understand','transcribe','video_analyze','document_read','convert_gif','convert_mp4','social_read'] as const;
export type MediaOperation=typeof MEDIA_OPERATIONS[number];
export interface MediaFile {path:string;name:string;mime:string;kind:Asset['kind']}
export interface MediaResult { text?:string; coverage?:string; assets?:MediaFile[]; contextAssets?:MediaFile[]; observations?:unknown; incomplete?:boolean }
export class Assets {
  constructor(readonly store:Store,readonly root=path.join(store.home,'assets')){}
  private currentSession(scope:string):string|undefined {const binding=this.store.findBinding(scope);return binding?.key===scope&&typeof binding.sessionId==='string'&&this.store.findSession(binding.sessionId)?.scopeKey===scope?binding.sessionId:undefined;}
  async save(scope:string,input:MediaInput,bytes:Buffer,jobId?:string):Promise<Asset>{
    // Capture ownership before any I/O: a concurrent /new must not reassign an older upload.
    const sessionId=this.currentSession(scope);
    if(bytes.length>50*1024*1024) throw new Error('MEDIA_TOO_LARGE');
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
  readonly active=new Map<string,{scope:string;controller:AbortController}>();
  constructor(readonly store:Store,readonly assets:Assets,readonly python=process.env.BOT_PYTHON||'python',readonly analysisProvider?:AnalysisProvider){}
  async analysisStatus(config:BotConfig,role:AnalysisRole){try{if(!this.analysisProvider)throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');const value=await this.analysisProvider.resolve(config,role);return{enabled:true,provider:value.provider,model:value.endpoint.model,keyConfigured:!!value.apiKey,protocol:value.endpoint.protocol};}catch(error){return{enabled:analysisEnabled(config,role),error:error instanceof Error?error.message:'MEDIA_CONFIGURATION_INVALID',keyConfigured:false};}}
  cancelScope(scope:string):void{for(const item of this.active.values()) if(item.scope===scope)item.controller.abort(new Error('任务已取消'));}
  async run(scope:string,operation:MediaOperation,config:BotConfig,inputs:string[],parameters:Record<string,unknown>,signal:AbortSignal):Promise<{text?:string;coverage?:string;assetIds:string[];contextAssetIds?:string[];incomplete?:boolean}>{
    if(!MEDIA_OPERATIONS.includes(operation))throw new Error('UNKNOWN_MEDIA_OPERATION');
    if(operation==='image_understand')throw new Error('IMAGE_READ_USE_NATIVE_CHAT_MODEL');
    validateMediaParameters(operation,inputs,parameters);
    if(this.active.size>=2 || [...this.active.values()].some(a=>a.scope===scope))throw new Error('MEDIA_CONCURRENCY_LIMIT');
    const id=randomUUID();const controller=new AbortController(); const combined=AbortSignal.any([signal,controller.signal,AbortSignal.timeout(180000)]);
    const directory=path.join(this.store.home,'jobs',id),startedAt=Date.now();let provider:string|undefined;let requestedModel:string|undefined;
    const persist=(value:Record<string,unknown>)=>this.store.patchJob(id,value);
    const operationConfig={image_generate:20,image_edit:20,image_understand:20,transcribe:50,video_analyze:10,document_read:50,convert_gif:50,convert_mp4:50,social_read:20} satisfies Record<MediaOperation,number>;
    const captureUsage=async()=>{try{const raw=JSON.parse(await readFile(path.join(directory,'model-usage.json'),'utf8'));if(!Array.isArray(raw))return;const modelCalls:MediaUsageCall[]=raw.filter(c=>c?.attempted===true&&typeof c.id==='string'&&Number.isSafeInteger(c.at)).map(c=>({id:c.id,attempted:true,at:c.at,provider,model:typeof c.model==='string'?c.model:requestedModel,usage:normalizeProviderUsage(c.usage)}));persist({modelCalls});const binding=this.store.findBinding(scope);if(binding)this.store.stats.upsertMediaCalls(id,binding.scope.botId,modelCalls);}catch{/* No dispatched model call is claimed without a journal entry. */}};
    this.active.set(id,{scope,controller});persist({id,scope,operation,state:'running',startedAt});
    try{
    combined.throwIfAborted();
    if(inputs.length>INPUT_LIMITS.attachmentCount)throw new Error('MEDIA_INPUT_LIMIT');
    const source=await Promise.all(inputs.map(id=>this.assets.resolve(scope,id)));
    await mkdir(directory,{recursive:true});
    const role=operation==='transcribe'?'asr':operation==='video_analyze'?'video':undefined;
    if(role&&!this.analysisProvider)throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');
    const connection=role?await this.analysisProvider!.resolve(config,role):undefined;
    const endpoint=connection?.endpoint??(operation.startsWith('image_')?resolveImageSkill(config):undefined);
    provider=connection?.provider??(endpoint?new URL(endpoint.baseUrl).hostname:undefined);requestedModel=endpoint?.model;
    persist({provider,requestedModel});
    const day=new Date().toISOString().slice(0,10);const quotaKey=`${day}:${scope}:${operation}`;
    this.store.consumeMediaQuota(quotaKey,operationConfig[operation]);
    const env:NodeJS.ProcessEnv={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,SYSTEMROOT:process.env.SYSTEMROOT,TEMP:process.env.TEMP,TMP:process.env.TMP,USERPROFILE:process.env.USERPROFILE,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'};
    if(endpoint){const value=connection?.apiKey??process.env[endpoint.keyEnv];if(!value)throw new Error(`MISSING_PROVIDER_KEY: ${endpoint.keyEnv}`);env[endpoint.keyEnv]=value;}
    if(operation==='transcribe'&&source[0]?.mime==='audio/silk'){
      const {decode}=await import('silk-wasm');const decoded=await decode(await this.assets.read(scope,source[0].id),24000);
      const pcm=Buffer.from(decoded.data);if(pcm.length>30*1024*1024)throw new Error('AUDIO_TOO_LONG');
      const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
      const wav=path.join(directory,'decoded.wav');await writeFile(wav,Buffer.concat([header,pcm]));source[0]={...source[0],path:wav,name:'decoded.wav',mime:'audio/wav'};
    }
    const job={id,scope,operation,inputs:source.map(a=>({path:a.path,name:a.name,mime:a.mime,kind:a.kind})),parameters,endpoint,output:directory,usagePath:path.join(directory,'model-usage.json'),deadline:Date.now()+180000};
      combined.throwIfAborted();
      const worker=path.join(packageRoot(),'python','worker.py');
      const result=await new Promise<MediaResult>((resolve,reject)=>{
        const child=spawn(this.python,['-u',worker],{env,windowsHide:true,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
        let output='';let errors='';let kill:ReturnType<typeof setTimeout>|undefined;
        const abort=()=>{if(process.platform==='win32' && child.pid) spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{child.kill();}} kill=setTimeout(()=>child.kill('SIGKILL'),1500);};
        combined.addEventListener('abort',abort,{once:true});
        child.stdout.on('data',c=>{output+=String(c);if(output.length>2*1024*1024){controller.abort();}});
        child.stderr.on('data',c=>{if(errors.length<2000)errors+=String(c);});
        child.on('error',error=>{combined.removeEventListener('abort',abort);if(kill)clearTimeout(kill);reject(error);});child.on('close',code=>{combined.removeEventListener('abort',abort);if(kill)clearTimeout(kill);if(combined.aborted){reject(new Error('MEDIA_CANCELLED_OR_TIMEOUT'));return;}try{const response=JSON.parse(output.trim());if(code || response.error)throw new Error(response.error?.code||'MEDIA_WORKER_FAILED');resolve(response);}catch(e){reject(e);}});
        child.stdin.end(JSON.stringify(job));if(combined.aborted)abort();
      });
      const save=async(files:MediaFile[])=>{const ids:string[]=[];for(const file of files){const resolved=await realpath(file.path);const root=await realpath(directory);if(!resolved.startsWith(root+path.sep))throw new Error('WORKER_OUTPUT_OUTSIDE_JOB');if((await stat(resolved)).size>20*1024*1024)throw new Error('OUTPUT_TOO_LARGE');const asset=await this.assets.save(scope,{name:file.name,mime:file.mime,kind:file.kind},await readFile(resolved),id);ids.push(asset.id);}return ids;};
      const assetIds=await save(result.assets??[]);const contextAssetIds=await save(result.contextAssets??[]);
      persist({state:'complete',assetIds,contextAssetIds,finishedAt:Date.now()});
      return {text:result.text,coverage:result.coverage,incomplete:result.incomplete,assetIds,contextAssetIds};
    }catch(error){persist({state:combined.aborted?'cancelled':'failed',finishedAt:Date.now(),error:error instanceof Error?error.message:'MEDIA_FAILED'});throw error;}finally{await captureUsage();this.active.delete(id);}
  }
}
