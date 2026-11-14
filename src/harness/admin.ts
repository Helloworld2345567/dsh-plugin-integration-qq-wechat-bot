import type {SystemLocale} from '../i18n/common.js';
import {diagnostic} from '../i18n/diagnostics.js';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import QRCode from 'qrcode';
import type { Context } from '@deepseek-ai/cordis';
import type { BotRuntime } from '../core/runtime.js';
import { ConflictError,localizedError } from '../core/errors.js';
import {publicPersonaConfig,botSchema,botSettingsFromConfig,configWithBotSettings,type BotConfig,type Delivery} from '../core/types.js';
import {sanitizeRemoteMessage} from '../core/network.js';
import type {} from '@deepseek-ai/dsh-session-query';
import { SessionId } from '@deepseek-ai/dsh-session';
import {imageSkillEnabled} from '../core/image-skill.js';
import {defaultWorkspaceRoot,workingDirectory} from '../core/workspaces.js';
import {openDirectory} from './open-directory.js';
import type {BotFeatures} from '../core/features.js';
import {adminCommandRequestSchema,adminQueryRequestSchema,type AdminSummaryData,versioned,revisionFor,ADMIN_CONTRACT_VERSION} from './admin-contract.js';
import type {ServiceManagement} from '../core/service-management.js';
import {sanitizeServiceDiagnostic,sanitizeMessageDescriptor,sanitizePublicServiceText} from '../core/service-errors.js';
import {pickDirectory} from './pick-directory.js';
import {listWorkflowFiles,type WorkflowFileList} from './pick-file.js';

export function adminErrorPayload(error:unknown){
  const text=sanitizeServiceDiagnostic(error,'ADMIN_REQUEST_FAILED');
  if(error instanceof z.ZodError){
    const issues=error.issues.map(issue=>({path:sanitizePublicServiceText(issue.path.map(String).join('.'),'request'),message:sanitizeMessageDescriptor((issue as {params?:{message?:unknown}}).params?.message)??diagnostic('invalidValue')}));
    return{error:text,message:diagnostic('invalidInput',{fields:issues.map(issue=>issue.path||'request').join(', ')}),issues};
  }
  const message=sanitizeMessageDescriptor((error as {localizedMessage?:unknown}|null)?.localizedMessage);
  return{error:text,...message?{message}:{}};
}

function publicProfile(runtime:BotRuntime,options:{enabled:boolean;profileRef?:{serviceId:string;profileId:string}}|undefined){
  if(!options)return{enabled:false,state:'disabled' as const,profileRef:undefined};
  if(!options.enabled)return{enabled:false,state:'disabled' as const,profileRef:options.profileRef};
  if(!options.profileRef)return{enabled:true,state:'missing' as const,profileRef:undefined};
  const profile=runtime.profiles?.get(options.profileRef);return{enabled:true,profileRef:options.profileRef,state:profile?.state??'missing',...(profile?{profileRevision:profile.revision,profileContentHash:profile.contentHash,displayName:profile.displayName,modelLabel:profile.modelLabel}:{})};
}
const serviceRoleBinding=(config:BotConfig,role:'voice'|'singing'|'music')=>{const options=config.media[role],serviceId=options?.profileRef?.serviceId,operation=role==='voice'?(serviceId==='breeze-tts'?'breeze-tts.speak':'gpt-sovits.speak'):role==='singing'?'rvc.convert':'music.acquire';return options?.profileRef?{personaId:config.id,personaRevision:config.revision,serviceId:options.profileRef.serviceId,profileId:options.profileRef.profileId,operation}:undefined;};
function publicDelivery(delivery:Delivery):Omit<Delivery,'reply'|'replyEnvelope'|'attempt'> & {attempt?:Pick<NonNullable<Delivery['attempt']>,'number'|'phase'|'assetId'|'startedAt'|'lastError'|'causeCode'|'causeMessage'|'httpStatus'|'platformCode'|'platformMessage'|'platformTraceId'|'autoRetryCount'>} {
  const {reply:_reply,replyEnvelope:_replyEnvelope,attempt,...rest}=delivery;
  return {...rest,error:sanitizeRemoteMessage(rest.error),...attempt?{attempt:{number:attempt.number,phase:attempt.phase,assetId:attempt.assetId,startedAt:attempt.startedAt,lastError:sanitizeRemoteMessage(attempt.lastError),causeCode:sanitizeRemoteMessage(attempt.causeCode),causeMessage:sanitizeRemoteMessage(attempt.causeMessage),httpStatus:attempt.httpStatus,platformCode:sanitizeRemoteMessage(attempt.platformCode),platformMessage:sanitizeRemoteMessage(attempt.platformMessage),platformTraceId:sanitizeRemoteMessage(attempt.platformTraceId),autoRetryCount:attempt.autoRetryCount}}:{}};
}

