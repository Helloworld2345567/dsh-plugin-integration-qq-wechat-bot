import { randomBytes, createDecipheriv } from 'node:crypto';
import {z} from 'zod';
import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { backoff, download, jsonRequest, RemoteError } from '../core/network.js';
import type { ChannelAdapter, LoginState, Credential, BotInstance, InboundMessage, MediaInput, Delivery, Asset } from '../core/types.js';
import type {ChannelDefinition} from '../core/channel-registry.js';
import type {ChannelEvent,ChannelEventSink} from '../core/channel-ports.js';

const API='https://api.sgroup.qq.com';
const QQ_ATTACHMENT_HOSTS=new Set(['multimedia.nt.qq.com.cn']);
export function decryptBinding(encoded:string,key:string):string { const raw=Buffer.from(encoded,'base64');if(raw.length<=28)throw new Error('INVALID_BINDING_CREDENTIAL');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'base64'),raw.subarray(0,12));decipher.setAuthTag(raw.subarray(-16));return Buffer.concat([decipher.update(raw.subarray(12,-16)),decipher.final()]).toString('utf8'); }
export function qqInbound(bot:BotInstance,event:any):InboundMessage|undefined {
  if(!['C2C_MESSAGE_CREATE','GROUP_AT_MESSAGE_CREATE'].includes(event.t))return;
  const data=event.d;if(!data)return;const group=event.t==='GROUP_AT_MESSAGE_CREATE'; const sender=String(data.author?.user_openid??data.author?.member_openid??data.author?.id??'');if(!sender||!data.id||(group&&!data.group_openid))return;
  const attachments:MediaInput[]=(data.attachments??[]).map((a:any)=>{const mime=String(a.content_type??'application/octet-stream');return {name:String(a.filename??'attachment.bin'),mime,kind:mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'file',url:String(a.url).startsWith('//')?`https:${a.url}`:a.url};});
  return {id:String(data.id),scope:{botId:bot.id,platform:'qq',accountId:bot.accountId,kind:group?'group':'private',channelId:group?String(data.group_openid):sender,senderId:sender},text:String(data.content??'').replace(/<@!?\d+>/g,'').trim(),attachments,quoted:data.message_reference?{id:String(data.message_reference.message_id)}:undefined,reply:{target:group?String(data.group_openid):sender,kind:group?'group':'private',msgId:String(data.id)},timestamp:Date.now()};
}
export function qqGroupObservation(bot:BotInstance,event:any):ChannelEvent|undefined{
  if(!['GROUP_AT_MESSAGE_CREATE','GROUP_ADD_ROBOT','GROUP_DEL_ROBOT'].includes(event?.t)||!event.d)return;
  const data=event.d;const groupId=data.group_openid??data.group_id??data.group?.id;if(typeof groupId!=='string'||!groupId)return;
  const rawTime=data.timestamp;const parsed=typeof rawTime==='number'?(rawTime<1e12?rawTime*1000:rawTime):typeof rawTime==='string'?Date.parse(rawTime):NaN;
  return{type:event.t==='GROUP_ADD_ROBOT'?'group.joined':event.t==='GROUP_DEL_ROBOT'?'group.left':'group.observed',channelId:'qq',botId:bot.id,groupId,name:typeof data.group_name==='string'?data.group_name:typeof data.group?.name==='string'?data.group.name:undefined,at:Number.isFinite(parsed)&&parsed>0?parsed:Date.now(),eventId:typeof data.id==='string'?data.id:typeof event.id==='string'?event.id:undefined};
}
export class QQAdapter implements ChannelAdapter {
  private readonly logins=new Map<string,{key:string;expires:number}>();
  private readonly tokens=new Map<string,{value:string;expires:number}>();
  constructor(readonly request:typeof jsonRequest=jsonRequest,readonly events?:ChannelEventSink,readonly socketFactory:(url:string)=>WebSocket=url=>new WebSocket(url)){}
  async beginLogin(signal?:AbortSignal):Promise<LoginState>{
    for(const [ticket,pending] of this.logins)if(pending.expires<Date.now())this.logins.delete(ticket);
    const key=randomBytes(32).toString('base64');const result:any=await this.request('https://q.qq.com/lite/create_bind_task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key}),signal});
    if(result.retcode && result.retcode!==0)throw new Error('QQ_BINDING_REJECTED');const id=result.data?.task_id;if(!id)throw new Error('QQ_BINDING_INVALID_RESPONSE');this.logins.set(id,{key,expires:Date.now()+300000});return {status:'pending',ticket:id,qr:`https://q.qq.com/qqbot/openclaw/connect.html?task_id=${encodeURIComponent(id)}&_wv=2`};
  }
  async pollLogin(ticket:string,signal?:AbortSignal):Promise<LoginState>{
    const pending=this.logins.get(ticket);if(!pending||pending.expires<Date.now()){this.logins.delete(ticket);return{status:'expired'};}
    const result:any=await this.request('https://q.qq.com/lite/poll_bind_result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task_id:ticket}),signal});
    if(result.retcode&&result.retcode!==0)throw new Error('QQ_BINDING_REJECTED');
    const data=result.data??{};if(data.status===3){this.logins.delete(ticket);return{status:'expired'};}if(data.status!==2)return{status:'pending'};
    if(!data.bot_appid||!data.bot_encrypt_secret)throw new Error('QQ_BINDING_MISSING_CREDENTIAL');const credential={accountId:String(data.bot_appid),appSecret:decryptBinding(data.bot_encrypt_secret,pending.key)};this.logins.delete(ticket);return{status:'confirmed',credential};
  }
  private async token(credential:Credential,signal:AbortSignal):Promise<string>{
    const existing=this.tokens.get(credential.accountId);if(existing&&existing.expires>Date.now())return existing.value;
    if(!credential.appSecret)throw new Error('QQ_CREDENTIAL_MISSING');
    const data:any=await this.request('https://bots.qq.com/app/getAppAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appId:credential.accountId,clientSecret:credential.appSecret}),signal});
    if(!data.access_token)throw new Error('QQ_TOKEN_REJECTED');this.tokens.set(credential.accountId,{value:data.access_token,expires:Date.now()+Math.max(1,Number(data.expires_in)-60)*1000});return data.access_token;
  }
  async connect(bot:BotInstance,credential:Credential,receive:(message:InboundMessage)=>Promise<void>,signal:AbortSignal,status:(state:string)=>void):Promise<void>{
    let attempt=0;let sessionId='';let sequence:number|undefined;
    while(!signal.aborted){try{
      status('connecting');const token=await this.token(credential,signal);const gateway:any=await this.request(`${API}/gateway/bot`,{headers:{Authorization:`QQBot ${token}`},signal});if(!gateway.url)throw new Error('QQ_GATEWAY_MISSING');
      await new Promise<void>((resolve,reject)=>{
        const socket=this.socketFactory(gateway.url);let heartbeat:ReturnType<typeof setInterval>|undefined;let completed=false;let awaitingHeartbeat=false;let ready=false;
        const abort=()=>{socket.terminate();finish();};signal.addEventListener('abort',abort,{once:true});
        const finish=(error?:Error)=>{if(completed)return;completed=true;if(heartbeat)clearInterval(heartbeat);signal.removeEventListener('abort',abort);status(signal.aborted?'stopped':'reconnecting');error?reject(error):resolve();};
        socket.on('message',raw=>{try{const event=JSON.parse(String(raw));if(typeof event.s==='number')sequence=event.s;
          if(event.op===10){const interval=Number(event.d?.heartbeat_interval);if(!Number.isFinite(interval)||interval<=0)throw new Error('QQ_HEARTBEAT_INVALID');if(heartbeat)clearInterval(heartbeat);heartbeat=setInterval(()=>{if(awaitingHeartbeat){socket.terminate();finish(new Error('QQ_HEARTBEAT_TIMEOUT'));return;}if(socket.readyState===WebSocket.OPEN){awaitingHeartbeat=true;socket.send(JSON.stringify({op:1,d:sequence??null}));}},interval);socket.send(JSON.stringify(sessionId?{op:6,d:{token:`QQBot ${token}`,session_id:sessionId,seq:sequence}}:{op:2,d:{token:`QQBot ${token}`,intents:(1<<25),shard:[0,1],properties:{os:process.platform,browser:'Harness',device:'Harness'}}}));}
          if(event.op===11){awaitingHeartbeat=false;if(ready)status('connected');}
          if(event.t==='READY'){sessionId=event.d.session_id;attempt=0;ready=true;status('connected');}
          if(event.t==='RESUMED'){attempt=0;ready=true;status('connected');}
          if(event.op===7)socket.close();if(event.op===9){sessionId='';sequence=undefined;socket.close();}
          const observation=qqGroupObservation(bot,event);if(observation){try{this.events?.emit(observation);}catch{status('channel_event_error');}}
          const message=qqInbound(bot,event);if(message)void receive(message).catch(()=>status('inbound_error'));
        }catch{status('invalid_event');}});
        socket.on('error',()=>{socket.close();finish(new Error('QQ_WEBSOCKET_ERROR'));});socket.on('close',()=>finish());
        if(signal.aborted)abort();
      });
    }catch(error){if(!signal.aborted){this.tokens.delete(credential.accountId);status(`reconnecting: ${error instanceof Error?error.message:'QQ_CONNECTION_FAILED'}`);}}if(!signal.aborted)await backoff(attempt++,signal).catch(()=>{});}
    status('stopped');
  }
  async materialize(input:MediaInput,signal:AbortSignal):Promise<Buffer>{if(!input.url)throw new Error('QQ_MEDIA_URL_MISSING');const url=new URL(input.url);if(!QQ_ATTACHMENT_HOSTS.has(url.hostname.toLowerCase()))throw new Error('QQ_MEDIA_HOST_NOT_ALLOWED');return download(url.href,signal,50*1024*1024,0,{hosts:QQ_ATTACHMENT_HOSTS,allowQuery:true,allowPorts:new Set([''])});}
  async send(_bot:BotInstance,credential:Credential,delivery:Delivery,asset:Asset|undefined,signal:AbortSignal):Promise<string>{
    const token=await this.token(credential,signal);const headers={Authorization:`QQBot ${token}`,'Content-Type':'application/json'};const base=delivery.reply.kind==='group'?`groups/${encodeURIComponent(delivery.reply.target)}`:`users/${encodeURIComponent(delivery.reply.target)}`;
    let payload:any={content:delivery.output.text??'',msg_type:0,msg_id:delivery.reply.msgId,msg_seq:delivery.index+1};
    if(asset){
      if(asset.size>20*1024*1024)throw new Error('QQ_OUTPUT_TOO_LARGE');const attempt=delivery.attempt;let fileInfo=attempt?.assetId===asset.id?attempt.fileInfo:undefined;
      if(!fileInfo){
        if(attempt)attempt.phase='upload';
        const uploaded:any=await this.request(`${API}/v2/${base}/files`,{method:'POST',headers,body:JSON.stringify({file_type:asset.kind==='image'?1:asset.kind==='video'?2:asset.kind==='audio'?3:4,file_data:(await readFile(asset.path)).toString('base64'),srv_send_msg:false}),signal},60000);if(!uploaded.file_info)throw new Error('QQ_UPLOAD_FAILED');fileInfo=String(uploaded.file_info);if(attempt)attempt.fileInfo=fileInfo;
      }
      if(attempt)attempt.phase='commit';payload={...payload,msg_type:7,media:{file_info:fileInfo}};
    }
    if(delivery.attempt)delivery.attempt.phase='commit';
    const result:any=await this.request(`${API}/v2/${base}/messages`,{method:'POST',headers,body:JSON.stringify(payload),signal});if(!result.id)throw new RemoteError('QQ_SEND_RECEIPT_MISSING');return String(result.id);
  }
}
const qqCredential=z.object({accountId:z.string().min(1).max(200),appSecret:z.string().min(1).max(500)}).strict();const qqReply=z.object({target:z.string().min(1).max(4096),kind:z.enum(['private','group']),msgId:z.string().min(1).max(4096)}).strict();
export function qqChannel(adapter:QQAdapter):ChannelDefinition{return{id:'qq',displayName:'QQ 官方',adapter,capabilities:{conversations:['private','group'],login:['qr','credentials'],groupSupport:'observed_only'},normalizeCredential:value=>{const credential=qqCredential.parse(value);return{accountId:credential.accountId,credential};},normalizeReply:value=>{const candidate=value as any;if(candidate?.channelId==='qq'&&candidate.version===1)return{channelId:'qq',version:1,payload:qqReply.parse(candidate.payload)};return{channelId:'qq',version:1,payload:qqReply.parse(value)};}};}
