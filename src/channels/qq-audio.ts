import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {decode,encode,getDuration,isSilk} from 'silk-wasm';
import type {Assets} from '../core/media.js';
import type {Store} from '../core/store.js';
import type {Asset,ChannelOutboundContext,Output} from '../core/types.js';
import {AUDIO_LIMITS} from '../core/limits.js';
import {assetFolder} from '../core/workspace-files.js';
import {transformSlots,type TransformSlots} from '../core/transform-slots.js';
import {NodeControlledProcessPort,type ControlledProcessPort} from '../harness/controlled-process.js';
import {jobEnvironment} from '../harness/json-process.js';

const SAMPLE_RATE=24_000;
const FRAME_BYTES=SAMPLE_RATE*2/50;
const SEGMENT_MS=300_000;
const SEGMENT_BYTES=SAMPLE_RATE*2*SEGMENT_MS/1000;
const PART_NAME=/^qq-voice-(\d+)-of-(\d+)\.silk$/;
const FULL_NAME='qq-complete.mp3';

export interface QQAudioOptions {processes?:ControlledProcessPort;slots?:TransformSlots;ffmpeg?:string}

export function createQQAudioPreparer(store:Store,assets:Assets,options:QQAudioOptions={}):(context:ChannelOutboundContext)=>Promise<Output[]> {
  const processes=options.processes??new NodeControlledProcessPort(),slots=options.slots??transformSlots,ffmpeg=options.ffmpeg??'ffmpeg';
  return async context=>{
    const {binding,signal}=context,created:Asset[]=[];
    const authorize=()=>{
      signal.throwIfAborted();context.authorize();
      const current=store.findBinding(binding.key);
      if(current?.sessionId!==binding.sessionId||current.generation!==binding.generation)throw Error('QQ_AUDIO_SESSION_CHANGED');
    };
    const output=(assetId:string,source:Output,asFile=false):Output=>({type:'asset',assetId,...source.resend?{resend:true}:{},...asFile?{asFile:true}:{}});
    const resolve=async(id:string)=>{
      authorize();const asset=await assets.resolve(binding.key,id);authorize();
      if(asset.scopeKey!==binding.key||asset.sessionId!==binding.sessionId)throw Error('QQ_AUDIO_ATTACHMENT_INVALID');
      return asset;
    };
    const save=async(source:Asset,name:string,mime:string,bytes:Buffer,jobId:string)=>{
      authorize();const asset=await assets.save(binding.key,{kind:'audio',name,mime},bytes,jobId,'generated',binding.sessionId,binding.generation,authorize,source.serviceSnapshot);created.push(asset);authorize();return asset;
    };
    const cached=async(source:Asset,item:Output,jobId:string):Promise<Output[]|undefined>=>{
      const candidates=store.list<Asset>('asset').filter(asset=>asset.jobId===jobId&&asset.scopeKey===binding.key&&asset.sessionId===binding.sessionId&&asset.kind==='audio');
      const named=candidates.flatMap(asset=>{const match=PART_NAME.exec(asset.name);return match?[{asset,ordinal:Number(match[1]),count:Number(match[2])}]:[];});
      const counts=[...new Set(named.map(row=>row.count))].filter(count=>Number.isSafeInteger(count)&&count>0&&count<=Math.ceil(AUDIO_LIMITS.outputBytes/SEGMENT_BYTES));
      for(const count of counts){
        const parts:Asset[]=[];
        for(let ordinal=1;ordinal<=count;ordinal++){
          let selected:Asset|undefined;
          for(const row of named.filter(row=>row.count===count&&row.ordinal===ordinal).sort((a,b)=>b.asset.createdAt-a.asset.createdAt)){
            let asset:Asset,bytes:Buffer;
            try{asset=await resolve(row.asset.id);bytes=await readFile(asset.path);}catch(error){authorize();continue;}
            authorize();let duration=0;try{if(isSilk(bytes))duration=getDuration(bytes);}catch{}
            if(duration>0&&duration<=SEGMENT_MS&&(ordinal===count||duration===SEGMENT_MS)){selected=asset;break;}
          }
          if(!selected)break;parts.push(selected);
        }
        if(parts.length!==count)continue;
        const outputs=parts.map(part=>output(part.id,item));
        if(count>1){
          let full:Asset|undefined=source.mime==='audio/mpeg'||/\.mp3$/i.test(source.name)?source:undefined;
          if(!full)for(const candidate of candidates.filter(asset=>asset.name===FULL_NAME)){
            try{const resolved=await resolve(candidate.id);if((await stat(resolved.path)).size>0){full=resolved;break;}}catch{authorize();}
          }
          if(!full)continue;outputs.push(output(full.id,item,true));
        }
        authorize();return outputs;
      }
    };
    const prepare=async(source:Asset,item:Output):Promise<Output[]>=>{
      const jobId=`qq-voice:${source.id}:300s:v1`,previous=await cached(source,item,jobId);if(previous)return previous;
      const sourceBytes=await readFile(source.path);authorize();
      if(isSilk(sourceBytes)){
        const duration=getDuration(sourceBytes);if(duration>0&&duration<=SEGMENT_MS)return[output(source.id,item)];
        if(duration* SAMPLE_RATE*2/1000>AUDIO_LIMITS.outputBytes)throw Error('QQ_AUDIO_TOO_LONG');
      }
      const lease=await slots.acquire(1,signal);let temporary:string|undefined;
      try{
        authorize();const workspace=await assets.workspace(binding.key),root=path.join(workspace,'.bot','tmp');await mkdir(root,{recursive:true});temporary=await mkdtemp(path.join(root,'qq-outbound-'));authorize();
        const pcmPath=path.join(temporary,'decoded.pcm');
        const run=async(args:string[])=>{
          authorize();let result;
          try{result=await processes.run({command:ffmpeg,args:['-hide_banner','-nostdin','-loglevel','error','-y',...args],cwd:temporary!,env:jobEnvironment(temporary!),signal,deadline:Date.now()+15*60_000,maxOutputBytes:64*1024});}catch(error){authorize();if((error as NodeJS.ErrnoException)?.code==='ENOENT')throw Error('QQ_AUDIO_FFMPEG_UNAVAILABLE');throw error;}
          authorize();if(result.code!==0)throw Error('QQ_AUDIO_CONVERSION_FAILED');
        };
        let pcm:Buffer;
        if(isSilk(sourceBytes)){pcm=Buffer.from((await decode(sourceBytes,SAMPLE_RATE)).data);authorize();await writeFile(pcmPath,pcm);}
        else {await run(['-i',source.path,'-map','0:a:0','-vn','-ac','1','-ar',String(SAMPLE_RATE),'-c:a','pcm_s16le','-f','s16le','-fs',String(AUDIO_LIMITS.outputBytes+2),pcmPath]);if((await stat(pcmPath)).size>AUDIO_LIMITS.outputBytes)throw Error('QQ_AUDIO_TOO_LONG');pcm=await readFile(pcmPath);}
        authorize();if(!pcm.length||pcm.length%2||pcm.length>AUDIO_LIMITS.outputBytes)throw Error('QQ_AUDIO_PCM_INVALID');
        const count=Math.ceil(pcm.length/SEGMENT_BYTES),encoded:Buffer[]=[];
        for(let ordinal=0;ordinal<count;ordinal++){
          authorize();const segment=pcm.subarray(ordinal*SEGMENT_BYTES,Math.min((ordinal+1)*SEGMENT_BYTES,pcm.length)),padded=Buffer.alloc(Math.ceil(segment.length/FRAME_BYTES)*FRAME_BYTES);segment.copy(padded);
          const silk=Buffer.from((await encode(padded,SAMPLE_RATE)).data);authorize();
          const duration=isSilk(silk)?getDuration(silk):0;if(duration!==padded.length/(SAMPLE_RATE*2/1000)||duration>SEGMENT_MS)throw Error('QQ_AUDIO_SILK_INVALID');encoded.push(silk);
        }
        let full:Asset|undefined;
        if(count>1){
          if(source.mime==='audio/mpeg'||/\.mp3$/i.test(source.name))full=source;
          else{
            const mp3=path.join(temporary,FULL_NAME),input=isSilk(sourceBytes)?['-f','s16le','-ar',String(SAMPLE_RATE),'-ac','1','-i',pcmPath]:['-i',source.path];
            await run([...input,'-map','0:a:0','-vn','-c:a','libmp3lame','-b:a','192k',mp3]);const bytes=await readFile(mp3);authorize();if(!bytes.length)throw Error('QQ_AUDIO_MP3_INVALID');full=await save(source,FULL_NAME,'audio/mpeg',bytes,jobId);
          }
        }
        const outputs:Output[]=[];
        for(const [index,bytes] of encoded.entries()){
          const name=`qq-voice-${String(index+1).padStart(4,'0')}-of-${String(count).padStart(4,'0')}.silk`,asset=await save(source,name,'audio/silk',bytes,jobId);outputs.push(output(asset.id,item));
        }
        if(full)outputs.push(output(full.id,item,true));authorize();return outputs;
      }finally{try{if(temporary)await rm(temporary,{recursive:true,force:true});}finally{lease.release();}}
    };
    try{
      authorize();const outputs:Output[]=[];
      for(const item of context.outputs){
        authorize();if(item.type!=='asset'){outputs.push(item);continue;}
        const source=await resolve(item.assetId!);if(item.asFile||source.kind!=='audio'){outputs.push(item);continue;}
        outputs.push(...await prepare(source,item));
      }
      authorize();return outputs;
    }catch(error){
      for(const asset of created){
        if(store.deliveryRepository().findByAsset(binding.key,asset.id).length)continue;
        const folder=assetFolder(asset.workspace!,asset),relative=path.relative(path.resolve(asset.workspace!),path.resolve(folder));
        if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.resolve(asset.path)!==path.join(path.resolve(folder),asset.name))throw Error('QQ_AUDIO_CLEANUP_PATH_INVALID');
        await rm(folder,{recursive:true,force:true});store.transaction(()=>{store.db.prepare('DELETE FROM asset_index WHERE id=? AND scope=?').run(asset.id,binding.key);store.db.prepare("DELETE FROM records WHERE kind='asset' AND id=?").run(asset.id);});
      }
      throw error;
    }
  };
}
