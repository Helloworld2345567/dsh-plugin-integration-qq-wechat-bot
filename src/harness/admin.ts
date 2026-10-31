import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import QRCode from 'qrcode';
import type { Context } from '@deepseek-ai/cordis';
import type { BotRuntime } from '../core/runtime.js';
import { ConflictError } from '../core/store.js';
import type { Delivery } from '../core/types.js';
import type {} from '@deepseek-ai/dsh-session-query';
import { SessionId } from '@deepseek-ai/dsh-session';
import {resolveImageSkill,imageSkillEnabled} from '../core/image-skill.js';
import {defaultWorkspaceRoot,workingDirectory} from '../core/workspaces.js';
import {openDirectory} from './open-directory.js';
import type {BotFeatures} from '../core/features.js';
import {adminCommandRequestSchema,adminQueryRequestSchema,type AdminSummaryData,versioned,ADMIN_CONTRACT_VERSION} from './admin-contract.js';

function publicDelivery(delivery:Delivery):Omit<Delivery,'reply'|'replyEnvelope'> & {attempt?:Pick<NonNullable<Delivery['attempt']>,'number'|'phase'|'assetId'|'startedAt'|'lastError'|'causeCode'|'causeMessage'|'autoRetryCount'>} {
  const {reply:_reply,replyEnvelope:_replyEnvelope,attempt,...rest}=delivery;
  return {...rest,...attempt?{attempt:{number:attempt.number,phase:attempt.phase,assetId:attempt.assetId,startedAt:attempt.startedAt,lastError:attempt.lastError,causeCode:attempt.causeCode,causeMessage:attempt.causeMessage,autoRetryCount:attempt.autoRetryCount}}:{}};
}

