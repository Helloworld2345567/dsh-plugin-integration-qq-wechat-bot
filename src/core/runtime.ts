import { Store, scopeKey } from './store.js';
import { Assets, MediaService } from './media.js';
import type { BotConfig, BotInstance, ChannelAdapter, Credential, InboundMessage, SessionBinding, Output, TurnSnapshot, CallerScope } from './types.js';
import {randomUUID} from 'node:crypto';
import {permissionsRevoked,trusted} from './policy.js';
import {botSchema,modelSchema,skillNameSchema} from './types.js';
import {validateWorkingDirectory} from './workspaces.js';
import {parseCommand,unescapeChat,commandHelp,type ParsedCommand} from './commands.js';
import {parseNaturalControl} from './natural-commands.js';
import {deferredSessionActionSchema,sameSessionAction,sameSources,type DeferredSessionAction,type SessionActionRecord} from './session-actions.js';
import type {ProcessingFailure} from './failure-context.js';

export interface HarnessResult { turnId:string; outputs:Output[]; snapshot:TurnSnapshot }
export interface HarnessPort {
  run(binding:SessionBinding,messages:InboundMessage[],signal:AbortSignal):Promise<HarnessResult>;
  cancel(sessionId:string):void;
  dispose(sessionId?:string):Promise<void>;
  validateModel(config:BotConfig):Promise<void>;
  recheckPermissions?():void;
  compact?(binding:SessionBinding,signal:AbortSignal):Promise<string>;
  models?():Promise<Array<{provider:string;model:string;inputModalities?:string[]}>>;
  inspectSession?(sessionId:string):Promise<void>;
  drain?():Promise<void>;
}
export interface CommandServices {
  skills?:{list(binding:SessionBinding):Promise<string>;toggle(binding:SessionBinding,name:string,enabled:boolean,authorize?:()=>void):Promise<string>;reload(binding:SessionBinding):Promise<string>};
  evolution?:{request(binding:SessionBinding,goal:string):Promise<string>;status(binding:SessionBinding,id?:string):Promise<string>;history(binding:SessionBinding):Promise<string>;rollback(binding:SessionBinding,id:string):Promise<string>;restart(binding:SessionBinding):Promise<string>};
  stats?:(binding:SessionBinding,args:string)=>Promise<string>;
}
export interface Credentials { read(botId:string):Promise<Credential|undefined>; write(botId:string,value:Credential):Promise<void>; remove(botId:string):Promise<void> }
export class BotRuntime {
  readonly states=new Map<string,string>();
  private readonly connections=new Map<string,{controller:AbortController;done:Promise<void>}>();
  private readonly timers=new Map<string,ReturnType<typeof setTimeout>>();
  private readonly processing=new Map<string,{controller:AbortController;sessionId:string;sourceIds:string[];done:Promise<void>}>();
  private readonly senders=new Map<string,Promise<void>>();
  private readonly outbound=new Map<string,{botId:string;controller:AbortController}>();
  private readonly controls=new Map<string,Promise<void>>();
  private readonly maintenance=new Map<string,{controller:AbortController;sessionId:string;done:Promise<void>}>();
  private readonly sessionActionSignals=new Map<string,{controller:AbortController;dispose:()=>void}>();
  private readonly scheduledSessionActions=new Set<string>();
  commandServices:CommandServices={};
  private quiescing=false;
  private closed=false;
  private readonly owner=randomUUID();
  private claimed=false;
  activeSessions(botId:string):number {return [...new Set([...this.processing.keys(),...this.maintenance.keys()])].filter(key=>this.store.get<SessionBinding>('binding',key)?.scope.botId===botId).length;}
  effectiveConfig(binding:SessionBinding):BotConfig{return this.store.effectiveConfig(binding);}
  sessionStatus(scope:CallerScope):'waiting_upgrade'|'compacting'|'running'|'idle'{const key=scopeKey(scope);return this.quiescing?'waiting_upgrade':this.maintenance.has(key)?'compacting':this.processing.has(key)||this.store.list<SessionActionRecord>('session-action').some(r=>r.scopeKey===key&&r.state==='running')?'running':'idle';}
  health():{ready:true;quiescing:boolean;activeTasks:number;pendingDeliveries:number;pendingSessionActions:number;connections:Record<string,string>}{return{ready:true,quiescing:this.quiescing,activeTasks:this.processing.size+this.maintenance.size+this.controls.size,pendingDeliveries:this.store.deliveries(['pending','sending']).length,pendingSessionActions:this.store.list<SessionActionRecord>('session-action').filter(r=>r.state==='queued').length,connections:Object.fromEntries(this.states)};}
  constructor(readonly store:Store,readonly assets:Assets,readonly media:MediaService,readonly harness:HarnessPort,readonly adapters:Record<'qq'|'weixin',ChannelAdapter>,readonly credentials:Credentials,readonly debounceMs=2000){}
  async initialize():Promise<void>{
    this.store.claimRuntime(this.owner);this.claimed=true;this.store.recover();
    for(const job of this.store.list<any>('job'))if(job.state==='running')this.store.put('job',job.id,{...job,state:'interrupted'});
    for(const action of this.store.list<SessionActionRecord>('session-action'))if(action.state==='running')this.finishSessionAction(action,'interrupted','会话操作在重启前被中断，结果未知；请先查看当前状态，再决定是否重试。');
    for(const bot of this.store.bots())if(bot.enabled&&!bot.archived)void this.start(bot.id).catch(()=>this.states.set(bot.id,'error'));
    if(!this.quiescing){this.resumeCommands();this.resumeSessionActions();for(const key of this.store.scopesWithPending())this.schedule(key);void this.flushDeliveries();}
  }
  async saveConfig(input:unknown,expectedRevision?:number):Promise<BotConfig>{
    const {configSchema}=await import('./types.js');const parsed=configSchema.parse(input);if(!parsed.archived)await this.harness.validateModel(parsed);
    const saved=this.store.saveConfig(parsed,expectedRevision);this.recheckPermissions();return saved;
  }
  async applyPersonaFiles(id:string):Promise<BotConfig>{
    const file=this.store.personas.read(id);
    if(!file.config.archived)await this.harness.validateModel(file.config);
    const saved=this.store.saveConfig(file.config,file.config.revision,file.digest);
    this.recheckPermissions();return saved;
  }
  saveBot(input:unknown):BotInstance{const candidate=botSchema.parse(input);const previous=this.store.get<BotInstance>('bot',candidate.id);if(previous&&(previous.accountId!==candidate.accountId||previous.channel!==candidate.channel))throw new Error('已有机器人的渠道身份不可修改；请创建新机器人');if(candidate.workingDirectory)validateWorkingDirectory(candidate.workingDirectory);const next=this.store.saveBot(candidate);this.recheckPermissions();return next;}
  private recheckPermissions():void{
    this.harness.recheckPermissions?.();
    // A changed policy cancels in-flight work; new privileges still wait for the next frozen turn.
    for(const [key,task] of this.processing){const binding=this.store.get<SessionBinding>('binding',key);if(!binding)continue;const before=this.store.get<TurnSnapshot>('turn-snapshot',task.sessionId);if(!before)continue;const bot=this.store.bot(binding.scope.botId);let current:BotConfig|undefined;try{current=this.effectiveConfig(binding);}catch{}if(!current||permissionsRevoked(before,current,bot,binding.scope)){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}}
    for(const [key,task] of this.maintenance){const binding=this.store.get<SessionBinding>('binding',key);if(!binding)continue;const bot=this.store.bot(binding.scope.botId);if(!bot.enabled||bot.archived){task.controller.abort();this.harness.cancel(task.sessionId);}}
  }
  async start(botId:string):Promise<void>{
    const bot=this.store.bot(botId);if(bot.archived)throw new Error('机器人已归档');if(this.connections.has(botId))return;
    const credential=await this.credentials.read(botId);if(!credential||credential.accountId!==bot.accountId)throw new Error('请先完成账号授权');
    if(this.connections.has(botId))return;
    if(this.store.bots().some(b=>b.id!==bot.id&&b.enabled&&!b.archived&&b.channel===bot.channel&&b.accountId===bot.accountId))throw new Error('该平台账号已有活动连接');
    this.store.saveBot({...bot,enabled:true});const controller=new AbortController();
    this.states.set(botId,'connecting');
    const done=this.adapters[bot.channel].connect({...bot,enabled:true},credential,m=>this.receive(m),controller.signal,state=>this.states.set(botId,state)).catch(()=>{if(!controller.signal.aborted)this.states.set(botId,'error');}).finally(()=>{if(this.connections.get(botId)?.controller===controller){this.connections.delete(botId);if(!controller.signal.aborted&&this.states.get(botId)!=='error')this.states.set(botId,'disconnected');}});
    this.connections.set(botId,{controller,done});
  }
  async stop(botId:string):Promise<void>{
    const bot=this.store.bot(botId);this.store.saveBot({...bot,enabled:false});
    for(const key of new Set(this.store.list<SessionActionRecord>('session-action').filter(r=>r.scope.botId===botId).map(r=>r.scopeKey)))this.cancelSessionActions(key,'机器人已停用，会话操作已取消。');
    this.recheckPermissions();
    const connection=this.connections.get(botId);connection?.controller.abort();if(connection)await connection.done;
    for(const item of this.outbound.values())if(item.botId===botId)item.controller.abort();
    for(const [key,timer] of this.timers){const binding=this.store.get<SessionBinding>('binding',key);if(binding?.scope.botId===botId){clearTimeout(timer);this.timers.delete(key);}}
    for(const [key,task] of this.processing){const binding=this.store.get<SessionBinding>('binding',key);if(binding?.scope.botId===botId){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}}
    for(const [key,task] of this.maintenance){const binding=this.store.get<SessionBinding>('binding',key);if(binding?.scope.botId===botId){task.controller.abort();this.harness.cancel(task.sessionId);}}
    for(const key of this.store.scopesWithPending(['pending','deferred','control'])){const messages=this.store.messages(key,['pending','deferred','control']);if(messages[0]?.scope.botId===botId)this.store.mark(key,messages.map(m=>m.id),'cancelled');}
    for(const d of this.store.deliveries(['pending']))if(d.botId===botId)this.store.deliveryState(d,'cancelled');
    await Promise.all([...this.processing.entries(),...this.maintenance.entries()].filter(([key])=>this.store.get<SessionBinding>('binding',key)?.scope.botId===botId).map(([,p])=>p.done.catch(()=>{})));this.states.set(botId,'stopped');
  }
  async receive(message:InboundMessage):Promise<void>{
    const bot=this.store.bot(message.scope.botId);if(!bot.enabled||bot.archived||bot.channel!==message.scope.platform||bot.accountId!==message.scope.accountId)return;
    if(!message.id||!message.scope.senderId||!message.scope.channelId)throw new Error('INVALID_CHANNEL_IDENTITY');
    const key=scopeKey(message.scope);if(!this.store.accept(message))return;
    const command=this.inboundCommand(message);
    if(command){this.store.mark(key,[message.id],'control');if(!this.quiescing||(command.name==='stop'&&(this.busy(key)||this.store.list<SessionActionRecord>('session-action').some(action=>action.scopeKey===key&&['queued','running'].includes(action.state)))))await this.dispatchCommand(message,command);return;}
    const escaped=unescapeChat(message.text);if(escaped!==message.text){message={...message,text:escaped};this.store.updateMessage(key,message);}
    const stripped=message.text.trim();const onlyUrl=/^https?:\/\/\S+$/.test(stripped);const hold=/(?:先别|不要|暂不|等我).*(?:分析|处理|指令)/.test(stripped);
    if(hold||onlyUrl||(!stripped&&message.attachments.length>0&&message.attachments.every(a=>a.kind==='video'||a.kind==='file'))){this.store.mark(key,[message.id],'deferred');return;}
    this.schedule(key);
  }
  private busy(key:string):boolean{return this.processing.has(key)||this.maintenance.has(key);}
  private interrupt(scope:CallerScope,preserveActionId?:string):void {
    const key=scopeKey(scope);const timer=this.timers.get(key);if(timer)clearTimeout(timer);this.timers.delete(key);
    this.cancelSessionActions(key,'会话操作已取消。',preserveActionId);
    const binding=this.store.binding(scope);this.processing.get(key)?.controller.abort();this.maintenance.get(key)?.controller.abort();this.harness.cancel(binding.sessionId);this.media.cancelScope(key);
    for(const d of this.store.deliveries(['sending']))if(d.scopeKey===key)this.outbound.get(d.id)?.controller.abort();
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
    signal.throwIfAborted();const action=deferredSessionActionSchema.parse(input);const current=this.store.get<SessionBinding>('binding',binding.key);
    if(this.closed||!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation||scopeKey(binding.scope)!==binding.key||scopeKey(current.scope)!==binding.key||snapshot.botId!==current.scope.botId)throw Error('SESSION_ACTION_SESSION_CHANGED');
    const processing=this.processing.get(binding.key);const ids=snapshot.sourceIds;
    if(!processing||processing.sessionId!==binding.sessionId||processing.controller.signal.aborted||!ids.length||new Set(ids).size!==ids.length||!sameSources(ids,processing.sourceIds))throw Error('SESSION_ACTION_SOURCE_INVALID');
    const sources=ids.map(id=>this.store.source(binding.key,id));if(sources.some(m=>!m||scopeKey(m.scope)!==binding.key))throw Error('SESSION_ACTION_SOURCE_INVALID');
    const existing=this.store.list<SessionActionRecord>('session-action').find(r=>r.scopeKey===binding.key&&r.sessionId===binding.sessionId&&r.generation===binding.generation&&sameSources(r.sourceIds,ids));
    const config=this.effectiveConfig(current);const now=Date.now();
    const record:SessionActionRecord={id:randomUUID(),action,scopeKey:binding.key,scope:{...current.scope},sessionId:current.sessionId,generation:current.generation,sourceIds:[...ids],sourceId:sources.at(-1)!.id,trusted:snapshot.trusted,personaId:config.id,personaRevision:config.revision,state:'queued',createdAt:now,updatedAt:now};
    if(action.action==='persona')record.targetPersonaRevision=this.store.config(action.personaId).revision;
    this.authorizeSessionAction(record);
    if((action.action==='persona'||action.action==='skill')&&(snapshot.config.id!==config.id||snapshot.config.revision!==config.revision))throw Error('SESSION_ACTION_PERSONA_CHANGED');
    if(existing){if(existing.state==='queued'&&sameSessionAction(existing.action,action))return{status:'queued',actionId:existing.id,action:action.action};throw Error('SESSION_ACTION_ALREADY_QUEUED');}
    // Only host-observed sources and reply metadata are saved. Tools never choose a caller.
    this.store.put('session-action',record.id,record);const controller=new AbortController();
    const cancel=()=>{controller.abort();const saved=this.store.get<SessionActionRecord>('session-action',record.id);if(saved&&['queued','running'].includes(saved.state))this.finishSessionAction(saved,'cancelled','会话操作已取消。');};
    signal.addEventListener('abort',cancel,{once:true});this.sessionActionSignals.set(record.id,{controller,dispose:()=>signal.removeEventListener('abort',cancel)});
    return{status:'queued',actionId:record.id,action:action.action};
  }
  private authorizeSessionAction(record:SessionActionRecord):SessionBinding {
    if(this.closed)throw Error('SESSION_ACTION_CANCELLED');
    const current=this.store.get<SessionBinding>('binding',record.scopeKey);
    if(!current||current.sessionId!==record.sessionId||current.generation!==record.generation||scopeKey(current.scope)!==record.scopeKey||scopeKey(record.scope)!==record.scopeKey)throw Error('SESSION_ACTION_SESSION_CHANGED');
    const bot=this.store.bot(current.scope.botId);if(!bot.enabled||bot.archived||bot.accountId!==current.scope.accountId||bot.channel!==current.scope.platform)throw Error('SESSION_ACTION_BOT_DISABLED');
    this.sessionActionSignals.get(record.id)?.controller.signal.throwIfAborted();
    const saved=this.store.get<SessionActionRecord>('session-action',record.id);if(saved&&!['queued','running'].includes(saved.state))throw Error('SESSION_ACTION_CANCELLED');
    if(!record.sourceIds.length||!record.sourceIds.includes(record.sourceId)||record.sourceIds.some(id=>{const source=this.store.source(record.scopeKey,id);return!source||scopeKey(source.scope)!==record.scopeKey;}))throw Error('SESSION_ACTION_SOURCE_INVALID');
    if(record.action.action==='persona'||record.action.action==='skill'){
      if(!record.trusted||!trusted(bot,current.scope))throw Error('TRUSTED_PRIVATE_REQUIRED');
      const config=this.effectiveConfig(current);if(config.id!==record.personaId||config.revision!==record.personaRevision)throw Error('SESSION_ACTION_PERSONA_CHANGED');
      if(record.action.action==='persona'&&this.store.config(record.action.personaId).revision!==record.targetPersonaRevision)throw Error('SESSION_ACTION_PERSONA_CHANGED');
    }
    return current;
  }
  private finishSessionAction(record:SessionActionRecord,state:SessionActionRecord['state'],result:string):void {
    const next={...record,state,result,updatedAt:Date.now()};const source=this.store.source(record.scopeKey,record.sourceId);const binding=this.store.get<SessionBinding>('binding',record.scopeKey);
    const outputs:Output[]=[];for(let i=0;i<result.length;i+=1800)outputs.push({type:'text',text:result.slice(i,i+1800)});
    this.store.transaction(()=>{this.store.put('session-action',record.id,next);if(source&&binding&&scopeKey(source.scope)===record.scopeKey&&scopeKey(binding.scope)===record.scopeKey)this.store.enqueue(binding,source.id,`session-action:${record.id}`,outputs,source.reply);});
    this.sessionActionSignals.get(record.id)?.dispose();this.sessionActionSignals.delete(record.id);
  }
  private cancelSessionActions(key:string,reason:string,preserveActionId?:string):void {
    for(const record of this.store.list<SessionActionRecord>('session-action'))if(record.scopeKey===key&&record.id!==preserveActionId&&['queued','running'].includes(record.state)){
      this.sessionActionSignals.get(record.id)?.controller.abort();this.finishSessionAction(record,'cancelled',reason);
    }
  }
  private resumeSessionActions(key?:string):void {
    if(this.closed||this.quiescing)return;
    for(const record of this.store.list<SessionActionRecord>('session-action').sort((a,b)=>a.createdAt-b.createdAt)){
      if(record.state!=='queued'||(key&&record.scopeKey!==key)||this.busy(record.scopeKey)||this.scheduledSessionActions.has(record.id))continue;
      const scope=record.scopeKey;const previous=this.controls.get(scope)??Promise.resolve();this.scheduledSessionActions.add(record.id);
      // Never await this chain from processing.done: an earlier /stop may be waiting for it.
      const task=previous.catch(()=>{}).then(async()=>{if(!this.closed&&!this.quiescing)await this.executeSessionAction(record.id);}).finally(()=>{
        this.scheduledSessionActions.delete(record.id);if(this.controls.get(scope)===task){this.controls.delete(scope);this.resumeSessionActions(scope);if(this.store.messages(scope).length)this.schedule(scope);}
      });this.controls.set(scope,task);
    }
  }
  private async executeSessionAction(id:string):Promise<void>{
    let record=this.store.get<SessionActionRecord>('session-action',id);if(!record||record.state!=='queued')return;
    try{
      const binding=this.authorizeSessionAction(record);record={...record,state:'running',updatedAt:Date.now()};this.store.put('session-action',id,record);
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
      if(this.store.get<SessionActionRecord>('session-action',id)?.state==='running')this.finishSessionAction(record,'succeeded',result);
    }catch(error){if(this.store.get<SessionActionRecord>('session-action',id)?.state!=='cancelled')this.finishSessionAction(record,'failed',`会话操作失败：${error instanceof Error?error.message:'SESSION_ACTION_FAILED'}`);}
    await this.flushDeliveries();
  }
  private assertTrusted(binding:SessionBinding,host=false):void {const bot=this.store.bot(binding.scope.botId);if(!bot.enabled||bot.archived||!trusted(bot,binding.scope))throw new Error('此命令仅供可信私聊用户使用');if(host&&!this.effectiveConfig(binding).allowHostTools)throw new Error('当前人格未允许本机工具');}
  private async feedback(message:InboundMessage,text:string):Promise<void>{const binding=this.store.binding(message.scope);const outputs:Output[]=[];for(let i=0;i<text.length;i+=1800)outputs.push({type:'text',text:text.slice(i,i+1800)});this.store.enqueue(binding,message.id,`command:${message.id}`,outputs,message.reply);await this.flushDeliveries();}
  private dispatchCommand(message:InboundMessage,command:ParsedCommand):Promise<void>{
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
  private async executeCommand(message:InboundMessage,{name,args}:ParsedCommand):Promise<string|undefined>{
    const binding=this.store.binding(message.scope);const config=this.effectiveConfig(binding);const privileged=trusted(this.store.bot(binding.scope.botId),binding.scope);
    const known=['help','stop','new','reset','status','sessions','resume','compact','persona','model','skills','skill','reload','restart','evolve','stats'];
    if(!known.includes(name))return `未知命令 /${name}。\n${commandHelp(privileged,config.allowHostTools)}`;
    if(['persona','model','skill','reload','restart','evolve','stats'].includes(name))this.assertTrusted(binding,['reload','restart','evolve'].includes(name));
    switch(name){
      case 'help':return commandHelp(privileged,config.allowHostTools);
      case 'stop':await this.stopSession(message.scope);return '已停止当前会话任务。';
      case 'new':case 'reset':{const next=await this.newSession(message.scope);return `已开启新会话：${next.sessionId}`;}
      case 'status':return `会话：${binding.sessionId}\n人格：${config.name}（${config.id}）\n模型：${config.model?`${config.model.provider} / ${config.model.model}`:'未配置'}\n状态：${({waiting_upgrade:'等待升级',compacting:'压缩中',running:'执行中',idle:'空闲'})[this.sessionStatus(binding.scope)]}`;
      case 'sessions':{const page=args?Number(args):1;if(!Number.isSafeInteger(page)||page<1)throw new Error('用法：/sessions [正整数页码]');const all=this.store.sessions(message.scope);const rows=all.slice((page-1)*10,page*10);return `会话（第 ${page} / ${Math.max(1,Math.ceil(all.length/10))} 页）：\n`+(rows.map(r=>`${r.id}${r.id===binding.sessionId?' [当前]':''}${r.persisted?'':' [尚无历史]'}${r.personaId?` 人格:${r.personaId}`:''}`).join('\n')||'此页无记录');}
      case 'resume':if(!args)throw new Error('用法：/resume <会话ID>');return `已恢复会话：${(await this.resumeSession(message.scope,args)).sessionId}`;
      case 'compact':{
        if(this.busy(binding.key))throw new Error('当前会话忙碌，请稍后再压缩');
        // Do not await the model here: iLink's receive loop must remain available for /stop.
        void this.compactSession(message.scope).then(async result=>{if(this.store.binding(message.scope).sessionId===binding.sessionId)await this.feedback(message,result||'上下文压缩完成。');}).catch(async error=>{if(this.store.binding(message.scope).sessionId===binding.sessionId)await this.feedback(message,error instanceof Error?error.message:'上下文压缩失败');});return undefined;
      }
      case 'persona':if(!args)return `当前人格：${config.id}\n`+this.store.configs().filter(c=>!c.archived).map(c=>`${c.id} — ${c.name}`).join('\n');await this.switchPersona(message.scope,args,()=>this.assertTrusted(this.store.binding(message.scope)));return `已切换人格：${args}，下一轮生效。`;
      case 'model':{
        if(!args){const models=await this.harness.models?.();return `当前模型：${config.model?`${config.model.provider} / ${config.model.model}`:'未配置'}${binding.modelOverride?'（会话覆盖）':''}`+(models?.length?'\n可用模型：\n'+models.map(m=>`${m.provider} ${m.model}`).join('\n'):'');}
        if(args.toLowerCase()==='reset'){await this.setModel(message.scope,null,()=>this.assertTrusted(this.store.binding(message.scope)));return '已恢复人格默认模型。';}const match=/^(\S+)\s+(\S+)$/.exec(args);if(!match)throw new Error('用法：/model <提供商> <模型> 或 /model reset');await this.setModel(message.scope,{provider:match[1],model:match[2]},()=>this.assertTrusted(this.store.binding(message.scope)));return `已切换模型：${match[1]} / ${match[2]}，下一轮生效。`;
      }
      case 'skills':return this.commandServices.skills?this.commandServices.skills.list(binding):`当前技能：${config.skills.join('、')||'无'}`;
      case 'skill':{const match=/^(enable|disable)\s+(\S+)$/i.exec(args);if(!match)throw new Error('用法：/skill enable|disable <名称>');const skill=skillNameSchema.parse(match[2]);if(!this.commandServices.skills)throw new Error('技能服务未启用');return this.commandServices.skills.toggle(binding,skill,match[1].toLowerCase()==='enable');}
      case 'reload':if(this.commandServices.skills)return this.commandServices.skills.reload(binding);await this.applyPersonaFiles(config.id);return '人格文件已应用，下一轮生效。';
      case 'restart':if(!this.commandServices.evolution)throw new Error('升级协调器未启用');return this.commandServices.evolution.restart(binding);
      case 'evolve':{
        if(!this.commandServices.evolution)throw new Error('自修改服务未启用');if(!args)throw new Error('用法：/evolve <要求>，或 status [ID]、history、rollback <ID>');const [action,...rest]=args.split(/\s+/);const id=rest.join(' ');
        if(action.toLowerCase()==='status')return this.commandServices.evolution.status(binding,id||undefined);if(action.toLowerCase()==='history')return this.commandServices.evolution.history(binding);if(action.toLowerCase()==='rollback'){if(!id)throw new Error('用法：/evolve rollback <任务ID>');return this.commandServices.evolution.rollback(binding,id);}
        const instruction=await this.commandServices.evolution.request(binding,args);this.assertTrusted(this.store.binding(message.scope),true);this.store.updateMessage(binding.key,{...message,text:instruction});this.store.mark(binding.key,[message.id],'pending');this.schedule(binding.key);return undefined;
      }
      case 'stats':if(!this.commandServices.stats)throw new Error('统计服务未启用');return this.commandServices.stats(binding,args);
    }
  }
  private inboundCommand(message:InboundMessage):ParsedCommand|undefined{return parseCommand(message.text)??(message.text.trimStart().startsWith('//')?undefined:parseNaturalControl(message.text));}
  private resumeCommands():void{for(const key of this.store.scopesWithPending(['control']))for(const message of this.store.messages(key,['control'])){const command=this.inboundCommand(message);if(command)void this.dispatchCommand(message,command);}}
  pauseProcessing():void{this.quiescing=true;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}
  async quiesce():Promise<void>{this.pauseProcessing();for(;;){await Promise.all(this.controls.values());await Promise.all([...this.processing.values(),...this.maintenance.values()].map(task=>task.done.catch(()=>{})));await this.harness.drain?.();await this.flushDeliveries();await Promise.all(this.senders.values());if(!this.controls.size&&!this.processing.size&&!this.maintenance.size&&!this.senders.size)return;}}
  resumeProcessing():void{this.quiescing=false;this.resumeCommands();this.resumeSessionActions();for(const key of this.store.scopesWithPending())this.schedule(key);void this.flushDeliveries();}
  resume():void{this.resumeProcessing();}
  private schedule(key:string):void{if(this.closed||this.quiescing)return;const previous=this.timers.get(key);if(previous)clearTimeout(previous);this.timers.set(key,setTimeout(()=>{this.timers.delete(key);void this.process(key);},this.debounceMs));}
  async process(key:string):Promise<void>{
    if(this.closed||this.quiescing||this.busy(key)||this.controls.has(key))return;
    const pending=this.store.messages(key);if(!pending.length)return;
    const bot=this.store.bot(pending[0].scope.botId);if(!bot.enabled||bot.archived)return;
    const deferred=this.store.messages(key,['deferred']).filter(m=>m.timestamp>Date.now()-600000).slice(-8);
    const messages=[...deferred,...pending];const binding=this.store.binding(pending[0].scope);const controller=new AbortController();
    this.store.mark(key,messages.map(m=>m.id),'processing');
    const done=Promise.resolve().then(async()=>{
      try{
      let stage:ProcessingFailure['stage']='attachments';
      try{
        for(const message of messages){
          if(message.quoted?.id){const quoted=this.store.source(key,message.quoted.id);if(quoted)message.quoted={id:quoted.id,text:quoted.text,attachments:quoted.attachments};}
          for(const input of [...message.attachments,...(message.quoted?.attachments??[])]){
            if(input.handle){this.store.asset(key,input.handle);continue;}
            const bytes=input.bytes?Buffer.from(input.bytes,'base64'):await this.adapters[bot.channel].materialize(input,controller.signal);
            const asset=await this.assets.save(key,input,bytes);input.handle=asset.id;delete input.bytes;
          }
          this.store.updateMessage(key,message);
        }
        stage='model';const result=await this.harness.run(binding,messages,controller.signal);
        if(controller.signal.aborted||this.store.binding(binding.scope).sessionId!==binding.sessionId){this.store.mark(key,messages.map(m=>m.id),'cancelled');return;}
        stage='delivery';const outputs:Output[]=[];for(const output of result.outputs){if(output.type==='text'&&output.text){for(let index=0;index<output.text.length;index+=1800)outputs.push({type:'text',text:output.text.slice(index,index+1800)});}else if(output.type==='asset'){this.store.asset(key,output.assetId!);outputs.push(output);}}
        this.store.transaction(()=>{this.store.enqueue(binding,pending.at(-1)!.id,result.turnId,outputs,pending.at(-1)!.reply);this.store.mark(key,messages.map(m=>m.id),'complete');});
      }catch(error){
        const state=controller.signal.aborted?'cancelled':'failed';const at=Date.now();
        this.store.mark(key,messages.map(m=>m.id),state);this.store.put('failure',`${binding.sessionId}:${at}`,{sessionId:binding.sessionId,scope:key,code:error instanceof Error?error.message:'PROCESS_FAILED',state,stage,sourceIds:messages.map(m=>m.id),at} satisfies ProcessingFailure);
        if(state==='failed'&&stage!=='delivery'&&this.store.binding(binding.scope).sessionId===binding.sessionId){
          const image=messages.some(m=>[...m.attachments,...(m.quoted?.attachments??[])].some(a=>a.kind==='image'));
          const text=stage==='attachments'?(image?'图片下载或读取失败，这条请求尚未送入模型，也没有生成新图。请稍后重发图片和要求。':'附件下载或读取失败，这条请求尚未送入模型。请稍后重发附件和要求。'):'这次请求的模型处理未完成，未确认本次结果。请稍后重试；详细错误已记录在管理面板。';
          this.store.enqueue(binding,pending.at(-1)!.id,`failure:${pending.at(-1)!.id}`,[{type:'text',text}],pending.at(-1)!.reply);
        }
      }
      // Queue workers own delivery failures; they must not relabel completed model requests.
      await this.flushDeliveries();
      }finally{this.processing.delete(key);this.resumeSessionActions(key);if(this.store.messages(key).length)this.schedule(key);}
    });
    this.processing.set(key,{controller,sessionId:binding.sessionId,sourceIds:messages.map(m=>m.id),done});await done;
  }
  async flushDeliveries():Promise<void>{
    if(this.closed)return;
    const botIds=new Set(this.store.deliveries(['pending']).map(d=>d.botId));
    await Promise.all([...botIds].map(id=>{const active=this.senders.get(id);if(active)return active;const task=this.flushBot(id).finally(()=>this.senders.delete(id));this.senders.set(id,task);return task;}));
  }
  private async flushBot(botId:string):Promise<void>{
    while(!this.closed){
    const batch=this.store.deliveries(['pending']).filter(d=>d.botId===botId&&!this.store.deliveries(['unknown','failed']).some(old=>old.scopeKey===d.scopeKey&&old.turnId===d.turnId&&old.index<d.index));if(!batch.length)return;
    for(const d of batch){
      // An unknown earlier receipt freezes this turn, including attachments. Never replay it.
      if(this.store.deliveries(['unknown','failed']).some(old=>old.scopeKey===d.scopeKey&&old.turnId===d.turnId&&old.index<d.index))continue;
      const current=this.store.deliveries(['pending']).find(item=>item.id===d.id);if(!current)continue;
      try{
      const bot=this.store.bot(d.botId);if(!bot.enabled||bot.archived)return;const binding=this.store.get<SessionBinding>('binding',d.scopeKey);if(!binding||binding.sessionId!==d.sessionId){this.store.deliveryState(d,'cancelled');continue;}
      const credential=await this.credentials.read(bot.id);if(!credential)return;
      // Credentials may require asynchronous IPC. A /stop, /new or disabled bot can win that race.
      if(this.closed||!this.store.deliveries(['pending']).some(item=>item.id===d.id))continue;
      const currentBot=this.store.bot(d.botId);if(!currentBot.enabled||currentBot.archived)return;
      if(this.store.get<SessionBinding>('binding',d.scopeKey)?.sessionId!==d.sessionId){this.store.deliveryState(d,'cancelled');continue;}
      const asset=d.output.type==='asset'?this.store.asset(d.scopeKey,d.output.assetId!):undefined;
      this.store.deliveryState(d,'sending');
      const controller=new AbortController();this.outbound.set(d.id,{botId:bot.id,controller});
      try{const receipt=await this.adapters[bot.channel].send(bot,credential,d,asset,AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]));this.store.deliveryState(d,'sent',receipt);}catch(error){this.store.deliveryState(d,'unknown',undefined,error instanceof Error?error.message:'DELIVERY_UNKNOWN');}finally{this.outbound.delete(d.id);}
      }catch(error){
        // Credential/asset preparation failed before sending. Attribute it only to this delivery.
        const pending=this.store.deliveries(['pending']).find(item=>item.id===d.id);if(!pending)throw error;
        this.store.deliveryState(pending,'failed',undefined,error instanceof Error?error.message:'DELIVERY_PREPARATION_FAILED');
      }
    }
    }
  }
  async close():Promise<void>{this.closed=true;for(const timer of this.timers.values())clearTimeout(timer);for(const item of this.outbound.values())item.controller.abort();for(const [key,task] of [...this.processing.entries(),...this.maintenance.entries()]){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}for(const c of this.connections.values())c.controller.abort();await Promise.all([...this.connections.values()].map(c=>c.done));await Promise.all([...this.processing.values(),...this.maintenance.values()].map(p=>p.done.catch(()=>{})));await Promise.all(this.controls.values());await Promise.all(this.senders.values());for(const signal of this.sessionActionSignals.values())signal.dispose();this.sessionActionSignals.clear();await this.harness.dispose();if(this.claimed){this.store.releaseRuntime(this.owner);this.claimed=false;}}
}
