import type {SystemLocale,MessageDescriptor} from '../i18n/common.js';
import {systemMessage,systemDescriptor,formatSystemMessage,systemErrorText,SystemMessageError} from '../i18n/system.js';
import { scopeKey } from './identity.js';
import type {RuntimeRepositories} from './ports/application.js';
import { Assets, MediaService } from './media.js';
import type { BotConfig, BotInstance, InboundMessage, SessionBinding, Output, TurnSnapshot, CallerScope, TtsOverride, StsOverride } from './types.js';
import {configForWrite} from './types.js';
import type {ProfileStore} from './profile-store.js';
import {randomUUID} from 'node:crypto';
import {freezeTurn,permissionsRevoked,trusted,allowedNow,permitted} from './policy.js';
import {TaskProgress,progressFallback} from './progress.js';
import {analysisEnabled} from './analysis.js';
import {botSchema,modelSchema,skillNameSchema} from './types.js';
import {validateWorkingDirectory} from './workspaces.js';
import {parseCommand,unescapeChat,commandHelp,type ParsedCommand} from './commands.js';
import {parseNaturalControl} from './natural-commands.js';
import {CommandBus,managementCommand,type CommandServices,type VoiceCatalog,type VoiceCatalogEntry} from './command-bus.js';
import type {ChannelRegistry} from './channel-registry.js';
import {deferredSessionActionSchema,sameSessionAction,sameSources,type DeferredSessionAction,type SessionActionRecord} from './session-actions.js';
import {validateBatch,INPUT_LIMITS} from './limits.js';
import {DurableDeliveryWorker,type DeliveryWorker} from './delivery-worker.js';
import {DurableConnectionSupervisor,type ConnectionSupervisor} from './connection-supervisor.js';
import type {ProcessingFailure} from './failure-context.js';
import {AutomationScheduler,type AutomationKind} from './automation.js';
import {botScheduleArgumentsSchema} from './automation-contract.js';
import {spokenReplyText,replyNotice,ReplyContextChangedError} from './voice-reply.js';
import {hasPendingSingingUpload,clearSingingCandidates,clearPendingSingingUpload,consumeSingingUpload,explicitSingingRequest} from './singing-state.js';
import {clearMusicState} from './music-state.js';
import {edgeTtsVoiceIds,type EdgeTtsVoiceId} from './voice-config.js';
import {sanitizePublicServiceText} from './service-errors.js';
import {localizedError} from './errors.js';

function modelFailureCode(error:unknown):string {
  const message=error instanceof Error?error.message:typeof error==='string'?error:'MODEL_REQUEST_FAILED';
  return message.match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0]??'MODEL_REQUEST_FAILED';
}

export type {HarnessResult,HarnessPort,Credentials} from './runtime-ports.js';