export class Admin {
  readonly attempts=new Map<string,{botId:string;ticket:string;expires:number}>();
  constructor(readonly ctx:Context,readonly runtime:BotRuntime,readonly token:string,readonly revealDirectory:(directory:string)=>Promise<void>=openDirectory,readonly features?:BotFeatures){}
  private async summary():Promise<AdminSummaryData> {
    const {store}=this.runtime;const configs=store.configs().map(config=>({id:config.id,name:config.name,revision:config.revision,archived:config.archived,model:config.model?{provider:config.model.provider,model:config.model.model}:null,toolCount:config.tools.length,skillCount:config.skills.length,allowHostTools:config.allowHostTools,voice:config.media.voice?{enabled:config.media.voice.enabled,protocol:config.media.voice.protocol,replyMode:config.media.voice.replyMode,provider:config.media.voice.protocol==='gpt_sovits'?'gpt_sovits':config.media.voice.provider,model:config.media.voice.protocol==='gpt_sovits'?config.media.voice.gptSovits?.modelVersion:config.media.voice.model,voice:config.media.voice.voice,format:config.media.voice.format}:null}));
    const bots=await Promise.all(store.bots().map(async bot=>({id:bot.id,name:bot.name,channel:bot.channel,accountId:bot.accountId,configId:bot.configId,enabled:bot.enabled,archived:bot.archived,status:this.runtime.states.get(bot.id)??'stopped',activeSessions:this.runtime.activeSessions(bot.id),credentialConfigured:!!await this.runtime.credentials.read(bot.id),trustedUserCount:bot.trustedUsers.length,workspaceConfigured:!!bot.workingDirectory})));
    const health=this.runtime.health();const evolution=this.features?.history()[0];
    const channels=this.runtime.channels?.list?.().map(({id,displayName,capabilities})=>({id,displayName,capabilities}))??[];
    return{channels,bots,configs,counts:{bots:bots.filter(bot=>!bot.archived).length,configs:configs.filter(config=>!config.archived).length,sessions:store.recordCount('binding'),jobs:store.recordCount('job'),failures:store.recordCount('failure'),pendingDeliveries:health.pendingDeliveries,pendingSessionActions:health.pendingSessionActions},health,evolution:evolution?{id:evolution.id,phase:evolution.phase,updatedAt:evolution.updatedAt}:null};
  }
  async query(request:unknown):Promise<unknown> {
    const value=adminQueryRequestSchema.parse(request);
    if(value.name==='overview.summary')return versioned(await this.summary(),value.input.changedSince);
    const {store}=this.runtime;
    if(value.name==='catalog.config'){const config=store.config(value.input.id);return versioned(config,value.input.changedSince);}
    if(value.name==='bots.list'){const bots=await Promise.all(store.bots().map(async bot=>({...bot,status:this.runtime.states.get(bot.id)??'stopped',activeSessions:this.runtime.activeSessions(bot.id),credentialConfigured:!!await this.runtime.credentials.read(bot.id)})));return versioned(bots,value.input.changedSince);}
    if(value.name==='overview.sessions'){const page=store.pageSessions({},value.input.limit,value.input.cursor);return{...page,contractVersion:ADMIN_CONTRACT_VERSION,items:page.items.map(row=>({id:row.id,scopeKey:row.scopeKey,botId:row.scope.botId,platform:row.scope.platform,kind:row.scope.kind,channelId:row.scope.channelId,senderId:row.scope.senderId,generation:row.generation,persisted:row.persisted,createdAt:row.createdAt,updatedAt:row.updatedAt,personaId:row.personaId})),hasMore:page.nextCursor!==null};}
    if(value.name==='automation.list')return versioned({scopes:store.bindings().filter(binding=>binding.scope.kind==='private').map(binding=>({scopeKey:binding.key,botId:binding.scope.botId,configId:store.bot(binding.scope.botId).configId,channelId:binding.scope.channelId,senderId:binding.scope.senderId})),proactive:this.runtime.automation.listProactive(),scheduled:this.runtime.automation.listJobs()},value.input.changedSince);
    const page=store.deliveryRepository().pageDeliveries({filter:{scopeKey:value.input.scopeKey},limit:value.input.limit,cursor:value.input.cursor});return{...page,contractVersion:ADMIN_CONTRACT_VERSION,items:page.items.map((row:Delivery)=>publicDelivery(row)),hasMore:page.nextCursor!==null};
  }
  async command(request:unknown):Promise<unknown>{const value=adminCommandRequestSchema.parse(request);return this.invoke(value.name,value.input);}
  async invoke(action:string,input:any):Promise<unknown>{
    const {store}=this.runtime;
    switch(action){
      case 'stats.query':if(!this.features)throw Error('STATS_UNAVAILABLE');return this.features.stats.query(input);
      case 'evolution.list':return this.features?.history()??[];
      case 'skills.list':{if(!this.features)throw Error('SKILLS_UNAVAILABLE');return this.features.skills.list(store.config(z.string().parse(input.id)));}
      case 'state':return{configs:store.configs(),bots:await Promise.all(store.bots().map(async b=>({...b,status:this.runtime.states.get(b.id)??'stopped',activeSessions:this.runtime.activeSessions(b.id),credentialConfigured:!!await this.runtime.credentials.read(b.id)}))),sessions:store.bindings().map(binding=>{const snapshot=store.findTurnSnapshot(binding.sessionId);return {...binding,turn:snapshot?{configId:snapshot.config.id,revision:snapshot.config.revision,startedAt:snapshot.startedAt}:null};}),jobs:store.jobs(),failures:store.failures(),deliveries:store.deliveries().slice(-200).map(publicDelivery),versions:store.configVersions()};
      case 'automation.proactive':{const value=z.object({scopeKey:z.string(),action:z.enum(['on','off','status','now','set']),args:z.string().default('')}).parse(input);const binding=store.findBinding(value.scopeKey);if(!binding)throw Error('会话不存在');return this.runtime.commandServices.automation!.proactive(binding,value.action,value.args);}
      case 'automation.schedule':{const value=z.object({scopeKey:z.string(),action:z.enum(['list','create','pause','resume','run','delete']),args:z.string().default('')}).parse(input);const binding=store.findBinding(value.scopeKey);if(!binding)throw Error('会话不存在');return this.runtime.commandServices.automation!.schedule(binding,value.action,value.args);}
      case 'models':return Promise.all(this.ctx.llm.listProviders().map(async p=>({id:p.id,models:(await this.ctx.llm.listModels(p.id)).map(m=>({id:m.id,name:m.name}))})));
      case 'directories':return{workspaceRoot:defaultWorkspaceRoot(),configDirectory:store.personaRoot(),storageDirectory:store.storageHome(),personas:store.configs().map(c=>store.personaStatus(c.id)),sessions:store.bindings().map(binding=>({sessionId:binding.sessionId,botId:binding.scope.botId,directory:workingDirectory(store.bot(binding.scope.botId),binding.key)}))};
      case 'config.directory.open':{const value=z.object({botId:z.string().optional(),configId:z.string().optional()}).strict().parse(input);const configId=value.configId??(value.botId?store.bot(value.botId).configId:undefined);if(value.botId)store.bot(value.botId);if(configId)store.config(configId);const directory=store.personaDirectory(configId);await this.revealDirectory(directory);return{opened:true,directory};}
      case 'skill.image.status':return Object.fromEntries(store.configs().map(config=>{try{const endpoint=resolveImageSkill(config);return [config.id,{enabled:imageSkillEnabled(config),model:endpoint.model,keyEnv:endpoint.keyEnv,keyConfigured:!!process.env[endpoint.keyEnv],overridden:!!(config.media.image?.baseUrl||config.media.image?.model||config.media.image?.keyEnv)}];}catch(error){return [config.id,{enabled:false,error:error instanceof Error?error.message:'IMAGE_SKILL_CONFIGURATION_INVALID'}];}}));
      case 'skill.media.status':return Object.fromEntries(await Promise.all(store.configs().map(async config=>[config.id,Object.fromEntries(await Promise.all((['asr','video'] as const).map(async role=>[role,await this.runtime.media.analysisStatus(config,role)])))])));
      case 'skill.voice.status':return Object.fromEntries(await Promise.all(store.configs().map(async config=>{
        const options=config.media.voice;const gpt=options?.protocol==='gpt_sovits';const provider=gpt?'gpt_sovits':options?.provider??config.model?.provider;const model=gpt?options?.gptSovits?.modelVersion:options?.model??config.model?.model;
        const validation=store.capabilityStatuses().find((record:any)=>record.configId===config.id&&record.revision===config.revision&&record.role==='voice') as {status:string;evidence:string;updatedAt:number;source:string}|undefined;
        return [config.id,{...(await this.runtime.media.analysisStatus(config,'tts')),revision:config.revision,protocol:options?.protocol??'speech',replyMode:options?.replyMode??'on_demand',provider,model,voice:options?.voice??(gpt?config.id:undefined),format:options?.format??(gpt?'wav':'mp3'),synthesisValidation:validation?{status:validation.status,evidence:validation.evidence,updatedAt:validation.updatedAt,source:validation.source}:{status:'NOT_RUN'}}];
      })));
      case 'capability.list':return store.capabilityStatuses();
      case 'capability.record':{const value=z.object({configId:z.string(),revision:z.number().int(),role:z.enum(['image','asr','video','voice']),status:z.enum(['PASS','FAIL','BLOCKED','NOT_RUN']),evidence:z.string().min(1).max(2000)}).parse(input);const config=store.config(value.configId);if(config.revision!==value.revision)throw new ConflictError('配置已变化，请针对当前版本重新验收');const record={...value,updatedAt:Date.now(),source:'operator'};store.saveCapabilityStatus(`${value.configId}:${value.revision}:${value.role}`,record);return record;}
      case 'config.save':return this.runtime.saveConfig(input.config,input.expectedRevision);
      case 'config.files.apply':return this.runtime.applyPersonaFiles(z.object({id:z.string()}).strict().parse(input).id);
      case 'config.copy':{const original=store.config(z.string().parse(input.id));const newId=z.string().parse(input.newId);this.features?.skills.copy(original,newId);return this.runtime.saveConfig({...original,id:newId,name:z.string().parse(input.name),revision:1});}
      case 'bot.save':{const bot=this.runtime.saveBot(input);if(!bot.enabled||bot.archived)await this.runtime.stop(bot.id);return bot;}
      case 'bot.start':await this.runtime.start(z.string().parse(input.id));return{ok:true};
      case 'bot.stop':await this.runtime.stop(z.string().parse(input.id));return{ok:true};
      case 'bot.reconnect':await this.runtime.stop(z.string().parse(input.id));await this.runtime.start(input.id);return{ok:true};
      case 'bot.credentials':{
        const bot=store.bot(z.string().parse(input.id));if(bot.enabled)throw new Error('请先停止机器人再更换授权');
        const definition=this.runtime.channels.require(bot.channel);if(!definition.capabilities.login.includes('credentials')||!definition.normalizeCredential)throw new Error('当前渠道不支持手工凭据');const normalized=definition.normalizeCredential(input.credential);
        store.saveBot({...bot,accountId:normalized.accountId});await this.runtime.credentials.write(bot.id,normalized.credential as any);return{configured:true};
      }
      case 'login.begin':{
        for(const [id,value] of this.attempts)if(value.expires<Date.now())this.attempts.delete(id);
        if(this.attempts.size>=20)throw new Error('LOGIN_ATTEMPT_LIMIT');
        const bot=store.bot(z.string().parse(input.id));if(bot.enabled)throw new Error('请先停止机器人再重新授权');
        const state=await this.runtime.channels.require(bot.channel).adapter.beginLogin(AbortSignal.timeout(20000));if(!state.ticket||!state.qr)throw new Error('QR_RESPONSE_MISSING');
        const attempt=randomUUID();this.attempts.set(attempt,{botId:bot.id,ticket:state.ticket,expires:Date.now()+300000});
        const qrImage=state.qr.startsWith('data:image/')?state.qr:await QRCode.toDataURL(state.qr,{width:280,margin:2});
        return{status:state.status,attempt,qrImage,expiresAt:Date.now()+300000};
      }
      case 'login.poll':{
        const attempt=this.attempts.get(z.string().parse(input.attempt));if(!attempt||attempt.expires<Date.now())return{status:'expired'};
        const bot=store.bot(attempt.botId);const result=await this.runtime.channels.require(bot.channel).adapter.pollLogin(attempt.ticket,AbortSignal.timeout(42000));
        if(bot.enabled||bot.archived)throw new Error('机器人状态已改变，请停止后重新扫码');
        if(result.status==='confirmed'&&result.credential){const normalized=this.runtime.channels.require(bot.channel).normalizeCredential?.(result.credential)??{accountId:result.credential.accountId,credential:result.credential};store.saveBot({...bot,accountId:normalized.accountId});await this.runtime.credentials.write(bot.id,normalized.credential as any);this.attempts.delete(input.attempt);return{status:'confirmed',accountId:result.credential.accountId};}
        if(result.status!=='pending')this.attempts.delete(input.attempt);return{status:result.status};
      }
      case 'memory.list':return store.memories(z.string().parse(input.scope));
      case 'session.history':{
        const id=z.string().parse(input.id);if(!store.findSession(id)&&!store.bindings().some(b=>b.sessionId===id))throw new Error('会话不属于机器人集成');
        const log=await this.ctx.sessionQuery.readSession(SessionId(id));return log.events.filter(e=>['user/message','assistant/message','tool/result','turn/start','turn/end','request/header'].includes(e.type)).slice(-200).map(e=>e.type==='assistant/message'?{...e,data:{...e.data,message:{...e.data.message,content:e.data.message.content.filter(b=>b.type!=='reasoning')}}}:e);
      }
      case 'memory.forget':store.forget(z.string().parse(input.scope),z.string().parse(input.key));return{ok:true};
      case 'memory.correct':{
        const value=z.object({scope:z.string(),key:z.string().max(100),value:z.string().min(1).max(500),version:z.number().int()}).parse(input);
        store.correctMemory(value.scope,value.key,value.value,value.version);return{ok:true};
      }
      case 'session.cancel':{const id=z.string().parse(input.id);const binding=store.bindings().find(b=>b.sessionId===id);if(!binding)throw new Error('会话不存在');await this.runtime.stopSession(binding.scope);return{ok:true};}
      case 'delivery.retry':{const id=z.string().parse(input.id);const delivery=store.deliveryRepository().find(id);if(!delivery)throw new Error('投递不存在');if(!['unknown','failed'].includes(delivery.state))throw new Error('投递当前不可恢复');await this.runtime.deliveryWorker.retry(id);return{deliveryId:id,state:store.deliveryRepository().find(id)?.state??'unknown'};}
      default:throw new Error('UNKNOWN_ADMIN_ACTION');
    }
  }
  async http(req:IncomingMessage,res:ServerResponse):Promise<void>{
    const answer=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    const loopback=(value?:string)=>!!value&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(value);
    if(!loopback(req.socket.remoteAddress)||!loopback(req.socket.localAddress)||req.headers.authorization!==`Bearer ${this.token}`){answer(403,{error:'ADMIN_AUTH_REQUIRED'});return;}
    if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')){answer(405,{error:'JSON_POST_REQUIRED'});return;}
    const origin=req.headers.origin;if(origin){try{const o=new URL(origin);if(o.host!==req.headers.host||!['http:','https:'].includes(o.protocol))throw new Error();}catch{answer(403,{error:'ORIGIN_REJECTED'});return;}}
    try{let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('REQUEST_TOO_LARGE');chunks.push(chunk);}const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));const result=body?.version===1&&body?.kind==='query'?await this.query(body):body?.version===1&&body?.kind==='command'?await this.command(body):await this.invoke(z.object({action:z.string().max(100),input:z.unknown().default({})}).parse(body).action,z.object({action:z.string().max(100),input:z.unknown().default({})}).parse(body).input);answer(200,{result});}catch(error){answer(error instanceof ConflictError?409:400,{error:error instanceof Error?error.message:'ADMIN_REQUEST_FAILED'});}
  }
}
