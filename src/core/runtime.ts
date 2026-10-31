import { Store, scopeKey } from './store.js';
import { Assets, MediaService } from './media.js';
import type { BotConfig, BotInstance, InboundMessage, SessionBinding, Output, TurnSnapshot, CallerScope } from './types.js';
import {randomUUID} from 'node:crypto';
import {freezeTurn,permissionsRevoked,trusted} from './policy.js';
import {TaskProgress,progressFallback} from './progress.js';
import {analysisEnabled} from './analysis.js';
import {botSchema,modelSchema,skillNameSchema} from './types.js';
import {validateWorkingDirectory} from './workspaces.js';
import {parseCommand,unescapeChat,commandHelp,type ParsedCommand} from './commands.js';
import {parseNaturalControl} from './natural-commands.js';
import {CommandBus,managementCommand,type CommandServices} from './command-bus.js';
import type {ChannelRegistry} from './channel-registry.js';
import {deferredSessionActionSchema,sameSessionAction,sameSources,type DeferredSessionAction,type SessionActionRecord} from './session-actions.js';
import {validateBatch,INPUT_LIMITS} from './limits.js';
import {DurableDeliveryWorker,type DeliveryWorker} from './delivery-worker.js';
import {DurableConnectionSupervisor,type ConnectionSupervisor} from './connection-supervisor.js';
import type {ProcessingFailure} from './failure-context.js';
import {AutomationScheduler,type AutomationKind} from './automation.js';
import {botScheduleArgumentsSchema} from './automation-contract.js';

function modelFailureCode(error:unknown):string {
  const message=error instanceof Error?error.message:typeof error==='string'?error:'MODEL_REQUEST_FAILED';
  return message.match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0]??'MODEL_REQUEST_FAILED';
}

