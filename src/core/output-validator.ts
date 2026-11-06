import {spawn} from 'node:child_process';
import {lstat,open,readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {serviceFailure} from './service-errors.js';

export type OutputKind='image'|'audio'|'video'|'file';
export interface OutputValidationRequest {kind:OutputKind;jobDirectory:string;file:string;signal?:AbortSignal;declaredMime?:string}
export interface ValidatedOutput {kind:OutputKind;path:string;relativePath:string;size:number;mime:string;metadata:Readonly<Record<string,unknown>>}
export type OutputValidator=(request:OutputValidationRequest,owned:ValidatedOutput)=>Promise<ValidatedOutput>;
export interface OutputValidatorLimits {maxBytes:number;maxImagePixels:number;maxImageDimension:number;maxDurationSeconds:number;maxArchiveEntries:number;maxArchiveExpandedBytes:number;ffprobe:string;ffmpeg:string}
const DEFAULT_LIMITS:OutputValidatorLimits={maxBytes:100*1024*1024,maxImagePixels:100_000_000,maxImageDimension:32_768,maxDurationSeconds:3600,maxArchiveEntries:10_000,maxArchiveExpandedBytes:512*1024*1024,ffprobe:'ffprobe',ffmpeg:'ffmpeg'};

const magicMime=(bytes:Buffer):string|undefined=>{
  if(bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return'image/png';
  if(bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])))return'image/jpeg';
  if(bytes.subarray(0,6).toString('ascii')==='GIF87a'||bytes.subarray(0,6).toString('ascii')==='GIF89a')return'image/gif';
  const text=bytes.toString('utf8').replace(/^\uFEFF/,'');
  if(/^\s*(?:<\?xml\b[^>]*>\s*)?(?:<!DOCTYPE\s+svg\b[^>]*>\s*)?<svg(?:\s|>)/i.test(text))return'image/svg+xml';
  if(bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WAVE')return'audio/wav';
  if(bytes.subarray(0,3).toString('ascii')==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0)return'audio/mpeg';
  if(bytes.subarray(0,4).toString('ascii')==='OggS')return'application/ogg';
  if(bytes.subarray(4,8).toString('ascii')==='ftyp')return'video/mp4';
  if(bytes.subarray(0,4).toString('ascii')==='%PDF')return'application/pdf';
  if(bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))return'application/zip';
  return undefined;
};