import type {HarnessPort,HarnessResult,HarnessRunOptions,Credentials} from './runtime-ports.js';
export type {CommandServices} from './command-bus.js';
export class BotRuntime {
  readonly states=new Map<string,string>();
  readonly connectionSupervisor:ConnectionSupervisor;
  private readonly timers=new Map<string,ReturnType<typeof setTimeout>>();
  private readonly processing=new Map<string,{controller:AbortController;sessionId:string;sourceIds:string[];done:Promise<void>}>();
  readonly deliveryWorker:DeliveryWorker;
  private readonly controls=new Map<string,Promise<void>>();
  private readonly maintenance=new Map<string,{controller:AbortController;sessionId:string;done:Promise<void>}>();
  private readonly sessionActionSignals=new Map<string,{controller:AbortController;dispose:()=>void}>();
  private readonly scheduledSessionActions=new Set<string>();
  commandServices:CommandServices={};
  readonly commandBus:CommandBus;
  readonly automation:AutomationScheduler;
  private quiescing=false;
  private closed=false;
  private serviceActive=true;
  private serviceChange:Promise<void>=Promise.resolve();
  private readonly owner=randomUUID();
  private claimed=false;
  /** Session-bound music and singing state share the binding generation check. */
  private get sessionPorts(){return {bindings:this.repos.sessions,music:this.repos.media.music,singing:this.repos.media.singing};}
  activeSessions(botId:string):number {return [...new Set([...this.processing.keys(),...this.maintenance.keys()])].filter(key=>this.repos.sessions.findBinding(key)?.scope.botId===botId).length;}
  effectiveConfig(binding:SessionBinding):BotConfig{return this.repos.personas.effectiveConfig(binding);}
  bot(scope:CallerScope){return this.repos.bots.bot(scope.botId);}
  binding(scope:CallerScope){return this.repos.sessions.binding(scope);}
  configs(){return this.repos.personas.configs();}
  sessions(scope:CallerScope){return this.repos.sessions.sessions(scope);}
  session(scope:CallerScope,id:string){return this.repos.sessions.session(scope,id);}
  busy(value:SessionBinding|string):boolean{const key=typeof value==='string'?value:value.key;return this.processing.has(key)||this.maintenance.has(key);}
  models(){return this.harness.models?this.harness.models():Promise.resolve([]);}
  sessionStatus(scope:CallerScope):'waiting_upgrade'|'compacting'|'running'|'idle'{const key=scopeKey(scope);return this.quiescing?'waiting_upgrade':this.maintenance.has(key)?'compacting':this.processing.has(key)||this.repos.telemetry.actions.sessionActions<SessionActionRecord>().some(r=>r.scopeKey===key&&r.state==='running')?'running':'idle';}
  health():{ready:true;serviceRunning:boolean;quiescing:boolean;activeTasks:number;pendingDeliveries:number;pendingSessionActions:number;connections:Record<string,string>;latency:{inboxToModel:{count:number;p50:number|null;p95:number|null;max:number|null};inboxToSent:{count:number;p50:number|null;p95:number|null;max:number|null}}}{return{ready:true,serviceRunning:this.serviceRunning(),quiescing:this.quiescing,activeTasks:this.processing.size+this.maintenance.size+this.controls.size,pendingDeliveries:this.repos.deliveries.deliveries(['pending','sending']).length,pendingSessionActions:this.repos.telemetry.actions.sessionActions<SessionActionRecord>().filter(r=>r.state==='queued').length,connections:Object.fromEntries(this.states),latency:{inboxToModel:this.repos.telemetry.metrics.metricPercentiles('modelStartedAt'),inboxToSent:this.repos.telemetry.metrics.metricPercentiles('sentAt')}};}
  constructor(readonly repos:RuntimeRepositories,readonly assets:Assets,readonly media:MediaService,readonly harness:HarnessPort,readonly channels:ChannelRegistry,readonly credentials:Credentials,readonly debounceMs=2000,readonly turnTimeoutMs=0,readonly profiles?:ProfileStore,readonly systemLocale:()=>SystemLocale=()=> 'zh'){
    this.connectionSupervisor=new DurableConnectionSupervisor(repos.bots,this.channels,credentials,this.states,message=>this.receive(message));this.deliveryWorker=new DurableDeliveryWorker(repos,this.channels,credentials,undefined,this.profiles,()=>this.serviceRunning());this.commandBus=new CommandBus(this);this.automation=new AutomationScheduler(repos,{runPrompt:(binding,prompt,kind,signal,onText)=>this.runAutomationPrompt(binding,prompt,kind,signal,onText),flush:filter=>this.deliveryWorker.flush(filter),available:key=>this.serviceRunning()&&!this.quiescing&&!this.busy(key)&&!this.controls.has(key)&&!this.repos.inbox.messages(key).length});this.commandServices.automation={proactive:(binding,action,args,locale)=>this.automationCommand(binding,action,args,locale),schedule:(binding,action,args,locale)=>this.scheduleCommand(binding,action,args,locale)};
  }
  async initialize(options:{autoStart?:boolean}={}):Promise<void>{
    this.serviceActive=options.autoStart!==false;
    if(!this.serviceActive)this.automation.close();
    this.repos.lifecycle.claim(this.owner);this.claimed=true;this.repos.lifecycle.recover();
    for(const job of this.repos.media.jobs.jobs())if(job.state==='running'||job.state==='queued')this.repos.media.jobs.saveJob(job.id,{...job,state:'interrupted'});
    for(const action of this.repos.telemetry.actions.sessionActions<SessionActionRecord>())if(action.state==='running')this.finishSessionAction(action,'interrupted',systemMessage(action.systemLocale??'zh','actionInterrupted'));
    if(this.serviceActive)for(const bot of this.repos.bots.bots())if(bot.enabled&&!bot.archived)void this.start(bot.id).catch(()=>this.states.set(bot.id,'error'));
    this.repos.lifecycle.retain();
    this.resumeServiceConsumers();
  }
  serviceRunning():boolean{return this.serviceActive&&!this.closed;}
  private changeService(action:()=>Promise<void>):Promise<void>{const next=this.serviceChange.catch(()=>{}).then(async()=>{if(this.closed)throw Error('BOT_RUNTIME_CLOSED');await action();});this.serviceChange=next;return next;}
  private resumeServiceConsumers():void{if(!this.serviceRunning()||this.quiescing)return;this.automation.start();this.resumeCommands();this.resumeSessionActions();for(const key of this.repos.inbox.scopesWithPending())this.schedule(key);void this.flushDeliveries();}
  async startService():Promise<void>{return this.changeService(async()=>{const starting=!this.serviceActive;this.serviceActive=true;await Promise.all(this.repos.bots.bots().filter(bot=>bot.enabled&&!bot.archived).map(bot=>this.connectionSupervisor.start(bot.id).catch(()=>{this.states.set(bot.id,'error');})));if(starting)this.resumeServiceConsumers();});}
  async stopService():Promise<void>{return this.changeService(async()=>{
    if(!this.serviceActive)return;this.serviceActive=false;this.automation.close();for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();
    for(const [key,task] of [...this.processing.entries(),...this.maintenance.entries()]){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}
    for(const [id,signal] of this.sessionActionSignals)if(this.repos.telemetry.actions.findSessionAction<SessionActionRecord>(id)?.state==='running')signal.controller.abort();
    for(const bot of this.repos.bots.bots())this.deliveryWorker.cancelBot(bot.id,'BOT_SERVICE_STOPPED');
    await this.connectionSupervisor.disconnectAll();await Promise.all([...this.processing.values(),...this.maintenance.values()].map(task=>task.done.catch(()=>{})));await this.automation.drain();await this.drainControls();await this.deliveryWorker.drain();
  });}
  async saveConfig(input:unknown,expectedRevision?:number):Promise<BotConfig>{
    const parsed=configForWrite(input);
    const saved=this.repos.personas.saveConfig(parsed,expectedRevision);this.recheckPermissions();return saved;
  }
  async applyPersonaFiles(id:string):Promise<BotConfig>{
    const file=this.repos.personas.readPersonaDraft(id);
    const saved=this.repos.personas.saveConfig(file.config,file.config.revision,file.digest);
    this.recheckPermissions();return saved;
  }
  saveBot(input:unknown):BotInstance{const candidate=botSchema.parse(input);this.channels.require(candidate.channel);let previous:BotInstance|undefined;try{previous=this.repos.bots.bot(candidate.id);}catch{}if(previous?.archived&&!candidate.archived)throw new SystemMessageError('botDeleted');if(previous&&(previous.accountId!==candidate.accountId||previous.channel!==candidate.channel))throw new SystemMessageError('botIdentityImmutable');if(candidate.workingDirectory)validateWorkingDirectory(candidate.workingDirectory);const next=this.repos.bots.saveBot(candidate);this.recheckPermissions();return next;}
  private recheckPermissions():void{
    this.harness.recheckPermissions?.();
    // A changed policy cancels in-flight work; new privileges still wait for the next frozen turn.
    for(const [key,task] of this.processing){const binding=this.repos.sessions.findBinding(key);if(!binding)continue;const before=this.repos.telemetry.snapshots.findTurnSnapshot(task.sessionId);if(!before)continue;const bot=this.repos.bots.bot(binding.scope.botId);let current:BotConfig|undefined;try{current=this.effectiveConfig(binding);}catch{}if(!current||permissionsRevoked(before,current,bot,binding.scope)){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}}
    for(const [key,task] of this.maintenance){const binding=this.repos.sessions.findBinding(key);if(!binding)continue;const bot=this.repos.bots.bot(binding.scope.botId);if(!bot.enabled||bot.archived){task.controller.abort();this.harness.cancel(task.sessionId);}}
  }
  async start(botId:string):Promise<void>{return this.changeService(async()=>{const starting=!this.serviceActive;this.serviceActive=true;try{await this.connectionSupervisor.start(botId);}catch(error){if(starting)this.serviceActive=false;throw error;}if(starting)this.resumeServiceConsumers();});}
  /** Keep only the reserved identity; remove owned history after all writers stop. */
  async deleteBot(botId:string):Promise<void>{
    const bot=this.repos.bots.bot(botId);
    this.repos.bots.saveBot({...bot,enabled:false,archived:true});
    try{
      await this.stop(botId);
      await this.credentials.remove(botId);
      for(const job of this.automation.listJobs())if(job.botId===botId)this.automation.setJob(job.id,false);
      for(const config of this.automation.listProactive())if(config.botId===botId)this.automation.setProactive(config.scope,false);
      await this.automation.drain();await this.drainControls();await this.deliveryWorker.drain();
      let history=this.repos.botHistory.snapshot(botId);
      await this.harness.deleteSessions([...history.sessions]);
      history=this.repos.botHistory.snapshot(botId);
      await this.repos.botHistory.deleteFiles(this.assets.root,history);
      this.repos.botHistory.deleteRecords(botId,history);
      this.states.delete(botId);
    }catch(error){this.repos.bots.saveBot({...this.repos.bots.bot(botId),enabled:false,archived:false});throw error;}
  }
  async stop(botId:string):Promise<void>{
    const bot=this.repos.bots.bot(botId);this.repos.bots.saveBot({...bot,enabled:false});
    this.deliveryWorker.cancelBot(botId);
    for(const d of this.repos.deliveries.deliveries(['pending']))if(d.botId===botId)this.repos.deliveries.deliveryState(d,'cancelled');
    for(const key of new Set(this.repos.telemetry.actions.sessionActions<SessionActionRecord>().filter(r=>r.scope.botId===botId).map(r=>r.scopeKey)))this.cancelSessionActions(key,systemDescriptor('actionBotDisabled'));
    this.recheckPermissions();
    await this.connectionSupervisor.disconnect(botId);
    this.deliveryWorker.cancelBot(botId);
    for(const [key,timer] of this.timers){const binding=this.repos.sessions.findBinding(key);if(binding?.scope.botId===botId){clearTimeout(timer);this.timers.delete(key);}}
    for(const [key,task] of this.processing){const binding=this.repos.sessions.findBinding(key);if(binding?.scope.botId===botId){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}}
    for(const [key,task] of this.maintenance){const binding=this.repos.sessions.findBinding(key);if(binding?.scope.botId===botId){task.controller.abort();this.harness.cancel(task.sessionId);}}
    for(const key of this.repos.inbox.scopesWithPending(['pending','deferred','control'])){const messages=this.repos.inbox.messages(key,['pending','deferred','control']);if(messages[0]?.scope.botId===botId)this.repos.inbox.mark(key,messages.map(m=>m.id),'cancelled');}
    await Promise.all([...this.processing.entries(),...this.maintenance.entries()].filter(([key])=>this.repos.sessions.findBinding(key)?.scope.botId===botId).map(([,p])=>p.done.catch(()=>{})));this.states.set(botId,'stopped');
  }
  async receive(message:InboundMessage):Promise<void>{
    if(!this.serviceRunning())return;
    const bot=this.repos.bots.bot(message.scope.botId);const definition=this.channels.require(message.scope.platform);if(!message.replyEnvelope&&definition.normalizeReply)message={...message,replyEnvelope:definition.normalizeReply(message.reply)};if(!bot.enabled||bot.archived||bot.channel!==message.scope.platform||bot.accountId!==message.scope.accountId)return;
    if(!message.id||!message.scope.senderId||!message.scope.channelId)throw new Error('INVALID_CHANNEL_IDENTITY');
    const key=scopeKey(message.scope);if(!this.repos.inbox.accept(message))return;
    const command=this.inboundCommand(message);
    if(command){this.repos.inbox.mark(key,[message.id],'control');if(!this.quiescing||(command.name==='stop'&&(this.busy(key)||this.repos.telemetry.actions.sessionActions<SessionActionRecord>().some(action=>action.scopeKey===key&&['queued','running'].includes(action.state)))))await this.dispatchCommand(message,command);return;}
    const escaped=unescapeChat(message.text);if(escaped!==message.text){message={...message,text:escaped};this.repos.inbox.updateMessage(key,message);}
    const stripped=message.text.trim();const onlyUrl=/^https?:\/\/\S+$/.test(stripped);const hold=/(?:先别|不要|暂不|等我).*(?:分析|处理|指令)/.test(stripped);
    const uploadBinding=this.repos.sessions.binding(message.scope);
    if(!message.attachments.some(input=>input.kind==='audio'||input.kind==='file')||!permitted('bot_sing',this.effectiveConfig(uploadBinding),bot,message.scope))clearPendingSingingUpload(this.sessionPorts,uploadBinding);
    const awaitingSinging=hasPendingSingingUpload(this.sessionPorts,uploadBinding);
    if(hold||onlyUrl||(!awaitingSinging&&!stripped&&message.attachments.length>0&&message.attachments.every(a=>a.kind==='video'||a.kind==='file'))){this.repos.inbox.mark(key,[message.id],'deferred');return;}
    this.schedule(key);
  }
  private interrupt(scope:CallerScope,preserveActionId?:string):void {
    const key=scopeKey(scope);const timer=this.timers.get(key);if(timer)clearTimeout(timer);this.timers.delete(key);
    clearSingingCandidates(this.repos.media.singing,key);clearMusicState(this.repos.media.music,key);
    this.cancelSessionActions(key,systemDescriptor('actionCancelled'),preserveActionId);
    const binding=this.repos.sessions.binding(scope);this.processing.get(key)?.controller.abort();this.maintenance.get(key)?.controller.abort();this.harness.cancel(binding.sessionId);this.media.cancelScope(key);
    this.deliveryWorker.cancelScope(key);
  }
  async stopSession(scope:CallerScope,preserveActionId?:string):Promise<void>{
    const key=scopeKey(scope);this.interrupt(scope,preserveActionId);
    this.repos.inbox.mark(key,this.repos.inbox.messages(key,['pending','deferred']).map(m=>m.id),'cancelled');
    for(const delivery of this.repos.deliveries.deliveries(['pending']))if(delivery.scopeKey===key)this.repos.deliveries.deliveryState(delivery,'cancelled');
    await Promise.all([this.processing.get(key)?.done?.catch(()=>{}),this.maintenance.get(key)?.done?.catch(()=>{})]);
  }
  async newSession(scope:CallerScope,preserveActionId?:string,authorize?:()=>void):Promise<SessionBinding>{await this.stopSession(scope,preserveActionId);const previous=this.repos.sessions.binding(scope);authorize?.();await this.harness.dispose(previous.sessionId);authorize?.();return this.repos.sessions.reset(scope);}
  async deleteSession(id:string):Promise<{current:boolean;newSessionId?:string}>{
    const record=this.repos.sessions.findSession(id);if(!record)throw localizedError('sessionMissing');
    const key=record.scopeKey,previous=this.controls.get(key)??Promise.resolve();
    let result:{current:boolean;newSessionId?:string}|undefined;
    const task=previous.catch(()=>{}).then(async()=>{
      const target=this.repos.sessions.findSession(id);if(!target)throw localizedError('sessionMissing');
      const current=this.repos.sessions.findBinding(key)?.sessionId===id;
      if(current)await this.stopSession(target.scope);
      await this.deliveryWorker.cancelSession(id);
      // Release native writers, including sessions opened in the web UI, before removing history.
      const deleted=await this.harness.deleteSessions([id])??[id];
      await this.repos.botHistory.deleteSessionFiles(key,deleted);
      result=this.repos.unitOfWork.transaction(()=>{
        const replacement=current?this.repos.sessions.reset(target.scope):undefined;
        this.repos.botHistory.deleteSessionRecords(key,deleted);
        return{current,...replacement?{newSessionId:replacement.sessionId}:{}};
      });
    }).finally(()=>{if(this.controls.get(key)===task){this.controls.delete(key);if(this.repos.inbox.messages(key).length)this.schedule(key);}});
    this.controls.set(key,task);await task;return result!;
  }
  async resumeSession(scope:CallerScope,id:string,authorize?:()=>void):Promise<SessionBinding>{
    const binding=this.repos.sessions.binding(scope);if(this.busy(binding.key))throw new SystemMessageError('busyStop');
    const target=this.repos.sessions.session(scope,id);if(target.id===binding.sessionId)return binding;
    if(!target.persisted)throw new SystemMessageError('noRestorableHistory');
    if(!this.harness.inspectSession)throw new SystemMessageError('sessionInspectionUnsupported');
    await this.harness.inspectSession(id);const next={...binding,sessionId:id,personaId:target.personaId,modelOverride:target.modelOverride,ttsOverride:target.ttsOverride,stsOverride:target.stsOverride};await this.harness.validateModel(this.effectiveConfig(next));
    if(this.busy(binding.key)||this.repos.sessions.binding(scope).sessionId!==binding.sessionId)throw new SystemMessageError('sessionChanged');
    authorize?.();await this.harness.dispose(binding.sessionId);authorize?.();clearSingingCandidates(this.repos.media.singing,binding.key);clearMusicState(this.repos.media.music,binding.key);return this.repos.sessions.activateSession(scope,id);
  }
  async switchPersona(scope:CallerScope,id:string,authorize?:()=>void):Promise<SessionBinding>{
    const binding=this.repos.sessions.binding(scope);this.repos.personas.config(id);await this.harness.validateModel(this.effectiveConfig({...binding,personaId:id}));
    const current=this.repos.sessions.binding(scope);if(current.sessionId!==binding.sessionId||current.generation!==binding.generation)throw new SystemMessageError('sessionChanged');authorize?.();const next={...current,personaId:id};this.repos.sessions.updateSession(next);this.recheckPermissions();return next;
  }
  async setModel(scope:CallerScope,model:BotConfig['model'],authorize?:()=>void):Promise<SessionBinding>{
    const binding=this.repos.sessions.binding(scope);const next={...binding,modelOverride:model?modelSchema.parse(model):undefined};await this.harness.validateModel(this.effectiveConfig(next));
    const current=this.repos.sessions.binding(scope);if(current.sessionId!==binding.sessionId||current.generation!==binding.generation||current.personaId!==binding.personaId)throw new SystemMessageError('sessionConfigChanged');authorize?.();return this.repos.sessions.updateSession({...current,modelOverride:next.modelOverride});
  }
  private voiceCatalogItems(role:'tts'|'sts'):VoiceCatalogEntry[] {
    const items:VoiceCatalogEntry[]=[];
    if(role==='tts')for(const voice of edgeTtsVoiceIds)items.push({id:`edge/${voice}`,displayName:voice,state:'ready',selectable:true,serviceId:'edge',profileId:voice});
    if(!this.profiles)return items;
    const operation=role==='tts'?new Set(['gpt-sovits.speak','breeze-tts.speak']):new Set(['rvc.convert']);
    const services=role==='tts'?new Set(['gpt-sovits','breeze-tts']):new Set(['rvc']);
    const latest=new Map<string,ReturnType<ProfileStore['list']>[number]>();
    for(const profile of this.profiles.list()){
      if(!services.has(profile.serviceId)||!profile.capabilities.some(cap=>operation.has(cap)))continue;
      const key=`${profile.serviceId}/${profile.profileId}`,previous=latest.get(key);if(!previous||profile.revision>previous.revision)latest.set(key,profile);
    }
    for(const profile of latest.values())if(profile.state==='ready')items.push({id:`${profile.serviceId}/${profile.profileId}`,displayName:sanitizePublicServiceText(profile.displayName,'Service Profile'),modelLabel:profile.modelLabel===undefined?undefined:sanitizePublicServiceText(profile.modelLabel,'Managed model'),state:profile.state,selectable:true,serviceId:profile.serviceId,profileId:profile.profileId});
    return items.sort((a,b)=>a.id.localeCompare(b.id));
  }
  private voiceSelectionId(role:'tts'|'sts',config:BotConfig):string|undefined {
    const options=role==='tts'?config.media.voice:config.media.singing;
    if(!options)return;
    if(role==='tts'&&options.protocol==='edge_tts'&&options.voice)return `edge/${options.voice}`;
    const ref=options.profileRef;return ref?`${ref.serviceId}/${ref.profileId}`:undefined;
  }
  voiceCatalog(role:'tts'|'sts',binding?:SessionBinding):VoiceCatalog {
    if(!binding)return{role,override:false,items:this.voiceCatalogItems(role)};
    const effective=this.effectiveConfig(binding),base=this.effectiveConfig({...binding,ttsOverride:undefined,stsOverride:undefined}),override=role==='tts'?binding.ttsOverride:binding.stsOverride;
    return{role,current:this.voiceSelectionId(role,base),next:this.voiceSelectionId(role,effective),override:!!override,items:this.voiceCatalogItems(role)};
  }
  async setVoice(scope:CallerScope,role:'tts'|'sts',ref:string|null,authorize?:()=>void):Promise<SessionBinding>{
    const binding=this.repos.sessions.binding(scope),config=this.effectiveConfig(binding);
    let override:TtsOverride|StsOverride|undefined=undefined;
    if(ref!==null){
      const [service,profileId,...extra]=ref.split('/');
      if(extra.length||!service||!profileId)throw new SystemMessageError('voiceIdInvalid');
      if(role==='tts'&&service==='edge'){
        if(!edgeTtsVoiceIds.includes(profileId as EdgeTtsVoiceId))throw new SystemMessageError('edgeVoiceUnavailable');
        if(config.media.voice?.enabled!==true)throw new SystemMessageError('voiceDisabled',{role:'TTS'});
        override={kind:'edge',voice:profileId as EdgeTtsVoiceId};
      }else{
        if(config.media[role==='tts'?'voice':'singing']?.enabled!==true)throw new SystemMessageError('voiceDisabled',{role:role==='tts'?'TTS':'STS'});
        if(!this.profiles)throw new SystemMessageError('voiceCatalogMissing');
        const profile=this.profiles.get({serviceId:service,profileId});
        const operation=role==='tts'?(service==='gpt-sovits'||service==='breeze-tts')?`${service}.speak`:undefined:(service==='rvc'?'rvc.convert':undefined);
        if(!profile||!operation||profile.serviceId!==service||profile.state!=='ready'||!profile.capabilities.includes(operation))throw new SystemMessageError('voiceUnavailable');
        override=role==='tts'?{kind:'profile',profileRef:{serviceId:service as 'gpt-sovits'|'breeze-tts',profileId}}:{profileRef:{serviceId:'rvc',profileId}};
      }
    }
    const current=this.repos.sessions.binding(scope);if(current.sessionId!==binding.sessionId||current.generation!==binding.generation||current.personaId!==binding.personaId)throw new SystemMessageError('sessionConfigChanged');authorize?.();
    const next:SessionBinding=role==='tts'?{...current,ttsOverride:override as TtsOverride}:{...current,stsOverride:override as StsOverride};this.repos.sessions.updateSession(next);this.recheckPermissions();return next;
  }
  async compactSession(scope:CallerScope):Promise<string>{
    if(!this.serviceRunning())throw Error('BOT_SERVICE_STOPPED');
    const binding=this.repos.sessions.binding(scope);if(this.busy(binding.key))throw new SystemMessageError('busyCompact');if(this.quiescing)throw new SystemMessageError('upgrading');if(!binding.persisted)throw new SystemMessageError('noCompactContext');if(!this.harness.compact)throw new SystemMessageError('compactUnsupported');
    const controller=new AbortController();let answer='';
    const done=Promise.resolve().then(async()=>{answer=await this.harness.compact!(binding,controller.signal);if(controller.signal.aborted)throw new SystemMessageError('compactCancelled');}).finally(()=>{this.maintenance.delete(binding.key);if(this.repos.inbox.messages(binding.key).length)this.schedule(binding.key);});
    this.maintenance.set(binding.key,{controller,sessionId:binding.sessionId,done});await done;return answer;
  }
  queueSessionAction(binding:SessionBinding,snapshot:TurnSnapshot,input:DeferredSessionAction,signal:AbortSignal):{status:'queued';actionId:string;action:string}{
    signal.throwIfAborted();const action=deferredSessionActionSchema.parse(input);const current=this.repos.sessions.findBinding(binding.key);
    if(!this.serviceRunning()||!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation||scopeKey(binding.scope)!==binding.key||scopeKey(current.scope)!==binding.key||snapshot.botId!==current.scope.botId)throw Error('SESSION_ACTION_SESSION_CHANGED');
    const processing=this.processing.get(binding.key);const ids=snapshot.sourceIds;
    if(!processing||processing.sessionId!==binding.sessionId||processing.controller.signal.aborted||!ids.length||new Set(ids).size!==ids.length||!sameSources(ids,processing.sourceIds))throw Error('SESSION_ACTION_SOURCE_INVALID');
    const sources=ids.map(id=>this.repos.inbox.source(binding.key,id));if(sources.some(m=>!m||scopeKey(m.scope)!==binding.key))throw Error('SESSION_ACTION_SOURCE_INVALID');
    const existing=this.repos.telemetry.actions.sessionActions<SessionActionRecord>().find(r=>r.scopeKey===binding.key&&r.sessionId===binding.sessionId&&r.generation===binding.generation&&sameSources(r.sourceIds,ids));
    const config=this.effectiveConfig(current);const now=Date.now();
    const record:SessionActionRecord={id:randomUUID(),action,scopeKey:binding.key,scope:{...current.scope},sessionId:current.sessionId,generation:current.generation,sourceIds:[...ids],sourceId:sources.at(-1)!.id,trusted:snapshot.trusted,personaId:config.id,personaRevision:config.revision,systemLocale:snapshot.systemLocale??'zh',state:'queued',createdAt:now,updatedAt:now};
    if(action.action==='persona')record.targetPersonaRevision=this.repos.personas.config(action.personaId).revision;
    this.authorizeSessionAction(record);
    if((action.action==='persona'||action.action==='skill')&&(snapshot.config.id!==config.id||snapshot.config.revision!==config.revision))throw Error('SESSION_ACTION_PERSONA_CHANGED');
    if(existing){if(existing.state==='queued'&&sameSessionAction(existing.action,action))return{status:'queued',actionId:existing.id,action:action.action};throw Error('SESSION_ACTION_ALREADY_QUEUED');}
    // Only host-observed sources and reply metadata are saved. Tools never choose a caller.
    this.repos.telemetry.actions.saveSessionAction(record.id,record);const controller=new AbortController();
    const cancel=()=>{controller.abort();const saved=this.repos.telemetry.actions.findSessionAction<SessionActionRecord>(record.id);if(saved&&['queued','running'].includes(saved.state))this.finishSessionAction(saved,'cancelled',systemMessage(saved.systemLocale??'zh','actionCancelled'));};
    signal.addEventListener('abort',cancel,{once:true});this.sessionActionSignals.set(record.id,{controller,dispose:()=>signal.removeEventListener('abort',cancel)});
    return{status:'queued',actionId:record.id,action:action.action};
  }
  private authorizeSessionAction(record:SessionActionRecord):SessionBinding {
    if(!this.serviceRunning())throw Error('SESSION_ACTION_CANCELLED');
    const current=this.repos.sessions.findBinding(record.scopeKey);
    if(!current||current.sessionId!==record.sessionId||current.generation!==record.generation||scopeKey(current.scope)!==record.scopeKey||scopeKey(record.scope)!==record.scopeKey)throw Error('SESSION_ACTION_SESSION_CHANGED');
    const bot=this.repos.bots.bot(current.scope.botId);if(!bot.enabled||bot.archived||bot.accountId!==current.scope.accountId||bot.channel!==current.scope.platform)throw Error('SESSION_ACTION_BOT_DISABLED');
    this.sessionActionSignals.get(record.id)?.controller.signal.throwIfAborted();
    const saved=this.repos.telemetry.actions.findSessionAction<SessionActionRecord>(record.id);if(saved&&!['queued','running'].includes(saved.state))throw Error('SESSION_ACTION_CANCELLED');
    if(!record.sourceIds.length||!record.sourceIds.includes(record.sourceId)||record.sourceIds.some(id=>{const source=this.repos.inbox.source(record.scopeKey,id);return!source||scopeKey(source.scope)!==record.scopeKey;}))throw Error('SESSION_ACTION_SOURCE_INVALID');
    if(record.action.action==='persona'||record.action.action==='skill'){
      if(!record.trusted||!trusted(bot,current.scope))throw Error('TRUSTED_PRIVATE_REQUIRED');
      const config=this.effectiveConfig(current);if(config.id!==record.personaId||config.revision!==record.personaRevision)throw Error('SESSION_ACTION_PERSONA_CHANGED');
      if(record.action.action==='persona'&&this.repos.personas.config(record.action.personaId).revision!==record.targetPersonaRevision)throw Error('SESSION_ACTION_PERSONA_CHANGED');
    }
    return current;
  }
  private finishSessionAction(record:SessionActionRecord,state:SessionActionRecord['state'],result:string):void {
    const next={...record,state,result,updatedAt:Date.now()};const source=this.repos.inbox.source(record.scopeKey,record.sourceId);const binding=this.repos.sessions.findBinding(record.scopeKey);
    const outputs:Output[]=[];for(let i=0;i<result.length;i+=1800)outputs.push({type:'text',text:result.slice(i,i+1800)});
    this.repos.unitOfWork.transaction(()=>{this.repos.telemetry.actions.saveSessionAction(record.id,next);if(source&&binding&&scopeKey(source.scope)===record.scopeKey&&scopeKey(binding.scope)===record.scopeKey)this.repos.deliveries.enqueue(binding,source.id,`session-action:${record.id}`,outputs,source.reply,this.replyEnvelope(source));});
    this.sessionActionSignals.get(record.id)?.dispose();this.sessionActionSignals.delete(record.id);
  }
  sessionActionActive(scopeKey:string):boolean{return this.repos.telemetry.actions.sessionActions<SessionActionRecord>().some(record=>record.scopeKey===scopeKey&&['queued','running'].includes(record.state));}
  cancelSessionActions(key:string,reason:string|MessageDescriptor,preserveActionId?:string):void {
    for(const record of this.repos.telemetry.actions.sessionActions<SessionActionRecord>())if(record.scopeKey===key&&record.id!==preserveActionId&&['queued','running'].includes(record.state)){
      this.sessionActionSignals.get(record.id)?.controller.abort();this.finishSessionAction(record,'cancelled',typeof reason==='string'?reason:formatSystemMessage(reason,record.systemLocale??'zh')??reason.key);
    }
  }
  resumeSessionActions(key?:string):void {
    if(!this.serviceRunning()||this.quiescing)return;
    for(const record of this.repos.telemetry.actions.sessionActions<SessionActionRecord>().sort((a,b)=>a.createdAt-b.createdAt)){
      if(record.state!=='queued'||(key&&record.scopeKey!==key)||this.busy(record.scopeKey)||this.scheduledSessionActions.has(record.id))continue;
      const scope=record.scopeKey;const previous=this.controls.get(scope)??Promise.resolve();this.scheduledSessionActions.add(record.id);
      // Never await this chain from processing.done: an earlier /stop may be waiting for it.
      const task=previous.catch(()=>{}).then(async()=>{if(this.serviceRunning()&&!this.quiescing)await this.executeSessionAction(record.id);}).finally(()=>{
        this.scheduledSessionActions.delete(record.id);if(this.controls.get(scope)===task){this.controls.delete(scope);this.resumeSessionActions(scope);if(this.repos.inbox.messages(scope).length)this.schedule(scope);}
      });this.controls.set(scope,task);
    }
  }
  private async executeSessionAction(id:string):Promise<void>{
    let record=this.repos.telemetry.actions.findSessionAction<SessionActionRecord>(id);if(!record||record.state!=='queued')return;const locale=record.systemLocale??'zh';
    try{
      const binding=this.authorizeSessionAction(record);record={...record,state:'running',updatedAt:Date.now()};this.repos.telemetry.actions.saveSessionAction(id,record);
      if(!this.sessionActionSignals.has(id))this.sessionActionSignals.set(id,{controller:new AbortController(),dispose:()=>{}});
      const authorize=()=>{this.authorizeSessionAction(record!);};let result:string;
      switch(record.action.action){
        case 'new':result=systemMessage(locale,'newSession',{id:(await this.newSession(binding.scope,id,authorize)).sessionId});break;
        case 'stop':await this.stopSession(binding.scope,id);authorize();result=systemMessage(locale,'stopped');break;
        case 'compact':result=await this.compactSession(binding.scope)||systemMessage(locale,'compacted');authorize();break;
        case 'resume':result=systemMessage(locale,'resumedSession',{id:(await this.resumeSession(binding.scope,record.action.sessionId,authorize)).sessionId});break;
        case 'persona':await this.switchPersona(binding.scope,record.action.personaId,authorize);result=systemMessage(locale,'personaSwitched',{id:record.action.personaId});break;
        case 'skill':if(!this.commandServices.skills)throw new SystemMessageError('skillServiceMissing');result=await this.commandServices.skills.toggle(binding,skillNameSchema.parse(record.action.name),record.action.enabled,authorize,locale);break;
      }
      if(this.repos.telemetry.actions.findSessionAction<SessionActionRecord>(id)?.state==='running')this.finishSessionAction(record,'succeeded',result);
    }catch(error){if(this.repos.telemetry.actions.findSessionAction<SessionActionRecord>(id)?.state!=='cancelled')this.finishSessionAction(record,'failed',systemMessage(locale,'actionFailed',{error:systemErrorText(error,locale,'commandFailed')}));}
    await this.flushDeliveries();
  }
  private assertTrusted(binding:SessionBinding,host=false):void {const bot=this.repos.bots.bot(binding.scope.botId);if(!bot.enabled||bot.archived||!trusted(bot,binding.scope))throw new SystemMessageError('trustedRequired');if(host&&!this.effectiveConfig(binding).allowHostTools)throw new SystemMessageError('hostToolsRequired');}
  private replyEnvelope(message:InboundMessage){const normalize=this.channels.require(message.scope.platform).normalizeReply;return normalize?normalize(message.replyEnvelope??message.reply):message.replyEnvelope;}
  private async feedback(message:InboundMessage,text:string):Promise<void>{const binding=this.repos.sessions.binding(message.scope);const outputs:Output[]=[];for(let i=0;i<text.length;i+=1800)outputs.push({type:'text',text:text.slice(i,i+1800)});this.repos.deliveries.enqueue(binding,message.id,`command:${message.id}`,outputs,message.reply,this.replyEnvelope(message));await this.flushDeliveries();}
  async dispatchCommand(message:InboundMessage,command:ParsedCommand):Promise<void>{
    if(!this.serviceRunning())return;
    const key=scopeKey(message.scope),locale=this.systemLocale();
    // Cancellation bypasses the control queue so it can interrupt a compact or long validation.
    if(['stop','new','reset'].includes(command.name))this.interrupt(message.scope);
    const previous=this.controls.get(key)??Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      if(!this.serviceRunning())return;try{
        const result=await this.executeCommand(message,command,locale);if(result!==undefined)await this.feedback(message,result);
        if(!['compact','evolve'].includes(command.name)||!this.repos.inbox.messages(key,['pending','processing']).some(m=>m.id===message.id))this.repos.inbox.mark(key,[message.id],'complete');
      }catch(error){this.repos.inbox.mark(key,[message.id],'failed');await this.feedback(message,systemErrorText(error,locale,'commandFailed'));}
    }).finally(()=>{if(this.controls.get(key)===task){this.controls.delete(key);if(this.repos.inbox.messages(key).length)this.schedule(key);}});
    this.controls.set(key,task);return task;
  }
  private async executeCommand(message:InboundMessage,parsed:ParsedCommand,locale:SystemLocale):Promise<string|undefined>{
    const binding=this.repos.sessions.binding(message.scope);const command=managementCommand(parsed);const config=this.effectiveConfig(binding);
    if(!command){const privileged=trusted(this.repos.bots.bot(binding.scope.botId),binding.scope);return systemMessage(locale,'unknownCommand',{name:parsed.name,help:commandHelp(privileged,config.allowHostTools,locale)});}
    const result=await this.commandBus.execute({source:message.text.trimStart().startsWith('/')?'slash':'natural',binding,systemLocale:locale,signal:(this.turnTimeoutMs>0?AbortSignal.timeout(this.turnTimeoutMs):new AbortController().signal)},command);
    if(result.kind==='reply')return result.text;
    if(result.kind==='deferred'){
      // Do not await the model here: iLink's receive loop must remain available for /stop.
      void result.task.then(async text=>{if(this.repos.sessions.binding(message.scope).sessionId===result.sessionId)await this.feedback(message,text);}).catch(async error=>{if(this.repos.sessions.binding(message.scope).sessionId===result.sessionId)await this.feedback(message,systemErrorText(error,locale,'compactFailed'));});return undefined;
    }
    if(result.kind==='rewrite'){
      this.assertTrusted(this.repos.sessions.binding(message.scope),true);this.repos.inbox.updateMessage(binding.key,{...message,text:result.text});this.repos.inbox.mark(binding.key,[message.id],'pending');this.schedule(binding.key);
    }
    return undefined;
  }
  private inboundCommand(message:InboundMessage):ParsedCommand|undefined{return parseCommand(message.text)??(message.text.trimStart().startsWith('//')?undefined:parseNaturalControl(message.text));}
  resumeCommands():void{if(!this.serviceRunning())return;for(const key of this.repos.inbox.scopesWithPending(['control']))for(const message of this.repos.inbox.messages(key,['control'])){const command=this.inboundCommand(message);if(command)void this.dispatchCommand(message,command);}}
  async drainControls():Promise<void>{await Promise.all([...this.controls.values()].map(task=>task.catch(()=>{})));}
  pauseProcessing():void{this.quiescing=true;this.automation.close();for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}
  async quiesce():Promise<void>{this.pauseProcessing();for(;;){await this.drainControls();await Promise.all([...this.processing.values(),...this.maintenance.values()].map(task=>task.done.catch(()=>{})));await this.automation.drain();await this.harness.drain?.();await this.flushDeliveries();await this.deliveryWorker.drain();if(!this.controls.size&&!this.processing.size&&!this.maintenance.size&&!this.deliveryWorker.activity().activeLanes)return;}}
  resumeProcessing():void{this.quiescing=false;this.resumeServiceConsumers();}
  private schedule(key:string):void{if(!this.serviceRunning()||this.quiescing)return;const previous=this.timers.get(key);if(previous)clearTimeout(previous);this.timers.set(key,setTimeout(()=>{this.timers.delete(key);void this.process(key);},this.debounceMs));}
  async process(key:string):Promise<void>{
    if(!this.serviceRunning()||this.quiescing||this.busy(key)||this.controls.has(key))return;
    const pending=this.repos.inbox.messages(key);if(!pending.length)return;const locale=this.systemLocale();
    const bot=this.repos.bots.bot(pending[0].scope.botId);if(!bot.enabled||bot.archived)return;
    const deferred=this.repos.inbox.messages(key,['deferred']).filter(m=>m.timestamp>Date.now()-600000).slice(-INPUT_LIMITS.batchMessages);
    const messages=[...deferred,...pending].slice(-INPUT_LIMITS.batchMessages);
    const binding=this.repos.sessions.binding(pending[0].scope);
    const audioSourceMessageIds=new Set<string>();
    let waitingForSinging=hasPendingSingingUpload(this.sessionPorts,binding);
    if(permitted('bot_sing',this.effectiveConfig(binding),bot,binding.scope))for(const message of messages){
      if((explicitSingingRequest(message.text)||waitingForSinging)&&message.attachments.some(input=>input.kind==='audio'||input.kind==='file')){
        audioSourceMessageIds.add(message.id);waitingForSinging=false;
      }
    }
    try{validateBatch(messages,id=>this.repos.media.assets.asset(key,id).size,{audioSourceMessageIds});}catch(error){
      const sourceIds=messages.map(m=>m.id);const at=Date.now();this.repos.inbox.mark(key,sourceIds,'failed');
      this.repos.telemetry.failures.saveFailure(`${key}:${at}`,{sessionId:binding.sessionId,scope:key,code:error instanceof Error?error.message:'BATCH_INPUT_TOO_LARGE',state:'failed',stage:'attachments',sourceIds,at} satisfies ProcessingFailure);
      this.repos.deliveries.enqueue(binding,pending.at(-1)!.id,`failure:${pending.at(-1)!.id}`,[{type:'text',text:systemMessage(locale,'batchTooLarge')}],pending.at(-1)!.reply,this.replyEnvelope(pending.at(-1)!));
      await this.flushDeliveries();return;
    }
    const controller=new AbortController();
    const deadline=(this.turnTimeoutMs>0?AbortSignal.timeout(this.turnTimeoutMs):new AbortController().signal);const signal=AbortSignal.any([controller.signal,deadline]);
    this.repos.inbox.mark(key,messages.map(m=>m.id),'processing');this.repos.telemetry.metrics.markTurnStage(key,messages.map(m=>m.id),'attachmentsStartedAt');
    const done=Promise.resolve().then(async()=>{
      let autoAsrFailure=false;
      let progress:TaskProgress|undefined;
      try{
      let stage:ProcessingFailure['stage']='attachments';const outputs:Output[]=[];let stagedTurnId:string|undefined;
      try{
        const snapshot=freezeTurn(this.effectiveConfig(binding),bot,binding.scope,messages.map(m=>m.id),this.profiles,locale,this.media.imageSettings());
        this.repos.telemetry.snapshots.saveTurnSnapshot(binding.sessionId,snapshot);
        const config=snapshot.config as BotConfig;
        const active=()=>{
          const current=this.repos.sessions.findBinding(key);
          return !this.closed&&!signal.aborted&&this.processing.get(key)?.controller===controller&&current?.sessionId===binding.sessionId&&current.generation===binding.generation&&!permissionsRevoked(snapshot,this.effectiveConfig(current),this.repos.bots.bot(bot.id),binding.scope);
        };
        signal.throwIfAborted();
        if(binding.scope.kind==='private'&&config.progressReply.enabled){
          progress=new TaskProgress({signal,active,systemLocale:snapshot.systemLocale,
            intervalMs:config.progressReply.intervalSeconds*1000,
            format:(facts,progressSignal)=>this.harness.formatProgress?.(binding,snapshot,facts,progressSignal)??Promise.resolve(progressFallback(facts.stage,snapshot.systemLocale)),
            deliver:async(text,runId,sequence,expiresAt)=>{
              if(!active())return;
              for(const delivery of this.repos.deliveries.deliveries(['pending']))if(delivery.purpose==='progress'&&delivery.progress?.runId===runId)this.repos.deliveries.deliveryState(delivery,'cancelled');
              const source=pending.at(-1)!;
              this.repos.deliveries.enqueue(binding,source.id,`progress:${runId}:${sequence}`,[{type:'text',text}],source.reply,this.replyEnvelope(source),{runId,generation:binding.generation,expiresAt});
              await this.deliveryWorker.flush({botId:bot.id});
            },
            cancel:runId=>this.deliveryWorker.cancelProgress(runId),
          });
          this.deliveryWorker.registerProgress(progress.runId,active);
        }
        signal.throwIfAborted();
        const transcripts=new Map<string,string>();
        const ensureTranscript=async(input:InboundMessage['attachments'][number],assetId:string):Promise<void>=>{
          if(input.kind!=='audio'||input.transcript)return;
          const previous=transcripts.get(assetId);
          if(previous){input.transcript=previous;return;}
          autoAsrFailure=true;progress?.update('transcription');
          if(!analysisEnabled(config,'asr'))throw new Error('MEDIA_ANALYSIS_DISABLED');
          const result=await this.media.run(key,'transcribe',config,[assetId],{question:'Transcribe this audio faithfully in its original language.'},signal,()=>{if(!active())throw new Error('MEDIA_TOOL_DISABLED');},snapshot);
          let value:any;try{value=result.text?JSON.parse(result.text):undefined;}catch{value=undefined;}
          const transcript=typeof value?.transcript==='string'?value.transcript.trim():'';
          if(!transcript)throw new Error('EMPTY_TRANSCRIPT');
          transcripts.set(assetId,transcript);input.transcript=transcript;autoAsrFailure=false;progress?.update('attachments');
        };
        for(const message of messages){
          // Only this user's own text or an explicit upload request may bypass ASR.
          const singingUpload=allowedNow('bot_sing',snapshot,this.effectiveConfig(binding),bot,binding.scope)
            &&audioSourceMessageIds.has(message.id);
          if(message.quoted?.id){const quoted=this.repos.inbox.source(key,message.quoted.id);if(quoted)message.quoted={id:quoted.id,text:quoted.text,attachments:quoted.attachments};}
          for(const input of [...message.attachments,...(message.quoted?.attachments??[])]){
            const skipAsr=singingUpload&&message.attachments.includes(input);
            if(input.handle){this.repos.media.assets.asset(key,input.handle);if(!skipAsr)await ensureTranscript(input,input.handle);continue;}
            const bytes=input.bytes?Buffer.from(input.bytes,'base64'):await this.channels.require(bot.channel).adapter.materialize(input,signal);
            const asset=await this.assets.save(key,input,bytes);input.handle=asset.id;delete input.bytes;if(!skipAsr)await ensureTranscript(input,asset.id);
          }
          if(singingUpload)consumeSingingUpload(this.sessionPorts,binding);
          this.repos.inbox.updateMessage(key,message);
        }
        this.repos.telemetry.metrics.markTurnStage(key,messages.map(m=>m.id),'attachmentsCompletedAt');
        stage='model';progress?.update('model');const modelAt=Date.now();this.repos.telemetry.metrics.updateTurnMetrics(key,messages.map(m=>m.id),{sessionId:binding.sessionId,modelStartedAt:modelAt});const result=await this.harness.run(binding,messages,signal,{snapshot,onProgress:stage=>progress?.update(stage),onText:async message=>{
          signal.throwIfAborted();if(!active())throw new ReplyContextChangedError();if(!message.text.trim())return;
          stagedTurnId=message.turnId;
          // Keep already-enqueued chunks unchanged so their output indexes remain stable.
          for(let index=0;index<message.text.length;index+=1800)outputs.push({type:'text',text:message.text.slice(index,index+1800)});
          const source=pending.at(-1)!;this.repos.deliveries.enqueue(binding,source.id,stagedTurnId,outputs,source.reply,this.replyEnvelope(source));
          await this.deliveryWorker.flush({botId:bot.id});
        }});
        if(signal.aborted||this.repos.sessions.binding(binding.scope).sessionId!==binding.sessionId){this.repos.inbox.mark(key,messages.map(m=>m.id),'cancelled');return;}
        this.repos.telemetry.metrics.markTurnStage(key,messages.map(m=>m.id),'modelCompletedAt');
        stage='delivery';const prepared=await this.prepareReplyOutputs(binding,result,signal,()=>progress?.update('media'));signal.throwIfAborted();progress?.stop();
        for(const output of prepared){if(output.type==='text'&&output.text){for(let index=0;index<output.text.length;index+=1800)outputs.push({type:'text',text:output.text.slice(index,index+1800)});}else if(output.type==='asset'){this.repos.media.assets.asset(key,output.assetId!);outputs.push(output);}}
        if(!outputs.length)throw new Error('NO_DELIVERABLE_OUTPUT');
        this.repos.telemetry.metrics.updateTurnMetrics(key,messages.map(m=>m.id),{turnId:result.turnId,deliveryStartedAt:Date.now()});this.repos.unitOfWork.transaction(()=>{this.repos.deliveries.enqueue(binding,pending.at(-1)!.id,result.turnId,outputs,pending.at(-1)!.reply,this.replyEnvelope(pending.at(-1)!));this.repos.inbox.mark(key,messages.map(m=>m.id),'complete');});
      }catch(error){
        progress?.stop();
        const timedOut=deadline.aborted&&!controller.signal.aborted;const state=timedOut?'failed':controller.signal.aborted||signal.aborted||error instanceof ReplyContextChangedError?'cancelled':'failed';const at=Date.now();
        this.repos.inbox.mark(key,messages.map(m=>m.id),state);this.repos.telemetry.failures.saveFailure(`${binding.sessionId}:${at}`,{sessionId:binding.sessionId,scope:key,code:timedOut?'TURN_DEADLINE_EXCEEDED':error instanceof Error?error.message:'PROCESS_FAILED',state,stage,sourceIds:messages.map(m=>m.id),at} satisfies ProcessingFailure);
        const noDeliverableOutput=error instanceof Error&&error.message==='NO_DELIVERABLE_OUTPUT';
        if(state==='failed'&&(stage!=='delivery'||noDeliverableOutput)&&this.repos.sessions.binding(binding.scope).sessionId===binding.sessionId){
          const image=messages.some(m=>[...m.attachments,...(m.quoted?.attachments??[])].some(a=>a.kind==='image'));
          const text=systemMessage(locale,noDeliverableOutput?'noOutput':timedOut?'requestTimeout':autoAsrFailure?'asrFailed':stage==='attachments'?(image?'imageReadFailed':'attachmentReadFailed'):'modelFailed',{code:modelFailureCode(error)});
          outputs.push({type:'text',text});this.repos.deliveries.enqueue(binding,pending.at(-1)!.id,stagedTurnId??`failure:${pending.at(-1)!.id}`,outputs,pending.at(-1)!.reply,this.replyEnvelope(pending.at(-1)!));
        }
      }
      // Queue workers own delivery failures; they must not relabel completed model requests.
      await this.flushDeliveries();
      }finally{progress?.stop();this.processing.delete(key);this.resumeSessionActions(key);if(this.repos.inbox.messages(key).length)this.schedule(key);}
    });
    this.processing.set(key,{controller,sessionId:binding.sessionId,sourceIds:messages.map(m=>m.id),done});await done;
  }
  async flushDeliveries():Promise<void>{if(this.serviceRunning())await this.deliveryWorker.flush();}
  private assertReplyContext(binding:SessionBinding,snapshot:TurnSnapshot,signal:AbortSignal):void {
    signal.throwIfAborted();
    if(!this.serviceRunning())throw new ReplyContextChangedError();
    const current=this.repos.sessions.findBinding(binding.key);
    if(this.closed||!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation)throw new ReplyContextChangedError();
    try{
      if(permissionsRevoked(snapshot,this.effectiveConfig(current),this.repos.bots.bot(binding.scope.botId),binding.scope))throw new ReplyContextChangedError();
    }catch{throw new ReplyContextChangedError();}
  }
  private async prepareReplyOutputs(binding:SessionBinding,result:HarnessResult,signal:AbortSignal,onVoice?:()=>void):Promise<Output[]> {
    const outputs=await this.prepareVoiceReplyOutputs(binding,result,signal,onVoice);
    const adapter=this.channels.require(this.repos.bots.bot(binding.scope.botId).channel).adapter;
    if(!adapter.prepareOutbound)return outputs;
    try{
      const prepared=await adapter.prepareOutbound({binding,outputs:outputs.map(output=>({...output})),signal,authorize:()=>signal.throwIfAborted()});
      return prepared;
    }catch(error){
      if(error instanceof ReplyContextChangedError)throw error;
      const files=outputs.map(output=>output.type==='asset'&&this.repos.media.assets.asset(binding.key,output.assetId!).kind==='audio'?{...output,asFile:true}:output);
      return replyNotice(files,systemMessage(result.snapshot.systemLocale??'zh','voicePreparationFailed'));
    }
  }
  private async prepareVoiceReplyOutputs(binding:SessionBinding,result:HarnessResult,signal:AbortSignal,onVoice?:()=>void):Promise<Output[]> {
    const snapshot=result.snapshot,config=snapshot.config as BotConfig;
    if(config.media.voice?.replyMode!=='auto'||!analysisEnabled(config,'tts')||result.voiceAttempted||result.singingAttempted)return result.outputs;
    const voiceService=snapshot.services.voice;
    if(config.media.voice?.protocol!=='edge_tts'&&(!voiceService?.snapshot||!['ready','partial'].includes(voiceService.state)))return replyNotice(result.outputs,systemMessage(snapshot.systemLocale??'zh','voiceProfileUnavailable'));
    const text=spokenReplyText(result.outputs);if(!text)return result.outputs;
    const authorize=()=>{
      this.assertReplyContext(binding,snapshot,signal);
      const current=this.repos.sessions.findBinding(binding.key)!;
      if(!allowedNow('bot_voice',snapshot,this.effectiveConfig(current),this.repos.bots.bot(binding.scope.botId),binding.scope))throw new ReplyContextChangedError();
    };
    authorize();onVoice?.();
    try{
      const voice=await this.media.run(binding.key,'voice_speak',config,[],{mode:'speak',text},signal,authorize,snapshot);
      authorize();
      if(!voice.assetIds.length||voice.incomplete)throw new Error('VOICE_OUTPUT_MISSING');
      for(const id of voice.assetIds)if(this.repos.media.assets.asset(binding.key,id).kind!=='audio')throw new Error('VOICE_OUTPUT_INVALID');
      return [...replyNotice(result.outputs,systemMessage(snapshot.systemLocale??'zh','voiceAttached')),...voice.assetIds.map(assetId=>({type:'asset' as const,assetId}))];
    }catch(error){
      // A cancelled/revoked turn must never be resurrected by the text fallback.
      authorize();if(error instanceof ReplyContextChangedError)throw error;
      return replyNotice(result.outputs,systemMessage(snapshot.systemLocale??'zh','voiceGenerationFailed'));
    }
  }
  private async runAutomationPrompt(binding:SessionBinding,prompt:string,kind:AutomationKind,signal:AbortSignal,onText?:HarnessRunOptions['onText']):Promise<{turnId:string;outputs:Output[];snapshot:TurnSnapshot}>{
    const key=binding.key;
    if(!this.serviceRunning()||this.quiescing||this.busy(key)||this.controls.has(key))throw Error('AUTOMATION_BUSY');
    this.assertTrusted(binding);
    const sourceId=`automation:${randomUUID()}`,latest=this.repos.inbox.allMessages().filter(message=>scopeKey(message.scope)===key).at(-1);
    if(!latest)throw Error('AUTOMATION_CONTEXT_MISSING');
    const controller=new AbortController();
    const deadline=this.turnTimeoutMs>0?AbortSignal.timeout(this.turnTimeoutMs):new AbortController().signal;
    const runSignal=AbortSignal.any([signal,controller.signal,deadline]);
    let config=this.effectiveConfig(binding);
    if(kind==='proactive'&&!this.automation.listProactive().find(item=>item.scopeKey===key)?.allowWeb)config={...config,tools:config.tools.filter(name=>!['web_search','web_fetch','bot_read_social'].includes(name))};
    const snapshot=freezeTurn(config,this.repos.bots.bot(binding.scope.botId),binding.scope,[sourceId],this.profiles,this.systemLocale(),this.media.imageSettings());
    this.repos.telemetry.snapshots.saveTurnSnapshot(binding.sessionId,snapshot);
    const synthetic:InboundMessage={id:sourceId,scope:binding.scope,text:prompt,attachments:[],reply:latest.reply,replyEnvelope:latest.replyEnvelope,timestamp:Date.now()};
    let answer:{turnId:string;outputs:Output[];snapshot:TurnSnapshot}|undefined;
    const done=Promise.resolve().then(async()=>{
      runSignal.throwIfAborted();
      let result:HarnessResult,stagedTurnId:string|undefined;
      try{
        result=await this.harness.run(binding,[synthetic],runSignal,{snapshot,onText:async message=>{
          this.assertReplyContext(binding,snapshot,runSignal);if(!message.text.trim())return;
          await onText?.(message);stagedTurnId=message.turnId;
        }});
      }catch(error){
        if(stagedTurnId&&!controller.signal.aborted&&!signal.aborted&&!(error instanceof ReplyContextChangedError)){
          this.assertReplyContext(binding,snapshot,controller.signal);
          await onText?.({turnId:stagedTurnId,text:systemMessage(snapshot.systemLocale??'zh',deadline.aborted?'requestTimeout':'modelFailed',{code:modelFailureCode(error)})});
        }
        throw error;
      }
      runSignal.throwIfAborted();const current=this.repos.sessions.findBinding(key);
      if(!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation||permissionsRevoked(snapshot,this.effectiveConfig(current),this.repos.bots.bot(binding.scope.botId),binding.scope))throw Error('AUTOMATION_CONTEXT_CHANGED');
      answer={turnId:result.turnId,outputs:await this.prepareReplyOutputs(binding,result,runSignal),snapshot};
    }).finally(()=>{this.processing.delete(key);this.resumeSessionActions(key);if(this.repos.inbox.messages(key).length)this.schedule(key);});
    this.processing.set(key,{controller,sessionId:binding.sessionId,sourceIds:[],done});
    await done;return answer!;
  }
  private async automationCommand(binding:SessionBinding,action:'on'|'off'|'status'|'now'|'set',args:string,locale:SystemLocale=this.systemLocale()):Promise<string>{
    const current=this.automation.listProactive().find(item=>item.scopeKey===binding.key);if(action==='status')return current?systemMessage(locale,'proactiveStatus',{state:systemMessage(locale,current.enabled?'enabled':'disabled'),limit:current.dailyLimit,from:current.quietFrom,to:current.quietTo,timezone:current.timezone}):systemMessage(locale,'proactiveMissing');
    if(action==='on'||action==='off'){const next=this.automation.setProactive(binding.scope,action==='on');return systemMessage(locale,next.enabled?'proactiveEnabled':'proactiveDisabled');}if(action==='now'){this.automation.queueProactive(binding.scope);return systemMessage(locale,'proactiveQueued');}
    if(action==='set'){const patch:Record<string,unknown>={};for(const part of args.split(/\s+/).filter(Boolean)){const [key,value]=part.split('=',2);if(key&&value!==undefined)patch[key]=value==='true'||value==='false'?value==='true':/^\d+$/.test(value)?Number(value):value;}this.automation.configureProactive(binding.scope,patch);return systemMessage(locale,'proactiveUpdated');}return systemMessage(locale,'proactiveUsage');
  }
  private async scheduleCommand(binding:SessionBinding,action:'list'|'create'|'pause'|'resume'|'run'|'delete',args:string,locale:SystemLocale=this.systemLocale()):Promise<string>{
    if(action==='list'){const rows=this.automation.listJobs().filter(item=>item.scopeKey===binding.key);return rows.length?rows.map(item=>`${item.id} ${systemMessage(locale,item.enabled?'enabled':'paused')} ${item.prompt.slice(0,80)}`).join('\n'):systemMessage(locale,'noSchedules');}
    if(action==='create'){
      let input:unknown;try{input=JSON.parse(args);}catch{const match=/^(\d+)(?:\s+([\s\S]+))?$/.exec(args);if(match)input={delayMs:Number(match[1]),prompt:match[2]??systemMessage(locale,'scheduleDefaultPrompt')};}
      const value=botScheduleArgumentsSchema.parse({...input as object,action:'create'});
      const job=this.automation.createJob(binding.scope,value.prompt!,{runAt:value.runAt?Date.parse(value.runAt):value.delayMs?Date.now()+value.delayMs:undefined,intervalMs:value.intervalMs,dailyAt:value.dailyAt,timezone:value.timezone});
      return systemMessage(locale,'scheduleCreated',{id:job.id,time:new Date(job.nextAt!).toISOString(),timezone:job.timezone});
    }
    const id=args.trim();if(!id)throw new SystemMessageError('scheduleIdRequired');const job=this.automation.listJobs().find(item=>item.id===id&&item.scopeKey===binding.key);if(!job)throw new SystemMessageError('scheduleMissing');if(action==='pause'||action==='resume'){this.automation.setJob(id,action==='resume');return systemMessage(locale,action==='resume'?'scheduleResumed':'schedulePaused');}if(action==='delete'){this.automation.deleteJob(id);return systemMessage(locale,'scheduleDeleted');}if(action==='run'){this.automation.queueJob(job);return systemMessage(locale,'scheduleQueued');}return systemMessage(locale,'scheduleUsage');
  }
  async close():Promise<void>{this.closed=true;this.serviceActive=false;this.automation.close();for(const timer of this.timers.values())clearTimeout(timer);for(const [key,task] of [...this.processing.entries(),...this.maintenance.entries()]){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}await this.serviceChange.catch(()=>{});await this.deliveryWorker.close();await this.connectionSupervisor.disconnectAll();await Promise.all([...this.processing.values(),...this.maintenance.values()].map(p=>p.done.catch(()=>{})));await this.automation.drain();await this.drainControls();await this.deliveryWorker.drain();for(const signal of this.sessionActionSignals.values())signal.dispose();this.sessionActionSignals.clear();await this.harness.dispose();if(this.claimed){this.repos.lifecycle.release(this.owner);this.claimed=false;}}
}