export type {HarnessResult,HarnessPort,Credentials} from './runtime-ports.js';
import type {HarnessPort,Credentials} from './runtime-ports.js';
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
  private readonly owner=randomUUID();
  private claimed=false;
  activeSessions(botId:string):number {return [...new Set([...this.processing.keys(),...this.maintenance.keys()])].filter(key=>this.store.findBinding(key)?.scope.botId===botId).length;}
  effectiveConfig(binding:SessionBinding):BotConfig{return this.store.effectiveConfig(binding);}
  bot(scope:CallerScope){return this.store.bot(scope.botId);}
  binding(scope:CallerScope){return this.store.binding(scope);}
  configs(){return this.store.configs();}
  sessions(scope:CallerScope){return this.store.sessions(scope);}
  session(scope:CallerScope,id:string){return this.store.session(scope,id);}
  busy(value:SessionBinding|string):boolean{const key=typeof value==='string'?value:value.key;return this.processing.has(key)||this.maintenance.has(key);}
  models(){return this.harness.models?this.harness.models():Promise.resolve([]);}
  sessionStatus(scope:CallerScope):'waiting_upgrade'|'compacting'|'running'|'idle'{const key=scopeKey(scope);return this.quiescing?'waiting_upgrade':this.maintenance.has(key)?'compacting':this.processing.has(key)||this.store.sessionActions<SessionActionRecord>().some(r=>r.scopeKey===key&&r.state==='running')?'running':'idle';}
  health():{ready:true;quiescing:boolean;activeTasks:number;pendingDeliveries:number;pendingSessionActions:number;connections:Record<string,string>;latency:{inboxToModel:{count:number;p50:number|null;p95:number|null;max:number|null};inboxToSent:{count:number;p50:number|null;p95:number|null;max:number|null}}}{return{ready:true,quiescing:this.quiescing,activeTasks:this.processing.size+this.maintenance.size+this.controls.size,pendingDeliveries:this.store.deliveries(['pending','sending']).length,pendingSessionActions:this.store.sessionActions<SessionActionRecord>().filter(r=>r.state==='queued').length,connections:Object.fromEntries(this.states),latency:{inboxToModel:this.store.metricPercentiles('modelStartedAt'),inboxToSent:this.store.metricPercentiles('sentAt')}};}
  constructor(readonly store:Store,readonly assets:Assets,readonly media:MediaService,readonly harness:HarnessPort,readonly channels:ChannelRegistry,readonly credentials:Credentials,readonly debounceMs=2000,readonly turnTimeoutMs=0){
    this.connectionSupervisor=new DurableConnectionSupervisor(store,this.channels,credentials,this.states,message=>this.receive(message));this.deliveryWorker=new DurableDeliveryWorker(store,this.channels,credentials);this.commandBus=new CommandBus(this);this.automation=new AutomationScheduler(store,{runPrompt:(binding,prompt,kind,signal)=>this.runAutomationPrompt(binding,prompt,kind,signal),flush:()=>this.flushDeliveries(),available:key=>!this.closed&&!this.quiescing&&!this.busy(key)&&!this.controls.has(key)&&!this.store.messages(key).length});this.commandServices.automation={proactive:(binding,action,args)=>this.automationCommand(binding,action,args),schedule:(binding,action,args)=>this.scheduleCommand(binding,action,args)};
  }
  async initialize():Promise<void>{
    this.store.claimRuntime(this.owner);this.claimed=true;this.store.recover();
    for(const job of this.store.jobs())if(job.state==='running'||job.state==='queued')this.store.saveJob(job.id,{...job,state:'interrupted'});
    for(const action of this.store.sessionActions<SessionActionRecord>())if(action.state==='running')this.finishSessionAction(action,'interrupted','会话操作在重启前被中断，结果未知；请先查看当前状态，再决定是否重试。');
    for(const bot of this.store.bots())if(bot.enabled&&!bot.archived)void this.start(bot.id).catch(()=>this.states.set(bot.id,'error'));
    this.store.retain();
    if(!this.quiescing){this.resumeCommands();this.resumeSessionActions();for(const key of this.store.scopesWithPending())this.schedule(key);void this.flushDeliveries();}
    if(!this.quiescing)this.automation.start();
  }
  async saveConfig(input:unknown,expectedRevision?:number):Promise<BotConfig>{
    const {configSchema}=await import('./types.js');const parsed=configSchema.parse(input);if(!parsed.archived)await this.harness.validateModel(parsed);
    const saved=this.store.saveConfig(parsed,expectedRevision);this.recheckPermissions();return saved;
  }
  async applyPersonaFiles(id:string):Promise<BotConfig>{
    const file=this.store.readPersonaDraft(id);
    if(!file.config.archived)await this.harness.validateModel(file.config);
    const saved=this.store.saveConfig(file.config,file.config.revision,file.digest);
    this.recheckPermissions();return saved;
  }
  saveBot(input:unknown):BotInstance{const candidate=botSchema.parse(input);this.channels.require(candidate.channel);let previous:BotInstance|undefined;try{previous=this.store.bot(candidate.id);}catch{}if(previous&&(previous.accountId!==candidate.accountId||previous.channel!==candidate.channel))throw new Error('已有机器人的渠道身份不可修改；请创建新机器人');if(candidate.workingDirectory)validateWorkingDirectory(candidate.workingDirectory);const next=this.store.saveBot(candidate);this.recheckPermissions();return next;}
  private recheckPermissions():void{
    this.harness.recheckPermissions?.();
    // A changed policy cancels in-flight work; new privileges still wait for the next frozen turn.
    for(const [key,task] of this.processing){const binding=this.store.findBinding(key);if(!binding)continue;const before=this.store.findTurnSnapshot(task.sessionId);if(!before)continue;const bot=this.store.bot(binding.scope.botId);let current:BotConfig|undefined;try{current=this.effectiveConfig(binding);}catch{}if(!current||permissionsRevoked(before,current,bot,binding.scope)){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}}
    for(const [key,task] of this.maintenance){const binding=this.store.findBinding(key);if(!binding)continue;const bot=this.store.bot(binding.scope.botId);if(!bot.enabled||bot.archived){task.controller.abort();this.harness.cancel(task.sessionId);}}
  }
  async start(botId:string):Promise<void>{await this.connectionSupervisor.start(botId);}
  async stop(botId:string):Promise<void>{
    const bot=this.store.bot(botId);this.store.saveBot({...bot,enabled:false});
    this.deliveryWorker.cancelBot(botId);
    for(const d of this.store.deliveries(['pending']))if(d.botId===botId)this.store.deliveryState(d,'cancelled');
    for(const key of new Set(this.store.sessionActions<SessionActionRecord>().filter(r=>r.scope.botId===botId).map(r=>r.scopeKey)))this.cancelSessionActions(key,'机器人已停用，会话操作已取消。');
    this.recheckPermissions();
    await this.connectionSupervisor.disconnect(botId);
    this.deliveryWorker.cancelBot(botId);
    for(const [key,timer] of this.timers){const binding=this.store.findBinding(key);if(binding?.scope.botId===botId){clearTimeout(timer);this.timers.delete(key);}}
    for(const [key,task] of this.processing){const binding=this.store.findBinding(key);if(binding?.scope.botId===botId){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}}
    for(const [key,task] of this.maintenance){const binding=this.store.findBinding(key);if(binding?.scope.botId===botId){task.controller.abort();this.harness.cancel(task.sessionId);}}
    for(const key of this.store.scopesWithPending(['pending','deferred','control'])){const messages=this.store.messages(key,['pending','deferred','control']);if(messages[0]?.scope.botId===botId)this.store.mark(key,messages.map(m=>m.id),'cancelled');}
    await Promise.all([...this.processing.entries(),...this.maintenance.entries()].filter(([key])=>this.store.findBinding(key)?.scope.botId===botId).map(([,p])=>p.done.catch(()=>{})));this.states.set(botId,'stopped');
  }
  async receive(message:InboundMessage):Promise<void>{
    const bot=this.store.bot(message.scope.botId);const definition=this.channels.require(message.scope.platform);if(!message.replyEnvelope&&definition.normalizeReply)message={...message,replyEnvelope:definition.normalizeReply(message.reply)};if(!bot.enabled||bot.archived||bot.channel!==message.scope.platform||bot.accountId!==message.scope.accountId)return;
    if(!message.id||!message.scope.senderId||!message.scope.channelId)throw new Error('INVALID_CHANNEL_IDENTITY');
    const key=scopeKey(message.scope);if(!this.store.accept(message))return;
    const command=this.inboundCommand(message);
    if(command){this.store.mark(key,[message.id],'control');if(!this.quiescing||(command.name==='stop'&&(this.busy(key)||this.store.sessionActions<SessionActionRecord>().some(action=>action.scopeKey===key&&['queued','running'].includes(action.state)))))await this.dispatchCommand(message,command);return;}
    const escaped=unescapeChat(message.text);if(escaped!==message.text){message={...message,text:escaped};this.store.updateMessage(key,message);}
    const stripped=message.text.trim();const onlyUrl=/^https?:\/\/\S+$/.test(stripped);const hold=/(?:先别|不要|暂不|等我).*(?:分析|处理|指令)/.test(stripped);
    if(hold||onlyUrl||(!stripped&&message.attachments.length>0&&message.attachments.every(a=>a.kind==='video'||a.kind==='file'))){this.store.mark(key,[message.id],'deferred');return;}
    this.schedule(key);
  }
  private interrupt(scope:CallerScope,preserveActionId?:string):void {
    const key=scopeKey(scope);const timer=this.timers.get(key);if(timer)clearTimeout(timer);this.timers.delete(key);
    this.cancelSessionActions(key,'会话操作已取消。',preserveActionId);
    const binding=this.store.binding(scope);this.processing.get(key)?.controller.abort();this.maintenance.get(key)?.controller.abort();this.harness.cancel(binding.sessionId);this.media.cancelScope(key);
    this.deliveryWorker.cancelScope(key);
  }
  async stopSession(scope:CallerScope,preserveActionId?:string):Promise<void>{
    const key=scopeKey(scope);this.interrupt(scope,preserveActionId);
    this.store.mark(key,this.store.messages(key,['pending','deferred']).map(m=>m.id),'cancelled');
    for(const delivery of this.store.deliveries(['pending']))if(delivery.scopeKey===key)this.store.deliveryState(delivery,'cancelled');
    await Promise.all([this.processing.get(key)?.done?.catch(()=>{}),this.maintenance.get(key)?.done?.catch(()=>{})]);
  }
  async newSession(scope:CallerScope,preserveActionId?:string,authorize?:()=>void):Promise<SessionBinding>{await this.stopSession(scope,preserveActionId);const previous=this.store.binding(scope);authorize?.();await this.harness.dispose(previous.sessionId);authorize?.();return this.store.reset(scope);}
  async resumeSession(scope:CallerScope,id:string,authorize?:()=>void):Promise<SessionBinding>{
    const binding=this.store.binding(scope);if(this.busy(binding.key))throw new Error('当前会话忙碌，请先 /stop');
    const target=this.store.session(scope,id);if(target.id===binding.sessionId)return binding;
    if(!target.persisted)throw new Error('目标会话尚无可恢复的历史');
    if(!this.harness.inspectSession)throw new Error('当前 Harness 不支持会话可读性检查');
    await this.harness.inspectSession(id);const next={...binding,sessionId:id,personaId:target.personaId,modelOverride:target.modelOverride};await this.harness.validateModel(this.effectiveConfig(next));
    if(this.busy(binding.key)||this.store.binding(scope).sessionId!==binding.sessionId)throw new Error('会话状态已变化，请重试');
    authorize?.();await this.harness.dispose(binding.sessionId);authorize?.();return this.store.activateSession(scope,id);
  }
  async switchPersona(scope:CallerScope,id:string,authorize?:()=>void):Promise<SessionBinding>{
    const binding=this.store.binding(scope);const config=this.store.config(id);await this.harness.validateModel(config);
    const current=this.store.binding(scope);if(current.sessionId!==binding.sessionId||current.generation!==binding.generation)throw new Error('会话状态已变化，请重试');authorize?.();const next={...current,personaId:id,modelOverride:undefined};this.store.updateSession(next);this.recheckPermissions();return next;
  }
  async setModel(scope:CallerScope,model:BotConfig['model'],authorize?:()=>void):Promise<SessionBinding>{
    const binding=this.store.binding(scope);const next={...binding,modelOverride:model?modelSchema.parse(model):undefined};await this.harness.validateModel(this.effectiveConfig(next));
    const current=this.store.binding(scope);if(current.sessionId!==binding.sessionId||current.generation!==binding.generation||current.personaId!==binding.personaId)throw new Error('会话配置已变化，请重试');authorize?.();return this.store.updateSession({...current,modelOverride:next.modelOverride});
  }
  async compactSession(scope:CallerScope):Promise<string>{
    const binding=this.store.binding(scope);if(this.busy(binding.key))throw new Error('当前会话忙碌，请稍后再压缩');if(this.quiescing)throw new Error('正在升级，暂停新任务');if(!binding.persisted)throw new Error('当前会话尚无可压缩的上下文');if(!this.harness.compact)throw new Error('当前 Harness 不支持手动压缩');
    const controller=new AbortController();let answer='';
    const done=Promise.resolve().then(async()=>{answer=await this.harness.compact!(binding,controller.signal);if(controller.signal.aborted)throw new Error('压缩已取消');}).finally(()=>{this.maintenance.delete(binding.key);if(this.store.messages(binding.key).length)this.schedule(binding.key);});
    this.maintenance.set(binding.key,{controller,sessionId:binding.sessionId,done});await done;return answer;
  }
  queueSessionAction(binding:SessionBinding,snapshot:TurnSnapshot,input:DeferredSessionAction,signal:AbortSignal):{status:'queued';actionId:string;action:string}{
    signal.throwIfAborted();const action=deferredSessionActionSchema.parse(input);const current=this.store.findBinding(binding.key);
    if(this.closed||!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation||scopeKey(binding.scope)!==binding.key||scopeKey(current.scope)!==binding.key||snapshot.botId!==current.scope.botId)throw Error('SESSION_ACTION_SESSION_CHANGED');
    const processing=this.processing.get(binding.key);const ids=snapshot.sourceIds;
    if(!processing||processing.sessionId!==binding.sessionId||processing.controller.signal.aborted||!ids.length||new Set(ids).size!==ids.length||!sameSources(ids,processing.sourceIds))throw Error('SESSION_ACTION_SOURCE_INVALID');
    const sources=ids.map(id=>this.store.source(binding.key,id));if(sources.some(m=>!m||scopeKey(m.scope)!==binding.key))throw Error('SESSION_ACTION_SOURCE_INVALID');
    const existing=this.store.sessionActions<SessionActionRecord>().find(r=>r.scopeKey===binding.key&&r.sessionId===binding.sessionId&&r.generation===binding.generation&&sameSources(r.sourceIds,ids));
    const config=this.effectiveConfig(current);const now=Date.now();
    const record:SessionActionRecord={id:randomUUID(),action,scopeKey:binding.key,scope:{...current.scope},sessionId:current.sessionId,generation:current.generation,sourceIds:[...ids],sourceId:sources.at(-1)!.id,trusted:snapshot.trusted,personaId:config.id,personaRevision:config.revision,state:'queued',createdAt:now,updatedAt:now};
    if(action.action==='persona')record.targetPersonaRevision=this.store.config(action.personaId).revision;
    this.authorizeSessionAction(record);
    if((action.action==='persona'||action.action==='skill')&&(snapshot.config.id!==config.id||snapshot.config.revision!==config.revision))throw Error('SESSION_ACTION_PERSONA_CHANGED');
    if(existing){if(existing.state==='queued'&&sameSessionAction(existing.action,action))return{status:'queued',actionId:existing.id,action:action.action};throw Error('SESSION_ACTION_ALREADY_QUEUED');}
    // Only host-observed sources and reply metadata are saved. Tools never choose a caller.
    this.store.saveSessionAction(record.id,record);const controller=new AbortController();
    const cancel=()=>{controller.abort();const saved=this.store.findSessionAction<SessionActionRecord>(record.id);if(saved&&['queued','running'].includes(saved.state))this.finishSessionAction(saved,'cancelled','会话操作已取消。');};
    signal.addEventListener('abort',cancel,{once:true});this.sessionActionSignals.set(record.id,{controller,dispose:()=>signal.removeEventListener('abort',cancel)});
    return{status:'queued',actionId:record.id,action:action.action};
  }
  private authorizeSessionAction(record:SessionActionRecord):SessionBinding {
    if(this.closed)throw Error('SESSION_ACTION_CANCELLED');
    const current=this.store.findBinding(record.scopeKey);
    if(!current||current.sessionId!==record.sessionId||current.generation!==record.generation||scopeKey(current.scope)!==record.scopeKey||scopeKey(record.scope)!==record.scopeKey)throw Error('SESSION_ACTION_SESSION_CHANGED');
    const bot=this.store.bot(current.scope.botId);if(!bot.enabled||bot.archived||bot.accountId!==current.scope.accountId||bot.channel!==current.scope.platform)throw Error('SESSION_ACTION_BOT_DISABLED');
    this.sessionActionSignals.get(record.id)?.controller.signal.throwIfAborted();
    const saved=this.store.findSessionAction<SessionActionRecord>(record.id);if(saved&&!['queued','running'].includes(saved.state))throw Error('SESSION_ACTION_CANCELLED');
    if(!record.sourceIds.length||!record.sourceIds.includes(record.sourceId)||record.sourceIds.some(id=>{const source=this.store.source(record.scopeKey,id);return!source||scopeKey(source.scope)!==record.scopeKey;}))throw Error('SESSION_ACTION_SOURCE_INVALID');
    if(record.action.action==='persona'||record.action.action==='skill'){
      if(!record.trusted||!trusted(bot,current.scope))throw Error('TRUSTED_PRIVATE_REQUIRED');
      const config=this.effectiveConfig(current);if(config.id!==record.personaId||config.revision!==record.personaRevision)throw Error('SESSION_ACTION_PERSONA_CHANGED');
      if(record.action.action==='persona'&&this.store.config(record.action.personaId).revision!==record.targetPersonaRevision)throw Error('SESSION_ACTION_PERSONA_CHANGED');
    }
    return current;
  }
  private finishSessionAction(record:SessionActionRecord,state:SessionActionRecord['state'],result:string):void {
    const next={...record,state,result,updatedAt:Date.now()};const source=this.store.source(record.scopeKey,record.sourceId);const binding=this.store.findBinding(record.scopeKey);
    const outputs:Output[]=[];for(let i=0;i<result.length;i+=1800)outputs.push({type:'text',text:result.slice(i,i+1800)});
    this.store.transaction(()=>{this.store.saveSessionAction(record.id,next);if(source&&binding&&scopeKey(source.scope)===record.scopeKey&&scopeKey(binding.scope)===record.scopeKey)this.store.enqueue(binding,source.id,`session-action:${record.id}`,outputs,source.reply,this.replyEnvelope(source));});
    this.sessionActionSignals.get(record.id)?.dispose();this.sessionActionSignals.delete(record.id);
  }
  sessionActionActive(scopeKey:string):boolean{return this.store.sessionActions<SessionActionRecord>().some(record=>record.scopeKey===scopeKey&&['queued','running'].includes(record.state));}
  cancelSessionActions(key:string,reason:string,preserveActionId?:string):void {
    for(const record of this.store.sessionActions<SessionActionRecord>())if(record.scopeKey===key&&record.id!==preserveActionId&&['queued','running'].includes(record.state)){
      this.sessionActionSignals.get(record.id)?.controller.abort();this.finishSessionAction(record,'cancelled',reason);
    }
  }
  resumeSessionActions(key?:string):void {
    if(this.closed||this.quiescing)return;
    for(const record of this.store.sessionActions<SessionActionRecord>().sort((a,b)=>a.createdAt-b.createdAt)){
      if(record.state!=='queued'||(key&&record.scopeKey!==key)||this.busy(record.scopeKey)||this.scheduledSessionActions.has(record.id))continue;
      const scope=record.scopeKey;const previous=this.controls.get(scope)??Promise.resolve();this.scheduledSessionActions.add(record.id);
      // Never await this chain from processing.done: an earlier /stop may be waiting for it.
      const task=previous.catch(()=>{}).then(async()=>{if(!this.closed&&!this.quiescing)await this.executeSessionAction(record.id);}).finally(()=>{
        this.scheduledSessionActions.delete(record.id);if(this.controls.get(scope)===task){this.controls.delete(scope);this.resumeSessionActions(scope);if(this.store.messages(scope).length)this.schedule(scope);}
      });this.controls.set(scope,task);
    }
  }
  private async executeSessionAction(id:string):Promise<void>{
    let record=this.store.findSessionAction<SessionActionRecord>(id);if(!record||record.state!=='queued')return;
    try{
      const binding=this.authorizeSessionAction(record);record={...record,state:'running',updatedAt:Date.now()};this.store.saveSessionAction(id,record);
      if(!this.sessionActionSignals.has(id))this.sessionActionSignals.set(id,{controller:new AbortController(),dispose:()=>{}});
      const authorize=()=>{this.authorizeSessionAction(record!);};let result:string;
      switch(record.action.action){
        case 'new':result=`已开启新会话：${(await this.newSession(binding.scope,id,authorize)).sessionId}`;break;
        case 'stop':await this.stopSession(binding.scope,id);authorize();result='已停止当前会话任务。';break;
        case 'compact':result=await this.compactSession(binding.scope)||'上下文压缩完成。';authorize();break;
        case 'resume':result=`已恢复会话：${(await this.resumeSession(binding.scope,record.action.sessionId,authorize)).sessionId}`;break;
        case 'persona':await this.switchPersona(binding.scope,record.action.personaId,authorize);result=`已切换人格：${record.action.personaId}，下一轮生效。`;break;
        case 'skill':if(!this.commandServices.skills)throw Error('技能服务未启用');result=await this.commandServices.skills.toggle(binding,skillNameSchema.parse(record.action.name),record.action.enabled,authorize);break;
      }
      if(this.store.findSessionAction<SessionActionRecord>(id)?.state==='running')this.finishSessionAction(record,'succeeded',result);
    }catch(error){if(this.store.findSessionAction<SessionActionRecord>(id)?.state!=='cancelled')this.finishSessionAction(record,'failed',`会话操作失败：${error instanceof Error?error.message:'SESSION_ACTION_FAILED'}`);}
    await this.flushDeliveries();
  }
  private assertTrusted(binding:SessionBinding,host=false):void {const bot=this.store.bot(binding.scope.botId);if(!bot.enabled||bot.archived||!trusted(bot,binding.scope))throw new Error('此命令仅供可信私聊用户使用');if(host&&!this.effectiveConfig(binding).allowHostTools)throw new Error('当前人格未允许本机工具');}
  private replyEnvelope(message:InboundMessage){const normalize=this.channels.require(message.scope.platform).normalizeReply;return normalize?normalize(message.replyEnvelope??message.reply):message.replyEnvelope;}
  private async feedback(message:InboundMessage,text:string):Promise<void>{const binding=this.store.binding(message.scope);const outputs:Output[]=[];for(let i=0;i<text.length;i+=1800)outputs.push({type:'text',text:text.slice(i,i+1800)});this.store.enqueue(binding,message.id,`command:${message.id}`,outputs,message.reply,this.replyEnvelope(message));await this.flushDeliveries();}
  async dispatchCommand(message:InboundMessage,command:ParsedCommand):Promise<void>{
    const key=scopeKey(message.scope);
    // Cancellation bypasses the control queue so it can interrupt a compact or long validation.
    if(['stop','new','reset'].includes(command.name))this.interrupt(message.scope);
    const previous=this.controls.get(key)??Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      if(this.closed)return;try{
        const result=await this.executeCommand(message,command);if(result!==undefined)await this.feedback(message,result);
        if(!['compact','evolve'].includes(command.name)||!this.store.messages(key,['pending','processing']).some(m=>m.id===message.id))this.store.mark(key,[message.id],'complete');
      }catch(error){this.store.mark(key,[message.id],'failed');await this.feedback(message,error instanceof Error?error.message:'命令执行失败');}
    }).finally(()=>{if(this.controls.get(key)===task){this.controls.delete(key);if(this.store.messages(key).length)this.schedule(key);}});
    this.controls.set(key,task);return task;
  }
  private async executeCommand(message:InboundMessage,parsed:ParsedCommand):Promise<string|undefined>{
    const binding=this.store.binding(message.scope);const command=managementCommand(parsed);const config=this.effectiveConfig(binding);
    if(!command){const privileged=trusted(this.store.bot(binding.scope.botId),binding.scope);return `未知命令 /${parsed.name}。\n${commandHelp(privileged,config.allowHostTools)}`;}
    const result=await this.commandBus.execute({source:message.text.trimStart().startsWith('/')?'slash':'natural',binding,signal:(this.turnTimeoutMs>0?AbortSignal.timeout(this.turnTimeoutMs):new AbortController().signal)},command);
    if(result.kind==='reply')return result.text;
    if(result.kind==='deferred'){
      // Do not await the model here: iLink's receive loop must remain available for /stop.
      void result.task.then(async text=>{if(this.store.binding(message.scope).sessionId===result.sessionId)await this.feedback(message,text);}).catch(async error=>{if(this.store.binding(message.scope).sessionId===result.sessionId)await this.feedback(message,error instanceof Error?error.message:'上下文压缩失败');});return undefined;
    }
    if(result.kind==='rewrite'){
      this.assertTrusted(this.store.binding(message.scope),true);this.store.updateMessage(binding.key,{...message,text:result.text});this.store.mark(binding.key,[message.id],'pending');this.schedule(binding.key);
    }
    return undefined;
  }
  private inboundCommand(message:InboundMessage):ParsedCommand|undefined{return parseCommand(message.text)??(message.text.trimStart().startsWith('//')?undefined:parseNaturalControl(message.text));}
  resumeCommands():void{for(const key of this.store.scopesWithPending(['control']))for(const message of this.store.messages(key,['control'])){const command=this.inboundCommand(message);if(command)void this.dispatchCommand(message,command);}}
  async drainControls():Promise<void>{await Promise.all([...this.controls.values()].map(task=>task.catch(()=>{})));}
  pauseProcessing():void{this.quiescing=true;this.automation.close();for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}
  async quiesce():Promise<void>{this.pauseProcessing();for(;;){await this.drainControls();await Promise.all([...this.processing.values(),...this.maintenance.values()].map(task=>task.done.catch(()=>{})));await this.automation.drain();await this.harness.drain?.();await this.flushDeliveries();await this.deliveryWorker.drain();if(!this.controls.size&&!this.processing.size&&!this.maintenance.size&&!this.deliveryWorker.activity().activeLanes)return;}}
  resumeProcessing():void{this.quiescing=false;this.automation.start();this.resumeCommands();this.resumeSessionActions();for(const key of this.store.scopesWithPending())this.schedule(key);void this.flushDeliveries();}
  private schedule(key:string):void{if(this.closed||this.quiescing)return;const previous=this.timers.get(key);if(previous)clearTimeout(previous);this.timers.set(key,setTimeout(()=>{this.timers.delete(key);void this.process(key);},this.debounceMs));}
  async process(key:string):Promise<void>{
    if(this.closed||this.quiescing||this.busy(key)||this.controls.has(key))return;
    const pending=this.store.messages(key);if(!pending.length)return;
    const bot=this.store.bot(pending[0].scope.botId);if(!bot.enabled||bot.archived)return;
    const deferred=this.store.messages(key,['deferred']).filter(m=>m.timestamp>Date.now()-600000).slice(-INPUT_LIMITS.batchMessages);
    const messages=[...deferred,...pending].slice(-INPUT_LIMITS.batchMessages);
    const binding=this.store.binding(pending[0].scope);
    try{validateBatch(messages,id=>this.store.asset(key,id).size);}catch(error){
      const sourceIds=messages.map(m=>m.id);const at=Date.now();this.store.mark(key,sourceIds,'failed');
      this.store.saveFailure(`${key}:${at}`,{sessionId:binding.sessionId,scope:key,code:error instanceof Error?error.message:'BATCH_INPUT_TOO_LARGE',state:'failed',stage:'attachments',sourceIds,at} satisfies ProcessingFailure);
      this.store.enqueue(binding,pending.at(-1)!.id,`failure:${pending.at(-1)!.id}`,[{type:'text',text:'这批消息超过单轮处理上限，未送入模型。请减少消息或附件后重试。'}],pending.at(-1)!.reply,this.replyEnvelope(pending.at(-1)!));
      await this.flushDeliveries();return;
    }
    const controller=new AbortController();
    const deadline=(this.turnTimeoutMs>0?AbortSignal.timeout(this.turnTimeoutMs):new AbortController().signal);const signal=AbortSignal.any([controller.signal,deadline]);
    this.store.mark(key,messages.map(m=>m.id),'processing');this.store.markTurnStage(key,messages.map(m=>m.id),'attachmentsStartedAt');
    const done=Promise.resolve().then(async()=>{
      let autoAsrFailure=false;
      let progress:TaskProgress|undefined;
      try{
      let stage:ProcessingFailure['stage']='attachments';
      try{
        const snapshot=freezeTurn(this.effectiveConfig(binding),bot,binding.scope,messages.map(m=>m.id));
        this.store.saveTurnSnapshot(binding.sessionId,snapshot);
        const config=snapshot.config as BotConfig;
        const active=()=>{
          const current=this.store.findBinding(key);
          return !this.closed&&!signal.aborted&&this.processing.get(key)?.controller===controller&&current?.sessionId===binding.sessionId&&current.generation===binding.generation&&!permissionsRevoked(snapshot,this.effectiveConfig(current),this.store.bot(bot.id),binding.scope);
        };
        signal.throwIfAborted();
        if(binding.scope.kind==='private'){
          progress=new TaskProgress({signal,active,
            format:(facts,progressSignal)=>this.harness.formatProgress?.(binding,snapshot,facts,progressSignal)??Promise.resolve(progressFallback(facts.stage)),
            deliver:async(text,runId,sequence,expiresAt)=>{
              if(!active())return;
              for(const delivery of this.store.deliveries(['pending']))if(delivery.purpose==='progress'&&delivery.progress?.runId===runId)this.store.deliveryState(delivery,'cancelled');
              const source=pending.at(-1)!;
              this.store.enqueue(binding,source.id,`progress:${runId}:${sequence}`,[{type:'text',text}],source.reply,this.replyEnvelope(source),{runId,generation:binding.generation,expiresAt});
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
          const result=await this.media.run(key,'transcribe',config,[assetId],{question:'请忠实转写这段语音。'},signal,()=>{if(!active())throw new Error('MEDIA_TOOL_DISABLED');},snapshot);
          let value:any;try{value=result.text?JSON.parse(result.text):undefined;}catch{value=undefined;}
          const transcript=typeof value?.transcript==='string'?value.transcript.trim():'';
          if(!transcript)throw new Error('EMPTY_TRANSCRIPT');
          transcripts.set(assetId,transcript);input.transcript=transcript;autoAsrFailure=false;progress?.update('attachments');
        };
        for(const message of messages){
          if(message.quoted?.id){const quoted=this.store.source(key,message.quoted.id);if(quoted)message.quoted={id:quoted.id,text:quoted.text,attachments:quoted.attachments};}
          for(const input of [...message.attachments,...(message.quoted?.attachments??[])]){
            if(input.handle){this.store.asset(key,input.handle);await ensureTranscript(input,input.handle);continue;}
            const bytes=input.bytes?Buffer.from(input.bytes,'base64'):await this.channels.require(bot.channel).adapter.materialize(input,signal);
            const asset=await this.assets.save(key,input,bytes);input.handle=asset.id;delete input.bytes;await ensureTranscript(input,asset.id);
          }
          this.store.updateMessage(key,message);
        }
        this.store.markTurnStage(key,messages.map(m=>m.id),'attachmentsCompletedAt');
        stage='model';progress?.update('model');const modelAt=Date.now();this.store.updateTurnMetrics(key,messages.map(m=>m.id),{sessionId:binding.sessionId,modelStartedAt:modelAt});const result=await this.harness.run(binding,messages,signal,{snapshot,onProgress:stage=>progress?.update(stage),onEnd:()=>progress?.stop()});
        progress?.stop();
        if(signal.aborted||this.store.binding(binding.scope).sessionId!==binding.sessionId){this.store.mark(key,messages.map(m=>m.id),'cancelled');return;}
        this.store.markTurnStage(key,messages.map(m=>m.id),'modelCompletedAt');
        stage='delivery';const outputs:Output[]=[];for(const output of result.outputs){if(output.type==='text'&&output.text){for(let index=0;index<output.text.length;index+=1800)outputs.push({type:'text',text:output.text.slice(index,index+1800)});}else if(output.type==='asset'){this.store.asset(key,output.assetId!);outputs.push(output);}}
        if(!outputs.length)throw new Error('NO_DELIVERABLE_OUTPUT');
        this.store.updateTurnMetrics(key,messages.map(m=>m.id),{turnId:result.turnId,deliveryStartedAt:Date.now()});this.store.transaction(()=>{this.store.enqueue(binding,pending.at(-1)!.id,result.turnId,outputs,pending.at(-1)!.reply,this.replyEnvelope(pending.at(-1)!));this.store.mark(key,messages.map(m=>m.id),'complete');});
      }catch(error){
        progress?.stop();
        const timedOut=deadline.aborted&&!controller.signal.aborted;const state=timedOut?'failed':controller.signal.aborted||signal.aborted?'cancelled':'failed';const at=Date.now();
        this.store.mark(key,messages.map(m=>m.id),state);this.store.saveFailure(`${binding.sessionId}:${at}`,{sessionId:binding.sessionId,scope:key,code:timedOut?'TURN_DEADLINE_EXCEEDED':error instanceof Error?error.message:'PROCESS_FAILED',state,stage,sourceIds:messages.map(m=>m.id),at} satisfies ProcessingFailure);
        const noDeliverableOutput=error instanceof Error&&error.message==='NO_DELIVERABLE_OUTPUT';
        if(state==='failed'&&(stage!=='delivery'||noDeliverableOutput)&&this.store.binding(binding.scope).sessionId===binding.sessionId){
          const image=messages.some(m=>[...m.attachments,...(m.quoted?.attachments??[])].some(a=>a.kind==='image'));
          const text=noDeliverableOutput?'本轮已完成，但没有可投递的文本或附件，未发送结果。请重试；详细错误已记录在管理面板。':timedOut?'这次请求超过处理时限，未确认结果。请稍后重试；详细错误已记录在管理面板。':autoAsrFailure?'语音识别失败，未把这条语音交给模型。请检查语音服务配置后重试；详细错误已记录在管理面板。':stage==='attachments'?(image?'图片下载或读取失败，这条请求尚未送入模型，也没有生成新图。请稍后重发图片和要求。':'附件下载或读取失败，这条请求尚未送入模型。请稍后重发附件和要求。'):`模型请求失败（${modelFailureCode(error)}），未确认本次结果。请检查当前模型或发送“重置模型”后重试；详细错误已记录在管理面板。`;
          this.store.enqueue(binding,pending.at(-1)!.id,`failure:${pending.at(-1)!.id}`,[{type:'text',text}],pending.at(-1)!.reply,this.replyEnvelope(pending.at(-1)!));
        }
      }
      // Queue workers own delivery failures; they must not relabel completed model requests.
      await this.flushDeliveries();
      }finally{progress?.stop();this.processing.delete(key);this.resumeSessionActions(key);if(this.store.messages(key).length)this.schedule(key);}
    });
    this.processing.set(key,{controller,sessionId:binding.sessionId,sourceIds:messages.map(m=>m.id),done});await done;
  }
  async flushDeliveries():Promise<void>{await this.deliveryWorker.flush();}
  private async runAutomationPrompt(binding:SessionBinding,prompt:string,kind:AutomationKind,signal:AbortSignal):Promise<{turnId:string;outputs:Output[]}>{
    const key=binding.key;
    if(this.closed||this.quiescing||this.busy(key)||this.controls.has(key))throw Error('AUTOMATION_BUSY');
    this.assertTrusted(binding);
    const sourceId=`automation:${randomUUID()}`,latest=this.store.allMessages().filter(message=>scopeKey(message.scope)===key).at(-1);
    if(!latest)throw Error('AUTOMATION_CONTEXT_MISSING');
    const controller=new AbortController();
    const deadline=this.turnTimeoutMs>0?AbortSignal.timeout(this.turnTimeoutMs):new AbortController().signal;
    const runSignal=AbortSignal.any([signal,controller.signal,deadline]);
    let config=this.effectiveConfig(binding);
    if(kind==='proactive'&&!this.automation.listProactive().find(item=>item.scopeKey===key)?.allowWeb)config={...config,tools:config.tools.filter(name=>!['web_search','web_fetch','bot_read_social'].includes(name))};
    const snapshot=freezeTurn(config,this.store.bot(binding.scope.botId),binding.scope,[sourceId]);
    this.store.saveTurnSnapshot(binding.sessionId,snapshot);
    const synthetic:InboundMessage={id:sourceId,scope:binding.scope,text:prompt,attachments:[],reply:latest.reply,replyEnvelope:latest.replyEnvelope,timestamp:Date.now()};
    let answer:{turnId:string;outputs:Output[]}|undefined;
    const done=Promise.resolve().then(async()=>{
      runSignal.throwIfAborted();
      const result=await this.harness.run(binding,[synthetic],runSignal,{snapshot});
      runSignal.throwIfAborted();const current=this.store.findBinding(key);
      if(!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation||permissionsRevoked(snapshot,this.effectiveConfig(current),this.store.bot(binding.scope.botId),binding.scope))throw Error('AUTOMATION_CONTEXT_CHANGED');
      answer={turnId:result.turnId,outputs:result.outputs};
    }).finally(()=>{this.processing.delete(key);this.resumeSessionActions(key);if(this.store.messages(key).length)this.schedule(key);});
    this.processing.set(key,{controller,sessionId:binding.sessionId,sourceIds:[],done});
    await done;return answer!;
  }
  private async automationCommand(binding:SessionBinding,action:'on'|'off'|'status'|'now'|'set',args:string):Promise<string>{
    const current=this.automation.listProactive().find(item=>item.scopeKey===binding.key);if(action==='status')return current?`主动会话：${current.enabled?'开启':'关闭'}\n每日上限：${current.dailyLimit}\n静默：${current.quietFrom}-${current.quietTo}\n时区：${current.timezone}`:'主动会话未配置。使用 /proactive on 开启。';
    if(action==='on'||action==='off'){const next=this.automation.setProactive(binding.scope,action==='on');return`主动会话已${next.enabled?'开启':'关闭'}。`;}if(action==='now'){this.automation.queueProactive(binding.scope);return'主动会话已排队，将在当前会话空闲后执行。';}
    if(action==='set'){const patch:Record<string,unknown>={};for(const part of args.split(/\s+/).filter(Boolean)){const [key,value]=part.split('=',2);if(key&&value!==undefined)patch[key]=value==='true'||value==='false'?value==='true':/^\d+$/.test(value)?Number(value):value;}this.automation.configureProactive(binding.scope,patch);return'主动会话配置已更新。';}return'用法：/proactive on|off|status|now|set key=value';
  }
  private async scheduleCommand(binding:SessionBinding,action:'list'|'create'|'pause'|'resume'|'run'|'delete',args:string):Promise<string>{
    if(action==='list'){const rows=this.automation.listJobs().filter(item=>item.scopeKey===binding.key);return rows.length?rows.map(item=>`${item.id} ${item.enabled?'开启':'暂停'} ${item.prompt.slice(0,80)}`).join('\n'):'当前没有定时任务。';}
    if(action==='create'){
      let input:unknown;try{input=JSON.parse(args);}catch{const match=/^(\d+)(?:\s+([\s\S]+))?$/.exec(args);if(match)input={delayMs:Number(match[1]),prompt:match[2]??'执行定时任务并报告结果'};}
      const value=botScheduleArgumentsSchema.parse({...input as object,action:'create'});
      const job=this.automation.createJob(binding.scope,value.prompt!,{runAt:value.runAt?Date.parse(value.runAt):value.delayMs?Date.now()+value.delayMs:undefined,intervalMs:value.intervalMs,dailyAt:value.dailyAt,timezone:value.timezone});
      return`定时任务已创建：${job.id}\n下次执行：${new Date(job.nextAt!).toISOString()}（${job.timezone}）`;
    }
    const id=args.trim();if(!id)throw Error('需要任务 ID');const job=this.automation.listJobs().find(item=>item.id===id&&item.scopeKey===binding.key);if(!job)throw Error('定时任务不存在');if(action==='pause'||action==='resume'){this.automation.setJob(id,action==='resume');return`定时任务已${action==='resume'?'恢复':'暂停'}。`;}if(action==='delete'){this.automation.deleteJob(id);return'定时任务已删除。';}if(action==='run'){this.automation.queueJob(job);return'定时任务已排队，将在当前会话空闲后执行。';}return'用法：/schedule list|create|pause|resume|run|delete';
  }
  async close():Promise<void>{this.closed=true;this.automation.close();for(const timer of this.timers.values())clearTimeout(timer);for(const [key,task] of [...this.processing.entries(),...this.maintenance.entries()]){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}await this.deliveryWorker.close();await this.connectionSupervisor.disconnectAll();await Promise.all([...this.processing.values(),...this.maintenance.values()].map(p=>p.done.catch(()=>{})));await this.automation.drain();await this.drainControls();await this.deliveryWorker.drain();for(const signal of this.sessionActionSignals.values())signal.dispose();this.sessionActionSignals.clear();await this.harness.dispose();if(this.claimed){this.store.releaseRuntime(this.owner);this.claimed=false;}}
}

