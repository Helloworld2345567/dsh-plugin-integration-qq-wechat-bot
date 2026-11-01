import {createHash} from 'node:crypto';
import {open,type FileHandle} from 'node:fs/promises';
import path from 'node:path';
import {assertRemoteUrl,errorCauseCode,jsonRequest,RemoteError,sanitizeRemoteMessage} from '../core/network.js';
import type {Asset} from '../core/types.js';
import {assertQQUploadSize,QQ_MEDIA_LIMITS,qqFileType} from './qq-limits.js';

// The official upload_prepare protocol specifies this exact prefix length.
const MD5_PREFIX_BYTES=10_002_432;
const HASH_BLOCK_BYTES=1024*1024;
const REQUEST_TIMEOUT=60_000;

export function assertQQResponse(value:any,token?:string):void{
  if(value?.code!==undefined&&value.code!==0&&value.code!=='0')throw new RemoteError('QQ_API_REJECTED',200,undefined,undefined,{
    platformCode:value.code,
    platformMessage:sanitizeRemoteMessage(value.message,token?[token]:[]),
    platformTraceId:value.trace_id??value.traceid,
  });
}

async function readBlock(file:FileHandle,position:number,size:number,signal:AbortSignal):Promise<Buffer<ArrayBuffer>>{
  const bytes=Buffer.allocUnsafe(size);let offset=0;
  while(offset<size){
    signal.throwIfAborted();
    const {bytesRead}=await file.read(bytes,offset,size-offset,position+offset);
    if(!bytesRead)throw new Error('QQ_FILE_CHANGED');
    offset+=bytesRead;
  }
  signal.throwIfAborted();return bytes;
}

async function hashes(file:FileHandle,size:number,signal:AbortSignal):Promise<{md5:string;sha1:string;md5_10m:string}>{
  const md5=createHash('md5'),sha1=createHash('sha1'),prefix=createHash('md5');
  for(let position=0;position<size;position+=HASH_BLOCK_BYTES){
    const block=await readBlock(file,position,Math.min(HASH_BLOCK_BYTES,size-position),signal);
    md5.update(block);sha1.update(block);
    if(position<MD5_PREFIX_BYTES)prefix.update(block.subarray(0,Math.min(block.length,MD5_PREFIX_BYTES-position)));
  }
  return{md5:md5.digest('hex'),sha1:sha1.digest('hex'),md5_10m:prefix.digest('hex')};
}

interface UploadPart {index:number;presigned_url:string;block_size:string}
function uploadParts(prepared:any,size:number):{uploadId:string;blockSize:number;parts:UploadPart[]}{
  const blockSize=Number(prepared?.block_size);
  if(typeof prepared?.upload_id!=='string'||!prepared.upload_id||!Number.isSafeInteger(blockSize)||blockSize<=0||!Array.isArray(prepared.parts))throw new Error('QQ_UPLOAD_PREPARE_INVALID');
  const parts=[...prepared.parts].sort((a,b)=>Number(a?.index)-Number(b?.index));
  if(parts.length!==Math.ceil(size/blockSize))throw new Error('QQ_UPLOAD_PARTS_INVALID');
  for(const [index,part] of parts.entries()){
    const expected=Math.min(blockSize,size-index*blockSize);
    if(part?.index!==index||Number(part.block_size)!==expected||typeof part.presigned_url!=='string')throw new Error('QQ_UPLOAD_PARTS_INVALID');
    assertRemoteUrl(part.presigned_url);
  }
  return{uploadId:prepared.upload_id,blockSize,parts};
}

async function putPart(url:string,bytes:Buffer<ArrayBuffer>,signal:AbortSignal,fetcher:typeof fetch):Promise<void>{
  signal.throwIfAborted();let response:Response;
  try{
    // COS pre-signed URLs carry their own authorization. Never forward QQ's token.
    response=await fetcher(url,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length)},body:bytes,signal:AbortSignal.any([signal,AbortSignal.timeout(REQUEST_TIMEOUT)]),redirect:'error'});
  }catch(error){
    signal.throwIfAborted();
    throw new RemoteError('QQ_UPLOAD_PART_NETWORK_FAILED',undefined,errorCauseCode(error));
  }
  await response.body?.cancel();
  if(!response.ok)throw new RemoteError('QQ_UPLOAD_PART_FAILED',response.status);
  signal.throwIfAborted();
}

export async function uploadQQAsset(options:{baseUrl:string;token:string;asset:Asset;signal:AbortSignal;request?:typeof jsonRequest;fetcher?:typeof fetch}):Promise<{fileInfo:string;expiresAt:number}>{
  const {baseUrl,token,asset,signal}=options;const request=options.request??jsonRequest;const fetcher=options.fetcher??fetch;
  signal.throwIfAborted();assertQQUploadSize(asset.kind,asset.size);
  const file=await open(asset.path,'r');
  try{
    const {size}=await file.stat();assertQQUploadSize(asset.kind,size);
    const headers={Authorization:`QQBot ${token}`,'Content-Type':'application/json'};
    const fileName=path.basename(asset.name||asset.path),fileType=qqFileType(asset.kind);
    const post=async(endpoint:string,body:Record<string,unknown>):Promise<any>=>{
      signal.throwIfAborted();const result=await request(`${baseUrl}/${endpoint}`,{method:'POST',headers,body:JSON.stringify(body),signal},REQUEST_TIMEOUT);
      signal.throwIfAborted();assertQQResponse(result,token);return result;
    };
    let result:any;
    if(size<=QQ_MEDIA_LIMITS.directUploadBytes){
      const bytes=await readBlock(file,0,size,signal);
      result=await post('files',{file_type:fileType,file_name:fileName,file_data:bytes.toString('base64'),srv_send_msg:false});
    }else{
      const digest=await hashes(file,size,signal);
      const prepared=await post('upload_prepare',{file_type:fileType,file_size:String(size),file_name:fileName,...digest});
      const {uploadId,blockSize,parts}=uploadParts(prepared,size);
      // One in-flight part stays within the server's concurrency allowance and
      // limits memory to one block. DeliveryWorker owns bounded safe retries.
      for(const part of parts){
        const bytes=await readBlock(file,part.index*blockSize,Number(part.block_size),signal);
        await putPart(part.presigned_url,bytes,signal,fetcher);
        await post('upload_part_finish',{upload_id:uploadId,part_index:part.index,block_size:String(bytes.length),md5:createHash('md5').update(bytes).digest('hex')});
      }
      result=await post('files',{file_type:fileType,file_name:fileName,upload_id:uploadId,srv_send_msg:false});
    }
    if(typeof result?.file_info!=='string'||!result.file_info)throw new Error('QQ_UPLOAD_FAILED');
    const ttl=Number(result.ttl);
    const expiresAt=result.ttl!==undefined&&Number.isFinite(ttl)&&ttl>=0
      ? ttl===0?0:Date.now()+ttl*1000
      : Date.now();
    return{fileInfo:result.file_info,expiresAt};
  }finally{await file.close();}
}
