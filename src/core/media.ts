import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { packageRoot } from './paths.js';
import {resolveImageSkill} from './image-skill.js';
import {analysisEnabled,type AnalysisProvider,type AnalysisRole} from './analysis.js';
import type { Store } from './store.js';
import type { Asset, BotConfig, MediaInput } from './types.js';

export const MEDIA_OPERATIONS=['image_generate','image_edit','image_understand','transcribe','video_analyze','document_read','convert_gif','convert_mp4','social_read'] as const;
export type MediaOperation=typeof MEDIA_OPERATIONS[number];
export interface MediaFile {path:string;name:string;mime:string;kind:Asset['kind']}
export interface MediaResult { text?:string; coverage?:string; assets?:MediaFile[]; contextAssets?:MediaFile[]; observations?:unknown; incomplete?:boolean }
export class Assets {
  constructor(readonly store:Store,readonly root=path.join(store.home,'assets')){}
  async save(scope:string,input:MediaInput,bytes:Buffer,jobId?:string):Promise<Asset>{
    if(bytes.length>50*1024*1024) throw new Error('MEDIA_TOO_LARGE');
    const existing=this.store.list<Asset>('asset');if(existing.filter(a=>a.scopeKey===scope).reduce((sum,a)=>sum+a.size,0)+bytes.length>512*1024*1024||existing.reduce((sum,a)=>sum+a.size,0)+bytes.length>2*1024*1024*1024)throw new Error('MEDIA_STORAGE_LIMIT');
    const id=randomUUID(); const name=path.basename(input.name.replaceAll('\\','/')).replace(/[^\p{L}\p{N}._ -]/gu,'_').slice(0,180)||'attachment.bin';
    const folder=path.join(this.root,scope,id); await mkdir(folder,{recursive:true}); const file=path.join(folder,name);await writeFile(file,bytes,{flag:'wx'});
    const asset:Asset={id,scopeKey:scope,name,mime:input.mime,path:file,size:bytes.length,kind:input.kind,createdAt:Date.now(),jobId};
    this.store.put('asset',id,asset);return asset;
  }
  async read(scope:string,id:string):Promise<Buffer>{ const asset=this.store.asset(scope,id);const resolved=await realpath(asset.path);const root=await realpath(this.root);if(!resolved.startsWith(root+path.sep))throw new Error('ASSET_OUTSIDE_STORAGE');return readFile(resolved); }
  async resolve(scope:string,id:string):Promise<Asset>{const asset=this.store.asset(scope,id);const resolved=await realpath(asset.path);const root=await realpath(this.root);if(!resolved.startsWith(root+path.sep))throw new Error('ASSET_OUTSIDE_STORAGE');return {...asset,path:resolved};}
  recent(scope:string,kind?:string):Asset[]{return this.store.list<Asset>('asset').filter(a=>a.scopeKey===scope && (!kind||a.kind===kind) && a.createdAt>Date.now()-600000).sort((a,b)=>b.createdAt-a.createdAt).slice(0,24);}
}
export class MediaService {
  readonly active=new Map<string,{scope:string;controller:AbortController}>();
  constructor(readonly store:Store,readonly assets:Assets,readonly python=process.env.BOT_PYTHON||'python',readonly analysisProvider?:AnalysisProvider){}
  async analysisStatus(config:BotConfig,role:AnalysisRole){try{if(!this.analysisProvider)throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');const value=await this.analysisProvider.resolve(config,role);return{enabled:true,provider:value.provider,model:value.endpoint.model,keyConfigured:!!value.apiKey,protocol:value.endpoint.protocol};}catch(error){return{enabled:analysisEnabled(config,role),error:error instanceof Error?error.message:'MEDIA_CONFIGURATION_INVALID',keyConfigured:false};}}
  cancelScope(scope:string):void{for(const item of this.active.values()) if(item.scope===scope)item.controller.abort(new Error('任务已取消'));}
  async run(scope:string,operation:MediaOperation,config:BotConfig,inputs:string[],parameters:Record<string,unknown>,signal:AbortSignal):Promise<{text?:string;coverage?:string;assetIds:string[];contextAssetIds?:string[];incomplete?:boolean}>{
    if(!MEDIA_OPERATIONS.includes(operation))throw new Error('UNKNOWN_MEDIA_OPERATION');
    if(operation==='image_understand')throw new Error('IMAGE_READ_USE_NATIVE_CHAT_MODEL');
    if(this.active.size>=2 || [...this.active.values()].some(a=>a.scope===scope))throw new Error('MEDIA_CONCURRENCY_LIMIT');
    const id=randomUUID();const controller=new AbortController(); const combined=AbortSignal.any([signal,controller.signal,AbortSignal.timeout(180000)]);
    this.active.set(id,{scope,controller});this.store.put('job',id,{id,scope,operation,state:'running',startedAt:Date.now()});
    try{
    combined.throwIfAborted();
    if(inputs.length>8)throw new Error('MEDIA_INPUT_LIMIT');
    const source=await Promise.all(inputs.map(id=>this.assets.resolve(scope,id)));
    const directory=path.join(this.store.home,'jobs',id);await mkdir(directory,{recursive:true});
    const role=operation==='transcribe'?'asr':operation==='video_analyze'?'video':undefined;
    if(role&&!this.analysisProvider)throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');
    const connection=role?await this.analysisProvider!.resolve(config,role):undefined;
    const endpoint=connection?.endpoint??(operation.startsWith('image_')?resolveImageSkill(config):undefined);
    const day=new Date().toISOString().slice(0,10);const quotaKey=`${day}:${scope}:${operation}`;
    this.store.transaction(()=>{const used=this.store.get<number>('media-quota',quotaKey)??0;const limit=operation==='video_analyze'?10:operation.startsWith('image_')?20:50;if(used>=limit)throw new Error('MEDIA_DAILY_LIMIT');this.store.put('media-quota',quotaKey,used+1);});
    const env:NodeJS.ProcessEnv={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,SYSTEMROOT:process.env.SYSTEMROOT,TEMP:process.env.TEMP,TMP:process.env.TMP,USERPROFILE:process.env.USERPROFILE,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'};
    if(endpoint){const value=connection?.apiKey??process.env[endpoint.keyEnv];if(!value)throw new Error(`MISSING_PROVIDER_KEY: ${endpoint.keyEnv}`);env[endpoint.keyEnv]=value;}
    if(operation==='transcribe'&&source[0]?.mime==='audio/silk'){
      const {decode}=await import('silk-wasm');const decoded=await decode(await this.assets.read(scope,source[0].id),24000);
      const pcm=Buffer.from(decoded.data);if(pcm.length>30*1024*1024)throw new Error('AUDIO_TOO_LONG');
      const header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
      const wav=path.join(directory,'decoded.wav');await writeFile(wav,Buffer.concat([header,pcm]));source[0]={...source[0],path:wav,name:'decoded.wav',mime:'audio/wav'};
    }
    const job={id,scope,operation,inputs:source.map(a=>({path:a.path,name:a.name,mime:a.mime,kind:a.kind})),parameters,endpoint,output:directory,deadline:Date.now()+180000};
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
      this.store.put('job',id,{id,scope,operation,state:'complete',assetIds,contextAssetIds,finishedAt:Date.now()});
      return {text:result.text,coverage:result.coverage,incomplete:result.incomplete,assetIds,contextAssetIds};
    }catch(error){this.store.put('job',id,{id,scope,operation,state:combined.aborted?'cancelled':'failed',error:error instanceof Error?error.message:'MEDIA_FAILED'});throw error;}finally{this.active.delete(id);}
  }
}
