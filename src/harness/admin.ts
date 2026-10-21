import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import QRCode from 'qrcode';
import type { Context } from '@deepseek-ai/cordis';
import type { BotRuntime } from '../core/runtime.js';
import { ConflictError } from '../core/store.js';
import type { BotInstance, LoginState } from '../core/types.js';
import type {} from '@deepseek-ai/dsh-session-query';
import { SessionId } from '@deepseek-ai/dsh-session';
import {resolveImageSkill,imageSkillEnabled} from '../core/image-skill.js';

export class Admin {
  readonly attempts=new Map<string,{botId:string;ticket:string;expires:number}>();
  constructor(readonly ctx:Context,readonly runtime:BotRuntime,readonly token:string){}
  async invoke(action:string,input:any):Promise<unknown>{
    const {store}=this.runtime;
    switch(action){
      case 'state':return{configs:store.configs(),bots:await Promise.all(store.bots().map(async b=>({...b,status:this.runtime.states.get(b.id)??'stopped',activeSessions:this.runtime.activeSessions(b.id),credentialConfigured:!!await this.runtime.credentials.read(b.id)}))),sessions:store.list<any>('binding').map(binding=>{const snapshot=store.get<any>('turn-snapshot',binding.sessionId);return {...binding,turn:snapshot?{configId:snapshot.config.id,revision:snapshot.config.revision,startedAt:snapshot.startedAt}:null};}),jobs:store.list('job'),failures:store.list('failure'),deliveries:store.deliveries().slice(-200).map(({reply,...delivery})=>delivery),versions:store.list('config-version')};
      case 'models':return Promise.all(this.ctx.llm.listProviders().map(async p=>({id:p.id,models:(await this.ctx.llm.listModels(p.id)).map(m=>({id:m.id,name:m.name}))})));
      case 'skill.image.status':return Object.fromEntries(store.configs().map(config=>{try{const endpoint=resolveImageSkill(config);return [config.id,{enabled:imageSkillEnabled(config),model:endpoint.model,keyEnv:endpoint.keyEnv,keyConfigured:!!process.env[endpoint.keyEnv],overridden:!!(config.media.image?.baseUrl||config.media.image?.model||config.media.image?.keyEnv)}];}catch(error){return [config.id,{enabled:false,error:error instanceof Error?error.message:'IMAGE_SKILL_CONFIGURATION_INVALID'}];}}));
      case 'skill.media.status':return Object.fromEntries(await Promise.all(store.configs().map(async config=>[config.id,Object.fromEntries(await Promise.all((['asr','video'] as const).map(async role=>[role,await this.runtime.media.analysisStatus(config,role)])))])));
      case 'capability.list':return store.list('capability-status');
      case 'capability.record':{const value=z.object({configId:z.string(),revision:z.number().int(),role:z.enum(['image','asr','video']),status:z.enum(['PASS','FAIL','BLOCKED','NOT_RUN']),evidence:z.string().min(1).max(2000)}).parse(input);const config=store.config(value.configId);if(config.revision!==value.revision)throw new ConflictError('配置已变化，请针对当前版本重新验收');const record={...value,updatedAt:Date.now(),source:'operator'};store.put('capability-status',`${value.configId}:${value.revision}:${value.role}`,record);return record;}
      case 'config.save':return this.runtime.saveConfig(input.config,input.expectedRevision);
      case 'config.copy':{const original=store.config(z.string().parse(input.id));return this.runtime.saveConfig({...original,id:z.string().parse(input.newId),name:z.string().parse(input.name),revision:1});}
      case 'bot.save':{const bot=this.runtime.saveBot(input);if(!bot.enabled||bot.archived)await this.runtime.stop(bot.id);return bot;}
      case 'bot.start':await this.runtime.start(z.string().parse(input.id));return{ok:true};
      case 'bot.stop':await this.runtime.stop(z.string().parse(input.id));return{ok:true};
      case 'bot.reconnect':await this.runtime.stop(z.string().parse(input.id));await this.runtime.start(input.id);return{ok:true};
      case 'bot.credentials':{
        const bot=store.bot(z.string().parse(input.id));if(bot.enabled)throw new Error('请先停止机器人再更换授权');
        if(bot.channel!=='qq')throw new Error('微信请使用扫码授权');const credential=z.object({accountId:z.string().min(1),appSecret:z.string().min(1)}).parse(input.credential);
        store.saveBot({...bot,accountId:credential.accountId});await this.runtime.credentials.write(bot.id,credential);return{configured:true};
      }
      case 'login.begin':{
        for(const [id,value] of this.attempts)if(value.expires<Date.now())this.attempts.delete(id);
        if(this.attempts.size>=20)throw new Error('LOGIN_ATTEMPT_LIMIT');
        const bot=store.bot(z.string().parse(input.id));if(bot.enabled)throw new Error('请先停止机器人再重新授权');
        const state=await this.runtime.adapters[bot.channel].beginLogin(AbortSignal.timeout(20000));if(!state.ticket||!state.qr)throw new Error('QR_RESPONSE_MISSING');
        const attempt=randomUUID();this.attempts.set(attempt,{botId:bot.id,ticket:state.ticket,expires:Date.now()+300000});
        const qrImage=state.qr.startsWith('data:image/')?state.qr:await QRCode.toDataURL(state.qr,{width:280,margin:2});
        return{status:state.status,attempt,qrImage,expiresAt:Date.now()+300000};
      }
      case 'login.poll':{
        const attempt=this.attempts.get(z.string().parse(input.attempt));if(!attempt||attempt.expires<Date.now())return{status:'expired'};
        const bot=store.bot(attempt.botId);const result=await this.runtime.adapters[bot.channel].pollLogin(attempt.ticket,AbortSignal.timeout(42000));
        if(bot.enabled||bot.archived)throw new Error('机器人状态已改变，请停止后重新扫码');
        if(result.status==='confirmed'&&result.credential){store.saveBot({...bot,accountId:result.credential.accountId});await this.runtime.credentials.write(bot.id,result.credential);this.attempts.delete(input.attempt);return{status:'confirmed',accountId:result.credential.accountId};}
        if(result.status!=='pending')this.attempts.delete(input.attempt);return{status:result.status};
      }
      case 'memory.list':return store.memories(z.string().parse(input.scope));
      case 'session.history':{
        const id=z.string().parse(input.id);if(!store.list<any>('binding').some(b=>b.sessionId===id))throw new Error('会话不属于机器人集成');
        const log=await this.ctx.sessionQuery.readSession(SessionId(id));return log.events.filter(e=>['user/message','assistant/message','tool/result','turn/start','turn/end','request/header'].includes(e.type)).slice(-200).map(e=>e.type==='assistant/message'?{...e,data:{...e.data,message:{...e.data.message,content:e.data.message.content.filter(b=>b.type!=='reasoning')}}}:e);
      }
      case 'memory.forget':store.forget(z.string().parse(input.scope),z.string().parse(input.key));return{ok:true};
      case 'memory.correct':{
        const value=z.object({scope:z.string(),key:z.string().max(100),value:z.string().min(1).max(500),version:z.number().int()}).parse(input);
        store.correctMemory(value.scope,value.key,value.value,value.version);return{ok:true};
      }
      case 'session.cancel':{const id=z.string().parse(input.id);const binding=store.list<any>('binding').find(b=>b.sessionId===id);if(!binding)throw new Error('会话不存在');await this.runtime.receive({id:randomUUID(),scope:binding.scope,text:'/stop',attachments:[],reply:{},timestamp:Date.now()});return{ok:true};}
      default:throw new Error('UNKNOWN_ADMIN_ACTION');
    }
  }
  async http(req:IncomingMessage,res:ServerResponse):Promise<void>{
    const answer=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    const loopback=(value?:string)=>!!value&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(value);
    if(!loopback(req.socket.remoteAddress)||!loopback(req.socket.localAddress)||req.headers.authorization!==`Bearer ${this.token}`){answer(403,{error:'ADMIN_AUTH_REQUIRED'});return;}
    if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')){answer(405,{error:'JSON_POST_REQUIRED'});return;}
    const origin=req.headers.origin;if(origin){try{const o=new URL(origin);if(o.host!==req.headers.host||!['http:','https:'].includes(o.protocol))throw new Error();}catch{answer(403,{error:'ORIGIN_REJECTED'});return;}}
    try{let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('REQUEST_TOO_LARGE');chunks.push(chunk);}const body=z.object({action:z.string().max(100),input:z.unknown().default({})}).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));answer(200,{result:await this.invoke(body.action,body.input)});}catch(error){answer(error instanceof ConflictError?409:400,{error:error instanceof Error?error.message:'ADMIN_REQUEST_FAILED'});}
  }
}