function imageDimensions(bytes:Buffer,mime:string):{width:number;height:number}{
  if(mime==='image/png')return{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  if(mime==='image/gif')return{width:bytes.readUInt16LE(6),height:bytes.readUInt16LE(8)};
  if(mime==='image/svg+xml'){
    const text=bytes.toString('utf8').replace(/^\uFEFF/,'');
    if(/<script\b|<foreignObject\b|(?:href|xlink:href)\s*=\s*["'](?:https?:|data:|file:)/i.test(text))throw new Error('OUTPUT_SVG_UNSAFE');
    const root=text.match(/<svg\b([^>]*)>/i)?.[1]??'';
    const attr=(name:string)=>{const value=root.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`,'i'))?.[1];const number=Number.parseFloat(value??'');return Number.isFinite(number)&&number>0?number:undefined;};
    const width=attr('width'),height=attr('height');
    if(width&&height)return{width:Math.ceil(width),height:Math.ceil(height)};
    const viewBox=root.match(/\bviewBox\s*=\s*["']\s*([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)\s*["']/i);
    const viewWidth=Number.parseFloat(viewBox?.[3]??''),viewHeight=Number.parseFloat(viewBox?.[4]??'');
    if(Number.isFinite(viewWidth)&&viewWidth>0&&Number.isFinite(viewHeight)&&viewHeight>0)return{width:Math.ceil(viewWidth),height:Math.ceil(viewHeight)};
    throw new Error('OUTPUT_SVG_DIMENSIONS_INVALID');
  }
  if(mime==='image/jpeg'){let offset=2;while(offset+9<=bytes.length){if(bytes[offset]!==0xff){offset++;continue;}const marker=bytes[offset+1];if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return{height:bytes.readUInt16BE(offset+5),width:bytes.readUInt16BE(offset+7)};const size=bytes.readUInt16BE(offset+2);if(size<2)break;offset+=size+2;}}
  throw new Error('OUTPUT_IMAGE_HEADER_INVALID');
}

async function runProcess(command:string,args:string[],signal?:AbortSignal,maxOutput=1024*1024,returnStderr=false):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const cancel=()=>child.kill();signal?.addEventListener('abort',cancel,{once:true});child.stdout.setEncoding('utf8').on('data',chunk=>{stdout+=chunk;if(stdout.length>maxOutput)child.kill();});child.stderr.setEncoding('utf8').on('data',chunk=>{stderr+=chunk;if(stderr.length>maxOutput)stderr=stderr.slice(-maxOutput);});child.on('error',reject);child.on('exit',code=>{signal?.removeEventListener('abort',cancel);if(signal?.aborted)reject(signal.reason);else if(code!==0)reject(new Error('OUTPUT_PROBE_FAILED'));else resolve(returnStderr?stderr:stdout);});});}
async function runJson(command:string,args:string[],signal?:AbortSignal):Promise<any>{const stdout=await runProcess(command,args,signal);try{return JSON.parse(stdout);}catch{throw new Error('OUTPUT_PROBE_INVALID');}}

export class OutputValidatorRegistry {
  private readonly validators=new Map<OutputKind,OutputValidator>();
  readonly limits:OutputValidatorLimits;
  constructor(limits:Partial<OutputValidatorLimits>={}){this.limits={...DEFAULT_LIMITS,...limits};this.register('image',(request,owned)=>this.image(request,owned));this.register('audio',(request,owned)=>this.audio(request,owned));this.register('video',(request,owned)=>this.video(request,owned));this.register('file',(request,owned)=>this.file(request,owned));}
  register(kind:OutputKind,validator:OutputValidator):()=>void {if(this.validators.has(kind))throw new Error(`OUTPUT_VALIDATOR_DUPLICATE: ${kind}`);this.validators.set(kind,validator);return()=>this.validators.delete(kind);}
  async validate(request:OutputValidationRequest):Promise<ValidatedOutput>{
    try{const owned=await this.ownership(request),validator=this.validators.get(request.kind);if(!validator)throw new Error('OUTPUT_VALIDATOR_MISSING');return await validator({...request,file:owned.path},owned);}catch(error){serviceFailure({category:'OUTPUT_INVALID',safeDiagnostic:'服务输出未通过宿主校验。',retryable:false,blocksService:false},error);}
  }
  private async ownership(request:OutputValidationRequest):Promise<ValidatedOutput>{
    const root=await realpath(request.jobDirectory),candidate=path.isAbsolute(request.file)?request.file:path.resolve(root,request.file),lexical=path.relative(root,candidate);if(!lexical||lexical.startsWith('..')||path.isAbsolute(lexical))throw new Error('OUTPUT_OUTSIDE_JOB');let current=root;for(const segment of lexical.split(path.sep)){current=path.join(current,segment);const item=await lstat(current);if(item.isSymbolicLink())throw new Error('OUTPUT_REPARSE_POINT_REJECTED');}const resolved=await realpath(candidate),relative=path.relative(root,resolved);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('OUTPUT_OUTSIDE_JOB');const info=await stat(resolved);if(!info.isFile()||info.size<=0||info.size>this.limits.maxBytes)throw new Error('OUTPUT_FILE_INVALID');const handle=await open(resolved,'r');const prefix=Buffer.alloc(Math.min(64*1024,info.size));await handle.read(prefix,0,prefix.length,0).finally(()=>handle.close());return{kind:request.kind,path:resolved,relativePath:relative.split(path.sep).join('/'),size:info.size,mime:magicMime(prefix)??'application/octet-stream',metadata:{}};
  }
  private async image(request:OutputValidationRequest,owned:ValidatedOutput):Promise<ValidatedOutput>{const bytes=await readFile(owned.path);if(!owned.mime.startsWith('image/'))throw new Error('OUTPUT_IMAGE_MAGIC_INVALID');const {width,height}=imageDimensions(bytes,owned.mime);if(width<1||height<1||width>this.limits.maxImageDimension||height>this.limits.maxImageDimension||width*height>this.limits.maxImagePixels)throw new Error('OUTPUT_IMAGE_DIMENSIONS_INVALID');const ending=owned.mime==='image/png'?bytes.subarray(-8,-4).toString('ascii')==='IEND':owned.mime==='image/jpeg'?bytes.subarray(-2).equals(Buffer.from([0xff,0xd9])):owned.mime==='image/gif'?bytes.at(-1)===0x3b:true;if(!ending)throw new Error('OUTPUT_IMAGE_TRUNCATED');if(owned.mime!=='image/svg+xml'&&this.limits.ffmpeg)await runProcess(this.limits.ffmpeg,['-hide_banner','-loglevel','error','-xerror','-err_detect','explode','-nostdin','-i',owned.path,'-map','0:v:0','-f','null','-'],request.signal,64*1024);return{...owned,metadata:{width,height}};}
  private async audio(request:OutputValidationRequest,owned:ValidatedOutput):Promise<ValidatedOutput>{if(!['audio/wav','audio/mpeg','application/ogg'].includes(owned.mime))throw new Error('OUTPUT_AUDIO_MAGIC_INVALID');const info=await this.probe(owned.path,request.signal),audio=(info.streams as any[])?.find(stream=>stream.codec_type==='audio'),duration=Number(audio?.duration??info.format?.duration),sampleRate=Number(audio?.sample_rate);if(!audio||!Number.isFinite(duration)||duration<=0||duration>this.limits.maxDurationSeconds||!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>384000)throw new Error('OUTPUT_AUDIO_INVALID');const stats=await runProcess(this.limits.ffmpeg,['-hide_banner','-nostdin','-i',owned.path,'-map','0:a:0','-af','astats=metadata=1:reset=0','-f','null','-'],request.signal,64*1024,true);if(/Peak level dB:\s*-inf/i.test(stats))throw new Error('OUTPUT_AUDIO_SILENT');return{...owned,mime:owned.mime,metadata:{duration,sampleRate,codec:audio.codec_name,channels:audio.channels}};}
  private async video(request:OutputValidationRequest,owned:ValidatedOutput):Promise<ValidatedOutput>{if(owned.mime!=='video/mp4')throw new Error('OUTPUT_VIDEO_MAGIC_INVALID');const info=await this.probe(owned.path,request.signal),streams=info.streams as any[],video=streams?.find(stream=>stream.codec_type==='video'),duration=Number(info.format?.duration??video?.duration);if(!video||!Number.isFinite(duration)||duration<=0||duration>this.limits.maxDurationSeconds||streams.length>16)throw new Error('OUTPUT_VIDEO_INVALID');return{...owned,metadata:{duration,codec:video.codec_name,width:video.width,height:video.height,streamCount:streams.length}};}
  private async file(_request:OutputValidationRequest,owned:ValidatedOutput):Promise<ValidatedOutput>{if(owned.mime==='application/zip'){const bytes=await readFile(owned.path);let entries=0,expanded=0;for(let offset=0;offset+46<=bytes.length;){const signature=bytes.readUInt32LE(offset);if(signature!==0x02014b50){offset++;continue;}entries++;expanded+=bytes.readUInt32LE(offset+24);if(entries>this.limits.maxArchiveEntries||expanded>this.limits.maxArchiveExpandedBytes||expanded>Math.max(owned.size*100,10*1024*1024))throw new Error('OUTPUT_ARCHIVE_BOMB');const nameLength=bytes.readUInt16LE(offset+28),extraLength=bytes.readUInt16LE(offset+30),commentLength=bytes.readUInt16LE(offset+32),name=bytes.subarray(offset+46,offset+46+nameLength).toString('utf8').replaceAll('\\','/');if(path.posix.isAbsolute(name)||path.win32.isAbsolute(name)||name.split('/').includes('..'))throw new Error('OUTPUT_ARCHIVE_PATH_INVALID');offset+=46+nameLength+extraLength+commentLength;}if(!entries)throw new Error('OUTPUT_ARCHIVE_INVALID');return{...owned,metadata:{entries,expandedBytes:expanded}};}return owned;}
  private probe(file:string,signal?:AbortSignal):Promise<any>{return runJson(this.limits.ffprobe,['-v','error','-show_format','-show_streams','-of','json',file],signal);}
}