export class Admin {
  readonly attempts=new Map<string,{botId:string;ticket:string;expires:number}>();
  constructor(readonly ctx:Context,readonly runtime:BotRuntime,readonly token:string,readonly revealDirectory:(directory:string)=>Promise<void>=openDirectory,readonly features?:BotFeatures,readonly services?:ServiceManagement,readonly chooseDirectory:(initial?:string,locale?:SystemLocale,signal?:AbortSignal)=>Promise<string|undefined>=(_initial,_locale,signal)=>pickDirectory(ctx.get('directoryPicker'),signal),readonly chooseFile:(initial?:string,locale?:SystemLocale,signal?:AbortSignal)=>Promise<WorkflowFileList>=(_initial,_locale,signal)=>listWorkflowFiles(_initial,signal)){}
  private statusConfigs(input:unknown):Array<[string,BotConfig]> {
    const {scope}=z.object({scope:z.literal('bots').optional()}).strict().parse(input??{});
    const repos=this.runtime.repos;
    return scope==='bots'?repos.bots.bots().filter(bot=>!bot.archived).map(bot=>{const persona=repos.personas.config(bot.configId);return[bot.id,configWithBotSettings(persona,bot.settings??botSettingsFromConfig(persona))];}):repos.personas.configs().map(config=>[config.id,config]);
  }
  private serviceAcceptance(config:BotConfig,role:'voice'|'singing'|'music'):{status:string;evidence?:string;updatedAt?:number;source?:string}|undefined {const binding=serviceRoleBinding(config,role);if(!binding||!this.services)return;const profile=this.runtime.profiles?.get({serviceId:binding.serviceId,profileId:binding.profileId});if(!profile)return{status:'NOT_RUN'};try{const value=this.services.acceptance({...binding,profileRevision:profile.revision,profileContentHash:profile.contentHash}).data;return{status:value.state,evidence:value.evidence,updatedAt:value.checkedAt,source:value.source};}catch{return{status:'NOT_RUN'};}}
  private async serviceHealth(config:BotConfig,role:'voice'|'singing'|'music',signal:AbortSignal):Promise<any>{const binding=serviceRoleBinding(config,role);if(!binding||!this.services)throw localizedError('profileSelectFirst');const result=await this.services.health({serviceId:binding.serviceId,profileId:binding.profileId},signal);return{...result.data,status:['ready','degraded'].includes(result.data.state)?'PASS':result.data.state==='blocked'?'BLOCKED':'FAIL',evidence:result.data.safeDiagnostic,updatedAt:result.data.checkedAt,source:'health'};}
  private async summary():Promise<AdminSummaryData> {
    const repos=this.runtime.repos;const configs=repos.personas.configs().map(config=>({id:config.id,name:config.name,revision:config.revision,archived:config.archived,sourceSchemaVersion:config.schemaVersion,model:config.model?{provider:config.model.provider,model:config.model.model}:null,toolCount:config.tools.length,skillCount:config.skills.length,allowHostTools:config.allowHostTools,voice:config.media.voice?{enabled:config.media.voice.enabled,protocol:config.media.voice.protocol,voice:config.media.voice.voice,replyMode:config.media.voice.replyMode,format:config.media.voice.format}:null}));
    const bots=await Promise.all(repos.bots.bots().filter(bot=>!bot.archived).map(async bot=>({id:bot.id,name:bot.name,channel:bot.channel,accountId:bot.accountId,configId:bot.configId,enabled:bot.enabled,archived:bot.archived,status:this.runtime.states.get(bot.id)??'stopped',activeSessions:this.runtime.activeSessions(bot.id),credentialConfigured:!!await this.runtime.credentials.read(bot.id),trustedUserCount:bot.trustedUsers.length,workspaceConfigured:!!bot.workingDirectory})));
    const health=this.runtime.health();const evolution=this.features?.history()[0];
    const channels=this.runtime.channels?.list?.().map(({id,displayName,capabilities})=>({id,displayName,capabilities}))??[];
    // Binding reads refresh updatedAt for history ordering; only configuration
    // fields belong in the revision used by the panel's live model poll.
    const sessionRevision=revisionFor(repos.sessions.sessionsAll().sort((a,b)=>a.id.localeCompare(b.id)).map(session=>{
      let personaId=session.personaId;try{if(!personaId)personaId=repos.bots.bot(session.scope.botId).configId;}catch{}
      let model:BotConfig['model']=null;try{model=repos.bots.bot(session.scope.botId).settings?.model??null;}catch{}
      return{id:session.id,generation:session.generation,personaId,model,modelOverride:session.modelOverride,ttsOverride:session.ttsOverride,stsOverride:session.stsOverride};
    }));
    return{channels,bots,configs,sessionRevision,counts:{bots:bots.filter(bot=>!bot.archived).length,configs:configs.filter(config=>!config.archived).length,sessions:repos.sessions.countBindings(),jobs:repos.media.jobs.countJobs(),failures:repos.telemetry.failures.countFailures(),pendingDeliveries:health.pendingDeliveries,pendingSessionActions:health.pendingSessionActions},health,evolution:evolution?{id:evolution.id,phase:evolution.phase,updatedAt:evolution.updatedAt}:null};
  }
  async query(request:unknown,signal:AbortSignal=new AbortController().signal):Promise<unknown> {
    const value=adminQueryRequestSchema.parse(request);
    if(value.name==='overview.summary')return versioned(await this.summary(),value.input.changedSince);
    const repos=this.runtime.repos;
    if(value.name==='catalog.config'){const config=publicPersonaConfig(repos.personas.config(value.input.id));return versioned(config,value.input.changedSince);}
    if(value.name==='bots.list'){const bots=await Promise.all(repos.bots.bots().filter(bot=>!bot.archived).map(async bot=>({...bot,status:this.runtime.states.get(bot.id)??'stopped',activeSessions:this.runtime.activeSessions(bot.id),credentialConfigured:!!await this.runtime.credentials.read(bot.id)})));return versioned(bots,value.input.changedSince);}
    if(value.name==='catalog.profiles'){if(!this.services)throw Error('SERVICE_MANAGEMENT_UNAVAILABLE');return this.services.profilesPage(value.input);}
    if(value.name==='catalog.profile'){if(!this.services)throw Error('SERVICE_MANAGEMENT_UNAVAILABLE');return this.services.profile(value.input);}
    if(value.name==='catalog.models'){if(!this.services)throw Error('SERVICE_MANAGEMENT_UNAVAILABLE');return this.services.models(value.input);}
    if(value.name==='service.settings'){if(!this.services)throw Error('SERVICE_MANAGEMENT_UNAVAILABLE');return this.services.settings();}
    if(value.name==='service.health'){if(!this.services)throw Error('SERVICE_MANAGEMENT_UNAVAILABLE');return this.services.health(value.input,signal);}
    if(value.name==='capability.acceptance'){if(!this.services)throw Error('SERVICE_MANAGEMENT_UNAVAILABLE');return this.services.acceptance(value.input);}
    if(value.name==='overview.sessions'){
      const page=repos.sessions.pageSessions({},value.input.limit,value.input.cursor);
      const items=page.items.map(row=>{
        let botConfigId:string|undefined;try{botConfigId=repos.bots.bot(row.scope.botId).configId;}catch{/* Deleted bots can retain historical session rows. */}
        let baseModel:BotConfig['model']|null=null,personaId=row.personaId??botConfigId,personaRevision:number|undefined;
       try{if(personaId){const persona=repos.personas.config(personaId),model=repos.bots.bot(row.scope.botId).settings?.model;baseModel=model?{provider:model.provider,model:model.model}:null;personaRevision=persona.revision;}}catch{/* A deleted persona remains visible as a historical session. */}
        const modelOverride=row.modelOverride?{provider:row.modelOverride.provider,model:row.modelOverride.model}:null;
        return{id:row.id,scopeKey:row.scopeKey,botId:row.scope.botId,platform:row.scope.platform,kind:row.scope.kind,channelId:row.scope.channelId,senderId:row.scope.senderId,generation:row.generation,persisted:row.persisted,createdAt:row.createdAt,updatedAt:row.updatedAt,personaId,personaRevision,model:baseModel,modelOverride,effectiveModel:modelOverride??baseModel,ttsOverride:row.ttsOverride??null,stsOverride:row.stsOverride??null};
      });
      return{...page,contractVersion:ADMIN_CONTRACT_VERSION,items,hasMore:page.nextCursor!==null};
    }
    if(value.name==='automation.list')return versioned({scopes:repos.sessions.bindings().filter(binding=>binding.scope.kind==='private').map(binding=>({scopeKey:binding.key,botId:binding.scope.botId,configId:repos.bots.bot(binding.scope.botId).configId,channelId:binding.scope.channelId,senderId:binding.scope.senderId})),proactive:this.runtime.automation.listProactive(),scheduled:this.runtime.automation.listJobs()},value.input.changedSince);
    const page=repos.deliveries.pageDeliveries({filter:{scopeKey:value.input.scopeKey},limit:value.input.limit,cursor:value.input.cursor});return{...page,contractVersion:ADMIN_CONTRACT_VERSION,items:page.items.map((row:Delivery)=>publicDelivery(row)),hasMore:page.nextCursor!==null};
  }
  async command(request:unknown,signal:AbortSignal=new AbortController().signal):Promise<unknown>{const value=adminCommandRequestSchema.parse(request);if(value.name==='service.settings.save'){if(!this.services)throw Error('SERVICE_MANAGEMENT_UNAVAILABLE');return this.services.saveSettings(value.input,signal);}if(value.name==='service.settings.pick-directory')return {path:await this.chooseDirectory((value.input as {current?:string}).current,(value.input as {locale?:SystemLocale}).locale,signal)};if(value.name==='service.settings.pick-file')return this.chooseFile((value.input as {current?:string}).current,(value.input as {locale?:SystemLocale}).locale,signal);if(value.name==='service.refresh'){if(!this.services)throw Error('SERVICE_MANAGEMENT_UNAVAILABLE');return this.services.refresh(value.input,signal);}if(value.name==='service.start'){if(!this.services)throw Error('SERVICE_MANAGEMENT_UNAVAILABLE');return this.services.start(value.input,signal);}if(value.name==='capability.acceptance'){if(!this.services)throw Error('SERVICE_MANAGEMENT_UNAVAILABLE');return this.services.recordAcceptance(value.input);}return this.invoke(value.name,value.input);}
  async invoke(action:string,input:any):Promise<unknown>{
    const repos=this.runtime.repos;
    switch(action){
      case 'stats.query':if(!this.features)throw Error('STATS_UNAVAILABLE');return this.features.stats.query(input);
      case 'evolution.list':return this.features?.history()??[];
      case 'skills.list':{if(!this.features)throw Error('SKILLS_UNAVAILABLE');return this.features.skills.list(repos.personas.config(z.string().parse(input.id)));}
      case 'state':return{configs:repos.personas.configs().map(publicPersonaConfig),bots:await Promise.all(repos.bots.bots().filter(b=>!b.archived).map(async b=>({...b,status:this.runtime.states.get(b.id)??'stopped',activeSessions:this.runtime.activeSessions(b.id),credentialConfigured:!!await this.runtime.credentials.read(b.id)}))),sessions:repos.sessions.bindings().map(binding=>{const snapshot=repos.telemetry.snapshots.findTurnSnapshot(binding.sessionId);return {...binding,turn:snapshot?{configId:snapshot.config.id,revision:snapshot.config.revision,startedAt:snapshot.startedAt}:null};}),jobs:repos.media.jobs.jobs(),failures:repos.telemetry.failures.failures(),deliveries:repos.deliveries.deliveries().slice(-200).map(publicDelivery),versions:repos.personas.configVersions().map(publicPersonaConfig)};
      case 'automation.proactive':{const value=z.object({scopeKey:z.string(),action:z.enum(['on','off','status','now','set']),args:z.string().default('')}).parse(input);const binding=repos.sessions.findBinding(value.scopeKey);if(!binding)throw localizedError('sessionMissing');return this.runtime.commandServices.automation!.proactive(binding,value.action,value.args);}
      case 'automation.schedule':{const value=z.object({scopeKey:z.string(),action:z.enum(['list','create','pause','resume','run','delete']),args:z.string().default('')}).parse(input);const binding=repos.sessions.findBinding(value.scopeKey);if(!binding)throw localizedError('sessionMissing');return this.runtime.commandServices.automation!.schedule(binding,value.action,value.args);}
      case 'models':{if(this.services){const catalog=(await this.services.models({})).data,providers=new Map<string,Array<{id:string;name:string;inputModalities:readonly string[];reasoning:{supported:boolean;efforts:readonly string[]}}>>();for(const item of catalog){const models=providers.get(item.provider)??[];models.push({id:item.model,name:item.model,inputModalities:item.inputModalities,reasoning:item.reasoning});providers.set(item.provider,models);}return[...providers].map(([id,models])=>({id,models}));}return Promise.all(this.ctx.llm.listProviders().map(async p=>({id:p.id,models:(await this.ctx.llm.listModels(p.id)).map(m=>({id:m.id,name:m.name}))})));}
      case 'directories':return{workspaceRoot:defaultWorkspaceRoot(),configDirectory:repos.personas.personaRoot(),storageDirectory:repos.storage.home,personas:repos.personas.configs().map(c=>repos.personas.personaStatus(c.id)),sessions:repos.sessions.bindings().map(binding=>({sessionId:binding.sessionId,botId:binding.scope.botId,directory:workingDirectory(repos.bots.bot(binding.scope.botId),binding.key)}))};
      case 'config.directory.open':{const value=z.object({botId:z.string().optional(),configId:z.string().optional()}).strict().parse(input);const configId=value.configId??(value.botId?repos.bots.bot(value.botId).configId:undefined);if(value.botId)repos.bots.bot(value.botId);if(configId)repos.personas.config(configId);const directory=repos.personas.personaDirectory(configId);await this.revealDirectory(directory);return{opened:true,directory};}
      case 'skill.image.status':return Object.fromEntries(this.statusConfigs(input).map(([id,config])=>{try{const endpoint=this.runtime.media.imageEndpoint(config);return [id,{enabled:imageSkillEnabled(config),model:endpoint.model,protocol:endpoint.protocol??'openai',keyEnv:endpoint.keyEnv,keyConfigured:endpoint.protocol==='comfyui'||!!(endpoint.keyEnv&&process.env[endpoint.keyEnv]),overridden:!!config.media.image?.protocol}];}catch(error){return [id,{enabled:false,error:error instanceof Error?error.message:'IMAGE_SKILL_CONFIGURATION_INVALID'}];}}));
      case 'skill.media.status':return Object.fromEntries(await Promise.all(this.statusConfigs(input).map(async ([id,config])=>[id,Object.fromEntries(await Promise.all((['asr','video'] as const).map(async role=>[role,await this.runtime.media.analysisStatus(config,role)])))])));
      case 'skill.voice.status':return Object.fromEntries(await Promise.all(this.statusConfigs(input).map(async ([id,config])=>{
        const options=config.media.voice,edge=options?.protocol==='edge_tts',profile=edge?undefined:publicProfile(this.runtime,options),validation=input?.scope==='bots'?undefined:this.serviceAcceptance(config,'voice'),health=options?.profileRef?this.services?.healthStatus(options.profileRef):undefined;
        return [id,{...(profile?{configured:['ready','partial'].includes(profile.state),...profile,health:health??null}:await this.runtime.media.analysisStatus(config,'tts')),revision:config.revision,protocol:options?.protocol,replyMode:options?.replyMode??'on_demand',provider:edge?'edge_tts':options?.profileRef?.serviceId,voice:edge?options.voice??'zh-CN-XiaoxiaoNeural':undefined,format:options?.format??'mp3',synthesisValidation:validation??{status:'NOT_RUN'}}];
      })));
      case 'capability.list':{const serviceRoles=new Set(['voice','singing','singing_protocol','music','music_protocol']);return[...repos.capabilities.statuses().filter((record:any)=>!serviceRoles.has(record?.role)),...repos.capabilities.allAcceptances()];}
      case 'skill.music.status':return Object.fromEntries(this.statusConfigs(input).map(([id,config])=>{
        const options=config.media.music,profile=publicProfile(this.runtime,options),health=options?.profileRef?this.services?.healthStatus(options.profileRef):undefined;
        return [id,{...profile,includeLyrics:options?.includeLyrics===true,revision:config.revision,permitted:config.skills.includes('music-download')&&config.tools.includes('bot_music'),environment:health??null,protocolValidation:health?{status:['ready','degraded'].includes(health.state)?'PASS':health.state==='blocked'?'BLOCKED':'FAIL',evidence:health.safeDiagnostic,updatedAt:health.checkedAt,source:'health'}:{status:'NOT_RUN'},downloadValidation:(input?.scope==='bots'?undefined:this.serviceAcceptance(config,'music'))??{status:'NOT_RUN'}}];
      }));
      case 'skill.music.probe':{
        const value=z.object({configId:z.string().min(1).max(80),revision:z.number().int().positive()}).strict().parse(input),config=repos.personas.config(value.configId);if(config.revision!==value.revision)throw new ConflictError('配置已变化，请针对当前版本重新验收',diagnostic('acceptanceRevisionChanged'));return this.serviceHealth(config,'music',AbortSignal.timeout(30_000));
      }
      case 'skill.singing.status':return Object.fromEntries(this.statusConfigs(input).map(([id,config])=>{
        const options=config.media.singing,profile=publicProfile(this.runtime,options),health=options?.profileRef?this.services?.healthStatus(options.profileRef):undefined;
        return [id,{...profile,configured:['ready','partial'].includes(profile.state),health:health??null,revision:config.revision,format:options?.defaultOutput??'mp3',permitted:config.skills.includes('singing-conversion')&&config.tools.includes('bot_sing'),protocolValidation:health?{status:['ready','degraded'].includes(health.state)?'PASS':health.state==='blocked'?'BLOCKED':'FAIL',evidence:health.safeDiagnostic,updatedAt:health.checkedAt,source:'health'}:{status:'NOT_RUN'},conversionValidation:(input?.scope==='bots'?undefined:this.serviceAcceptance(config,'singing'))??{status:'NOT_RUN'}}];
      }));
      case 'skill.singing.probe':{
        const value=z.object({configId:z.string().min(1).max(80),revision:z.number().int().positive()}).strict().parse(input),config=repos.personas.config(value.configId);if(config.revision!==value.revision)throw new ConflictError('配置已变化，请针对当前版本重新验收',diagnostic('acceptanceRevisionChanged'));return this.serviceHealth(config,'singing',AbortSignal.timeout(30_000));
      }
      case 'capability.record':{const value=z.object({configId:z.string(),revision:z.number().int(),role:z.enum(['image','asr','video','voice','singing','singing_protocol','music','music_protocol']),status:z.enum(['PASS','FAIL','BLOCKED','NOT_RUN']),evidence:z.string().min(1).max(2000)}).parse(input);const config=repos.personas.config(value.configId);if(config.revision!==value.revision)throw new ConflictError('配置已变化，请针对当前版本重新验收',diagnostic('acceptanceRevisionChanged'));if(['singing_protocol','music_protocol'].includes(value.role))throw localizedError('healthSourceOnly');if(['voice','singing','music'].includes(value.role)){if(!this.services)throw Error('SERVICE_MANAGEMENT_UNAVAILABLE');if(value.status==='NOT_RUN')throw localizedError('acceptanceNotRun');const binding=serviceRoleBinding(config,value.role as 'voice'|'singing'|'music');if(!binding)throw localizedError('profileSelectFirst');const profile=this.runtime.profiles?.get({serviceId:binding.serviceId,profileId:binding.profileId});if(!profile)throw localizedError('profileMissing');return this.services.recordAcceptance({...binding,profileRevision:profile.revision,profileContentHash:profile.contentHash,state:value.status,evidence:value.evidence,evidenceType:'operator-review'}).data;}const record={...value,updatedAt:Date.now(),source:'operator'};repos.capabilities.saveStatus(`${value.configId}:${value.revision}:${value.role}`,record);return record;}
      case 'config.save':return this.runtime.saveConfig(input.config,input.expectedRevision);
      case 'config.files.apply':return this.runtime.applyPersonaFiles(z.object({id:z.string()}).strict().parse(input).id);
      case 'config.copy':{const original=repos.personas.config(z.string().parse(input.id));const newId=z.string().parse(input.newId);this.features?.skills.copy(original,newId);return this.runtime.saveConfig({...original,id:newId,name:z.string().parse(input.name),revision:1});}
      case 'bot.save':{
        const candidate=botSchema.parse(input),previous=repos.bots.bots().find(bot=>bot.id===candidate.id);
        if(!previous||candidate.settings&&JSON.stringify(candidate.settings)!==JSON.stringify(previous.settings)){
          const persona=repos.personas.config(candidate.configId),config=configWithBotSettings(persona,candidate.settings??botSettingsFromConfig(persona));
          this.services?.validateSelections(config,previous?.settings?configWithBotSettings(persona,previous.settings):undefined);
          await this.runtime.harness.validateModel(config);
          if(JSON.stringify(repos.bots.bots().find(bot=>bot.id===candidate.id))!==JSON.stringify(previous))throw new ConflictError();
          this.services?.validateSelections(config,previous?.settings?configWithBotSettings(persona,previous.settings):undefined);
        }
        const bot=this.runtime.saveBot(candidate);if(!bot.enabled||bot.archived)await this.runtime.stop(bot.id);return bot;
      }
      case 'bot.start':await this.runtime.start(z.string().parse(input.id));return{ok:true};
      case 'bot.stop':await this.runtime.stop(z.string().parse(input.id));return{ok:true};
      case 'bot.service.start':await this.runtime.startService();return{running:this.runtime.serviceRunning()};
      case 'bot.service.stop':await this.runtime.stopService();return{running:this.runtime.serviceRunning()};
      case 'bot.delete':{const id=z.string().parse(input.id);for(const [key,attempt] of this.attempts)if(attempt.botId===id)this.attempts.delete(key);await this.runtime.deleteBot(id);return{ok:true};}
      case 'bot.reconnect':await this.runtime.stop(z.string().parse(input.id));await this.runtime.start(input.id);return{ok:true};
      case 'bot.credentials':{
        const bot=repos.bots.bot(z.string().parse(input.id));if(bot.archived)throw localizedError('botDeleted');if(bot.enabled)throw localizedError('stopBeforeCredentials');
        const definition=this.runtime.channels.require(bot.channel);if(!definition.capabilities.login.includes('credentials')||!definition.normalizeCredential)throw localizedError('credentialsUnsupported');const normalized=definition.normalizeCredential(input.credential);
        repos.bots.saveBot({...bot,accountId:normalized.accountId});await this.runtime.credentials.write(bot.id,normalized.credential as any);return{configured:true};
      }
      case 'login.begin':{
        for(const [id,value] of this.attempts)if(value.expires<Date.now())this.attempts.delete(id);
        if(this.attempts.size>=20)throw new Error('LOGIN_ATTEMPT_LIMIT');
        const bot=repos.bots.bot(z.string().parse(input.id));if(bot.archived)throw localizedError('botDeleted');if(bot.enabled)throw localizedError('stopBeforeLogin');
        const state=await this.runtime.channels.require(bot.channel).adapter.beginLogin(AbortSignal.timeout(20000));if(!state.ticket||!state.qr)throw new Error('QR_RESPONSE_MISSING');
        const current=repos.bots.bot(bot.id);if(current.archived||current.enabled)throw localizedError('loginStateChanged');
        const attempt=randomUUID();this.attempts.set(attempt,{botId:bot.id,ticket:state.ticket,expires:Date.now()+300000});
        const qrImage=state.qr.startsWith('data:image/')?state.qr:await QRCode.toDataURL(state.qr,{width:280,margin:2});
        return{status:state.status,attempt,qrImage,expiresAt:Date.now()+300000};
      }
      case 'login.poll':{
        const attempt=this.attempts.get(z.string().parse(input.attempt));if(!attempt||attempt.expires<Date.now())return{status:'expired'};
        const channel=repos.bots.bot(attempt.botId).channel;const result=await this.runtime.channels.require(channel).adapter.pollLogin(attempt.ticket,AbortSignal.timeout(42000));
        const bot=repos.bots.bot(attempt.botId);
        if(bot.enabled||bot.archived||this.attempts.get(input.attempt)!==attempt)throw localizedError('loginStateChanged');
        if(result.status==='confirmed'&&result.credential){const normalized=this.runtime.channels.require(bot.channel).normalizeCredential?.(result.credential)??{accountId:result.credential.accountId,credential:result.credential};repos.bots.saveBot({...bot,accountId:normalized.accountId});await this.runtime.credentials.write(bot.id,normalized.credential as any);this.attempts.delete(input.attempt);return{status:'confirmed',accountId:result.credential.accountId};}
        if(result.status!=='pending')this.attempts.delete(input.attempt);return{status:result.status};
      }
      case 'memory.list':return repos.memory.memories(z.string().parse(input.scope));
      case 'session.history':{
        const id=z.string().parse(input.id);if(!repos.sessions.findSession(id)&&!repos.sessions.bindings().some(b=>b.sessionId===id))throw localizedError('sessionMissing');
        const log=await this.ctx.sessionQuery.readSession(SessionId(id));return log.events.filter(e=>['user/message','assistant/message','tool/result','turn/start','turn/end','request/header'].includes(e.type)).slice(-200).map(e=>e.type==='assistant/message'?{...e,data:{...e.data,message:{...e.data.message,content:e.data.message.content.filter(b=>b.type!=='reasoning')}}}:e);
      }
      case 'memory.forget':repos.memory.forget(z.string().parse(input.scope),z.string().parse(input.key));return{ok:true};
      case 'memory.correct':{
        const value=z.object({scope:z.string(),key:z.string().max(100),value:z.string().min(1).max(500),version:z.number().int()}).parse(input);
        repos.memory.correctMemory(value.scope,value.key,value.value,value.version);return{ok:true};
      }
      case 'session.cancel':{const id=z.string().parse(input.id);const binding=repos.sessions.bindings().find(b=>b.sessionId===id);if(!binding)throw localizedError('sessionMissing');await this.runtime.stopSession(binding.scope);return{ok:true};}
      case 'session.delete':return {ok:true,...await this.runtime.deleteSession(z.string().min(1).max(200).parse(input.id))};
      case 'delivery.retry':{const id=z.string().parse(input.id);const delivery=repos.deliveries.find(id);if(!delivery)throw localizedError('deliveryMissing');if(!['unknown','failed'].includes(delivery.state))throw localizedError('deliveryNotRecoverable');await this.runtime.deliveryWorker.retry(id);return{deliveryId:id,state:repos.deliveries.find(id)?.state??'unknown'};}
      default:throw new Error('UNKNOWN_ADMIN_ACTION');
    }
  }
  async http(req:IncomingMessage,res:ServerResponse):Promise<void>{
    const answer=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    const loopback=(value?:string)=>!!value&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(value);
    if(!loopback(req.socket.remoteAddress)||!loopback(req.socket.localAddress)||req.headers.authorization!==`Bearer ${this.token}`){answer(403,{error:'ADMIN_AUTH_REQUIRED'});return;}
    if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')){answer(405,{error:'JSON_POST_REQUIRED'});return;}
    const origin=req.headers.origin;if(origin){try{const o=new URL(origin);if(o.host!==req.headers.host||!['http:','https:'].includes(o.protocol))throw new Error();}catch{answer(403,{error:'ORIGIN_REJECTED'});return;}}
    const controller=new AbortController();const abort=()=>controller.abort(Error('ADMIN_CLIENT_DISCONNECTED'));req.once('aborted',abort);res.once('close',abort);
    try{let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)throw new Error('REQUEST_TOO_LARGE');chunks.push(chunk);}controller.signal.throwIfAborted();const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));const result=body?.version===1&&body?.kind==='query'?await this.query(body,controller.signal):body?.version===1&&body?.kind==='command'?await this.command(body,controller.signal):await this.invoke(z.object({action:z.string().max(100),input:z.unknown().default({})}).parse(body).action,z.object({action:z.string().max(100),input:z.unknown().default({})}).parse(body).input);if(!controller.signal.aborted)answer(200,{result});}catch(error){if(!controller.signal.aborted)answer(error instanceof ConflictError?409:400,adminErrorPayload(error));}finally{req.off('aborted',abort);res.off('close',abort);}
  }
}
