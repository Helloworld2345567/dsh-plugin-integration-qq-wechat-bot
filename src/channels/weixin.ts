import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import {z} from 'zod';
import { readFile } from 'node:fs/promises';
import JSONbigFactory from 'json-bigint';
import { assertRemoteUrl, backoff, download, jsonRequest, RemoteError } from '../core/network.js';
import type { ChannelAdapter, LoginState, Credential, BotInstance, InboundMessage, MediaInput, Delivery, Asset } from '../core/types.js';
import type {ChannelDefinition} from '../core/channel-registry.js';
import type {CursorStore} from '../core/channel-ports.js';
const BASE='https://ilinkai.weixin.qq.com';const CDN='https://novac2c.cdn.weixin.qq.com/c2c';
const lossless=JSONbigFactory({storeAsString:true,protoAction:'error',constructorAction:'error'});
function ilinkUrl(base:string,endpoint:string):string{const url=new URL(endpoint,base+'/');if(url.protocol!=='https:'||!(url.hostname==='ilinkai.weixin.qq.com'||url.hostname.endsWith('.ilinkai.weixin.qq.com')))throw new Error('INVALID_ILINK_HOST');return url.href;}
const WEIXIN_CDN_HOSTS=new Set(['novac2c.cdn.weixin.qq.com']);
function cdnUrl(url:string):string{const u=assertRemoteUrl(url,{hosts:WEIXIN_CDN_HOSTS,allowQuery:true,allowPorts:new Set([''])});return u.href;}
export function decodeMediaKey(value:string):Buffer{const bytes=Buffer.from(value,'base64');if(bytes.length===16)return bytes;if(bytes.length===32&&/^[a-f0-9]+$/i.test(bytes.toString()))return Buffer.from(bytes.toString(),'hex');throw new Error('INVALID_MEDIA_KEY');}
export function weixinInbound(bot:BotInstance,data:any):InboundMessage|undefined{
  if(data.message_type!==1||data.group_id||!data.from_user_id||!data.message_id)return;
  const attachments:MediaInput[]=[];const texts:string[]=[];
  for(const item of data.item_list??[]){
    if(item.type===1&&item.text_item?.text)texts.push(item.text_item.text);
    const kind=({2:'image',3:'audio',4:'file',5:'video'} as const)[item.type as 2|3|4|5];
    if(kind){const payload=item[`${kind==='audio'?'voice':kind}_item`]??{};const media=payload.media??{};attachments.push({kind,name:payload.file_name??`${kind}.${kind==='image'?'jpg':kind==='video'?'mp4':kind==='audio'?'silk':'bin'}`,mime:kind==='image'?'image/jpeg':kind==='video'?'video/mp4':kind==='audio'?'audio/silk':'application/octet-stream',transcript:payload.text,remote:{query:media.encrypt_query_param,key:payload.aeskey?Buffer.from(payload.aeskey,'hex').toString('base64'):media.aes_key,fullUrl:media.full_url}});}
  }
  const quoted=(data.item_list??[]).find((i:any)=>i.ref_msg)?.ref_msg;
  return{id:String(data.message_id),scope:{botId:bot.id,platform:'weixin',accountId:bot.accountId,kind:'private',channelId:String(data.from_user_id),senderId:String(data.from_user_id)},text:texts.join('\n'),attachments,quoted:quoted?{id:quoted.svr_id?String(quoted.svr_id):undefined,text:quoted.message_item?.text_item?.text??quoted.title}:undefined,reply:{target:String(data.from_user_id),contextToken:String(data.context_token??'')},timestamp:Date.now()};
}
export class WeixinAdapter implements ChannelAdapter{
  constructor(readonly cursors:CursorStore,readonly request:typeof jsonRequest=jsonRequest,readonly fetcher:typeof fetch=fetch){}
  private async api(credential:Credential,endpoint:string,body:unknown,signal:AbortSignal,timeout=20000):Promise<any>{
    const headers={'Content-Type':'application/json',AuthorizationType:'ilink_bot_token',Authorization:`Bearer ${credential.token??''}`,'X-WECHAT-UIN':Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'),'iLink-App-Id':'bot','iLink-App-ClientVersion':'256'};
    const response=await this.fetcher(ilinkUrl(credential.baseUrl??BASE,endpoint),{method:'POST',headers,body:JSON.stringify({...body as object,base_info:{channel_version:'0.1.0',bot_agent:'HarnessBot/0.1.0'}}),signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)]),redirect:'error'});
    if(!response.ok)throw new RemoteError('ILINK_REQUEST_FAILED',response.status);const raw=await response.text();if(raw.length>4*1024*1024)throw new Error('ILINK_RESPONSE_TOO_LARGE');const data=lossless.parse(raw);if(data.ret||data.errcode)throw new Error(Number(data.errcode)===-14||Number(data.ret)===-14?'ILINK_AUTH_EXPIRED':'ILINK_API_REJECTED');return data;
  }
  async beginLogin(signal?:AbortSignal):Promise<LoginState>{const result:any=await this.request(`${BASE}/ilink/bot/get_bot_qrcode?bot_type=3`,{signal});if(!result.qrcode||!result.qrcode_img_content)throw new Error('ILINK_QR_INVALID_RESPONSE');return{status:'pending',ticket:result.qrcode,qr:result.qrcode_img_content};}
  async pollLogin(ticket:string,signal?:AbortSignal):Promise<LoginState>{const data:any=await this.request(`${BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(ticket)}`,{headers:{'iLink-App-ClientVersion':'1'},signal},40000);if(data.status==='confirmed'){if(!data.bot_token||!data.ilink_bot_id)throw new Error('ILINK_CREDENTIAL_MISSING');ilinkUrl(data.baseurl??BASE,'ilink/bot/getupdates');return{status:'confirmed',credential:{accountId:data.ilink_bot_id,token:data.bot_token,baseUrl:data.baseurl??BASE}};}return{status:data.status==='expired'?'expired':['cancel','canceled','denied'].includes(data.status)?'denied':'pending'};}
  async connect(bot:BotInstance,credential:Credential,receive:(message:InboundMessage)=>Promise<void>,signal:AbortSignal,status:(state:string)=>void):Promise<void>{
    let attempt=0;const saved=this.cursors.read('weixin',bot.id);if(saved!==undefined&&typeof saved!=='string')throw Error('INVALID_WEIXIN_CURSOR');let cursor=saved??'';status('connecting');
    while(!signal.aborted){try{
      const data=await this.api(credential,'ilink/bot/getupdates',{get_updates_buf:cursor},signal,40000);
      attempt=0;status('connected');
      for(const raw of data.msgs??[]){const message=weixinInbound(bot,raw);if(message)await receive(message);}
      if(typeof data.get_updates_buf==='string'){cursor=data.get_updates_buf;this.cursors.write('weixin',bot.id,cursor);}
    }catch(error){if(signal.aborted)break;if(error instanceof Error&&error.message==='ILINK_AUTH_EXPIRED'){status('reauthorize');return;}status(`reconnecting: ${error instanceof Error?error.message:'ILINK_CONNECTION_FAILED'}`);await backoff(attempt++,signal).catch(()=>{});}}
    status('stopped');
  }
  async materialize(input:MediaInput,signal:AbortSignal):Promise<Buffer>{if(!input.remote)throw new Error('ILINK_MEDIA_MISSING');const url=cdnUrl(input.remote.fullUrl??`${CDN}/download?encrypted_query_param=${encodeURIComponent(input.remote.query??'')}`);const bytes=await download(url,signal,50*1024*1024,0,{hosts:WEIXIN_CDN_HOSTS,allowQuery:true,allowPorts:new Set([''])});if(!input.remote.key)return bytes;const decipher=createDecipheriv('aes-128-ecb',decodeMediaKey(input.remote.key),null);return Buffer.concat([decipher.update(bytes),decipher.final()]);}
  async send(_bot:BotInstance,credential:Credential,delivery:Delivery,asset:Asset|undefined,signal:AbortSignal):Promise<string>{
    if(!delivery.reply.contextToken)throw new Error('ILINK_REPLY_CONTEXT_MISSING');
    let item:any={type:1,text_item:{text:delivery.output.text??''}};
    if(asset){
      const data=await readFile(asset.path);if(data.length>20*1024*1024)throw new Error('ILINK_OUTPUT_TOO_LARGE');const key=randomBytes(16);const filekey=randomBytes(16).toString('hex');const cipher=createCipheriv('aes-128-ecb',key,null);const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);const isImage=asset.kind==='image';const isVideo=asset.kind==='video';
      const info=await this.api(credential,'ilink/bot/getuploadurl',{filekey,media_type:isImage?1:isVideo?2:3,to_user_id:delivery.reply.target,rawsize:data.length,rawfilemd5:createHash('md5').update(data).digest('hex'),filesize:encrypted.length,no_need_thumb:true,aeskey:key.toString('hex')},signal);
      const url=cdnUrl(info.upload_full_url??`${CDN}/upload?encrypted_query_param=${encodeURIComponent(info.upload_param)}&filekey=${filekey}`);
      const uploaded=await this.fetcher(url,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array(encrypted),signal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),redirect:'error'});
      if(!uploaded.ok)throw new RemoteError('ILINK_CDN_UPLOAD_FAILED',uploaded.status);const query=uploaded.headers.get('x-encrypted-param');if(!query)throw new Error('ILINK_UPLOAD_RECEIPT_MISSING');
      const media={encrypt_query_param:query,aes_key:Buffer.from(key.toString('hex')).toString('base64'),encrypt_type:1};
      item=isImage?{type:2,image_item:{media,mid_size:encrypted.length}}:isVideo?{type:5,video_item:{media,video_size:encrypted.length}}:{type:4,file_item:{media,file_name:asset.name,len:String(data.length)}};
    }
    const response=await this.api(credential,'ilink/bot/sendmessage',{msg:{from_user_id:'',to_user_id:delivery.reply.target,client_id:delivery.id,message_type:2,message_state:2,item_list:[item],context_token:delivery.reply.contextToken}},signal);
    if(response.message_id)return String(response.message_id);
    if(response.ret===0)return `ilink-accepted:${delivery.id}`;
    throw new Error('ILINK_SEND_RECEIPT_MISSING');
  }
}
const weixinCredential=z.object({accountId:z.string().min(1).max(200),token:z.string().min(1).max(2000),baseUrl:z.string().url().max(2000).optional()}).strict();const weixinReply=z.object({target:z.string().min(1).max(4096),contextToken:z.string().min(1).max(4096)}).strict();
export function weixinChannel(adapter:WeixinAdapter):ChannelDefinition{return{id:'weixin',displayName:'微信 iLink',adapter,capabilities:{conversations:['private'],login:['qr'],groupSupport:'unsupported'},normalizeCredential:value=>{const credential=weixinCredential.parse(value);ilinkUrl(credential.baseUrl??BASE,'ilink/bot/getupdates');return{accountId:credential.accountId,credential};},normalizeReply:value=>{const candidate=value as any;if(candidate?.channelId==='weixin'&&candidate.version===1)return{channelId:'weixin',version:1,payload:weixinReply.parse(candidate.payload)};return{channelId:'weixin',version:1,payload:weixinReply.parse(value)};}};}
