import type {SystemLocale} from '../i18n/common.js';
import {systemMessage,SystemMessageError} from '../i18n/system.js';
import type {ParsedCommand} from './commands.js';
import {commandHelp} from './commands.js';
import {skillNameSchema,type BotConfig,type BotInstance,type CallerScope,type SessionBinding,type SessionRecord,type TurnSnapshot} from './types.js';
import {trusted} from './policy.js';
import type {DeferredSessionAction} from './session-actions.js';
import type {ModelCatalogItem} from './runtime-ports.js';
import {imageProtocolSchema,type ImageProtocol} from './image-service-config.js';

export type CommandSource='slash'|'natural'|'tool'|'admin';
export type ManagementCommand=
  | {kind:'session';action:'help'|'stop'|'new'|'reset'|'status'|'sessions'|'resume'|'compact';args:string}
  | {kind:'persona';action:'list'|'set';personaId?:string}
  | {kind:'model';action:'list'|'set'|'reset';provider?:string;model?:string}
  | {kind:'image';action:'list'|'set'|'reset';protocol?:string}
  | {kind:'voice';role:'tts'|'sts';action:'list'|'set'|'reset';ref?:string}
  | {kind:'skills';action:'list'|'toggle';name?:string;enabled?:boolean}
  | {kind:'reload'}
  | {kind:'restart'}
  | {kind:'evolve';args:string}
  | {kind:'stats';args:string}
  | {kind:'proactive';action:'on'|'off'|'status'|'now'|'set';args:string}
  | {kind:'schedule';action:'list'|'create'|'pause'|'resume'|'run'|'delete';args:string};

export interface CommandContext {source:CommandSource;binding:SessionBinding;snapshot?:TurnSnapshot;systemLocale?:SystemLocale;signal:AbortSignal;authorize?:()=>void}
/** A model-initiated selection publishes the replacement snapshot back to its calling turn. */
export interface SelectionTurn {snapshot:TurnSnapshot}
export type QueuedCommandResult={status:'queued';actionId:string;action:string};
export type CommandResult=
  | {kind:'reply';text:string;data?:unknown}
  | {kind:'none'}
  | {kind:'deferred';task:Promise<string>;sessionId:string}
  | {kind:'queued';value:QueuedCommandResult}
  | {kind:'rewrite';text:string};
export interface CommandServices {
  skills?:{list(binding:SessionBinding,locale?:SystemLocale):Promise<string>;toggle(binding:SessionBinding,name:string,enabled:boolean,authorize?:()=>void,locale?:SystemLocale):Promise<string>;reload(binding:SessionBinding,locale?:SystemLocale):Promise<string>};
  evolution?:{request(binding:SessionBinding,goal:string):Promise<string>;status(binding:SessionBinding,id?:string,locale?:SystemLocale):Promise<string>;history(binding:SessionBinding):Promise<string>;rollback(binding:SessionBinding,id:string):Promise<string>;restart(binding:SessionBinding):Promise<string>};
  stats?:(binding:SessionBinding,args:string,locale?:SystemLocale)=>Promise<string>;
  automation?:{proactive(binding:SessionBinding,action:'on'|'off'|'status'|'now'|'set',args:string,locale?:SystemLocale):Promise<string>;schedule(binding:SessionBinding,action:'list'|'create'|'pause'|'resume'|'run'|'delete',args:string,locale?:SystemLocale):Promise<string>};
}
export interface CommandHost {
  systemLocale?:()=>SystemLocale;
  binding(scope:CallerScope):SessionBinding;
  effectiveConfig(binding:SessionBinding):BotConfig;
  bot(scope:CallerScope):BotInstance;
  configs():BotConfig[];
  sessions(scope:CallerScope):SessionRecord[];
  session(scope:CallerScope,id:string):SessionRecord;
  sessionStatus(scope:CallerScope):string;
  busy(binding:SessionBinding):boolean;
  stopSession(scope:CallerScope):Promise<void>;
  newSession(scope:CallerScope):Promise<SessionBinding>;
  resumeSession(scope:CallerScope,id:string):Promise<SessionBinding>;
  compactSession(scope:CallerScope):Promise<string>;
  queueSessionAction(binding:SessionBinding,snapshot:TurnSnapshot,input:DeferredSessionAction,signal:AbortSignal):QueuedCommandResult;
  switchPersona(scope:CallerScope,id:string,authorize?:()=>void,turn?:SelectionTurn):Promise<SessionBinding>;
  setModel(scope:CallerScope,model:BotConfig['model'],authorize?:()=>void,turn?:SelectionTurn):Promise<SessionBinding>;
  activeTurnSnapshot(binding:SessionBinding):TurnSnapshot|undefined;
  imageSelection(binding:SessionBinding,snapshot?:TurnSnapshot):ImageSelection;
  setImage(scope:CallerScope,protocol:ImageProtocol|null,authorize?:()=>void,turn?:SelectionTurn):Promise<SessionBinding>;
  voiceCatalog(role:'tts'|'sts',binding?:SessionBinding,snapshot?:TurnSnapshot):VoiceCatalog;
  setVoice(scope:CallerScope,role:'tts'|'sts',ref:string|null,authorize?:()=>void,turn?:SelectionTurn):Promise<SessionBinding>;
  applyPersonaFiles(id:string):Promise<BotConfig>;
  models():Promise<ModelCatalogItem[]>;
  commandServices:CommandServices;
}
export interface ImageSelection {
  currentTurnProtocol:ImageProtocol;
  nextTurnProtocol:ImageProtocol;
  override:boolean;
  protocols:readonly ImageProtocol[];
}
export interface VoiceCatalogEntry {
  id:string;
  displayName:string;
  modelLabel?:string;
  state:string;
  selectable:boolean;
  serviceId?:string;
  profileId?:string;
}
export interface VoiceCatalog {
  role:'tts'|'sts';
  current?:string;
  next?:string;
  override:boolean;
  items:readonly VoiceCatalogEntry[];
}
const SESSION_ACTIONS=new Set(['help','stop','new','reset','status','sessions','resume','compact']);
export function managementCommand(parsed:ParsedCommand):ManagementCommand|undefined {
  const args=parsed.args;
  if(SESSION_ACTIONS.has(parsed.name))return{kind:'session',action:parsed.name as Extract<ManagementCommand,{kind:'session'}>['action'],args};
  if(parsed.name==='persona')return args?{kind:'persona',action:'set',personaId:args}:{kind:'persona',action:'list'};
  if(parsed.name==='image'){
    const value=args.trim().toLowerCase();
    if(!value||value==='list')return{kind:'image',action:'list'};
    if(value==='reset')return{kind:'image',action:'reset'};
    return{kind:'image',action:'set',protocol:value};
  }
  if(parsed.name==='model'){
    if(!args)return{kind:'model',action:'list'};
    if(args.toLowerCase()==='reset')return{kind:'model',action:'reset'};
    const match=/^(\S+)\s+(\S+)$/.exec(args);return{kind:'model',action:'set',provider:match?.[1],model:match?.[2]};
  }
  if(parsed.name==='tts'||parsed.name==='sts'){
    const role=parsed.name as 'tts'|'sts';
    if(!args)return{kind:'voice',role,action:'list'};
    const [action,...rest]=args.split(/\s+/);
    if(action.toLowerCase()==='list'&&rest.length===0)return{kind:'voice',role,action:'list'};
    if(action.toLowerCase()==='reset'&&rest.length===0)return{kind:'voice',role,action:'reset'};
    if(action.toLowerCase()==='set'&&rest.length===0)return{kind:'voice',role,action:'set'};
    if(action.toLowerCase()==='set'&&rest.length===1)return{kind:'voice',role,action:'set',ref:rest[0]};
    return undefined;
  }
  if(parsed.name==='skills')return{kind:'skills',action:'list'};
  if(parsed.name==='skill'){const match=/^(enable|disable)\s+(\S+)$/i.exec(args);return{kind:'skills',action:'toggle',name:match?.[2],enabled:match?.[1].toLowerCase()==='enable'};}
  if(parsed.name==='reload')return{kind:'reload'};
  if(parsed.name==='restart')return{kind:'restart'};
  if(parsed.name==='evolve')return{kind:'evolve',args};
  if(parsed.name==='stats')return{kind:'stats',args};
  if(parsed.name==='proactive'){const action=(args.split(/\s+/,1)[0]||'status').toLowerCase();if(!['on','off','status','now','set'].includes(action))return undefined;return{kind:'proactive',action:action as any,args:args.slice(action.length).trim()};}
  if(parsed.name==='schedule'){const action=(args.split(/\s+/,1)[0]||'list').toLowerCase();if(!['list','create','pause','resume','run','delete'].includes(action))return undefined;return{kind:'schedule',action:action as any,args:args.slice(action.length).trim()};}
  return undefined;
}
export class CommandBus {
  constructor(readonly host:CommandHost){}
  private trusted(binding:SessionBinding,hostTools=false):void {
    const bot=this.host.bot(binding.scope);if(!bot.enabled||bot.archived||!trusted(bot,binding.scope))throw new SystemMessageError('trustedRequired');
    if(hostTools&&!this.host.effectiveConfig(binding).allowHostTools)throw new SystemMessageError('hostToolsRequired');
  }
  private authorize(context:CommandContext,hostTools=false):SessionBinding {context.signal.throwIfAborted();context.authorize?.();const current=this.host.binding(context.binding.scope);this.trusted(current,hostTools);return current;}
  private queue(context:CommandContext,input:DeferredSessionAction):CommandResult {
    if(!context.snapshot)throw Error('COMMAND_SNAPSHOT_REQUIRED');
    return{kind:'queued',value:this.host.queueSessionAction(context.binding,context.snapshot,input,context.signal)};
  }
  private sessionStatusText(binding:SessionBinding,config:BotConfig,locale:SystemLocale):string {
    const state=({waiting_upgrade:systemMessage(locale,'stateWaiting'),compacting:systemMessage(locale,'stateCompacting'),running:systemMessage(locale,'stateRunning'),idle:systemMessage(locale,'stateIdle')} as Record<string,string>)[this.host.sessionStatus(binding.scope)]??this.host.sessionStatus(binding.scope);
    return systemMessage(locale,'sessionStatus',{id:binding.sessionId,name:config.name,persona:config.id,model:config.model?`${config.model.provider} / ${config.model.model}`:systemMessage(locale,'notConfigured'),state});
  }
  async execute(context:CommandContext,command:ManagementCommand):Promise<CommandResult>{
    context.signal.throwIfAborted();const locale=context.snapshot?.systemLocale??context.systemLocale??this.host.systemLocale?.()??'zh';const t=(key:Parameters<typeof systemMessage>[1],params?:Parameters<typeof systemMessage>[2])=>systemMessage(locale,key,params);const binding=context.binding;const config=this.host.effectiveConfig(binding);const bot=this.host.bot(binding.scope);const privileged=trusted(bot,binding.scope);
    const turn=context.source==='tool'&&context.snapshot?{snapshot:context.snapshot}:undefined;
    switch(command.kind){
      case 'session':
        switch(command.action){
          case 'help':return{kind:'reply',text:commandHelp(privileged,config.allowHostTools,locale)};
          case 'stop':if(context.source==='tool')return this.queue(context,{action:'stop'});await this.host.stopSession(binding.scope);return{kind:'reply',text:t('stopped')};
          case 'new':case 'reset':if(context.source==='tool')return this.queue(context,{action:'new'});return{kind:'reply',text:t('newSession',{id:(await this.host.newSession(binding.scope)).sessionId})};
          case 'status':{
            const active=(context.snapshot??this.host.activeTurnSnapshot(binding))?.config??config;
            return {kind:'reply',text:this.sessionStatusText(binding,active,locale),data:{sessionId:binding.sessionId,persona:{id:config.id,name:config.name},model:config.model,modelOverride:!!binding.modelOverride,currentTurnPersonaId:active.id,currentTurnModel:active.model,state:this.host.sessionStatus(binding.scope)}};
          }
          case 'sessions':{const page=command.args?Number(command.args):1;if(!Number.isSafeInteger(page)||page<1)throw new SystemMessageError('sessionsUsage');const all=this.host.sessions(binding.scope);const rows=all.slice((page-1)*10,page*10);return{kind:'reply',text:t('sessionsHeading',{page,pages:Math.max(1,Math.ceil(all.length/10))})+(rows.map(record=>`${record.id}${record.id===binding.sessionId?t('currentMarker'):''}${record.persisted?'':t('noHistoryMarker')}${record.personaId?t('personaMarker',{id:record.personaId}):''}`).join('\n')||t('emptyPage')),data:{page,pages:Math.max(1,Math.ceil(all.length/10)),sessions:rows}};}
          case 'resume':if(!command.args)throw new SystemMessageError('resumeUsage');this.host.session(binding.scope,command.args);if(context.source==='tool')return this.queue(context,{action:'resume',sessionId:command.args});return{kind:'reply',text:t('resumedSession',{id:(await this.host.resumeSession(binding.scope,command.args)).sessionId})};
          case 'compact':if(context.source==='tool')return this.queue(context,{action:'compact'});if(this.host.busy(binding))throw new SystemMessageError('busyCompact');return{kind:'deferred',task:this.host.compactSession(binding.scope).then(result=>result||t('compacted')),sessionId:binding.sessionId};
        }
        break;
      case 'persona':{
        this.authorize(context);
        if(!command.personaId)return {kind:'reply',text:t('currentPersona',{id:(context.snapshot??this.host.activeTurnSnapshot(binding))?.personaId??config.id})+this.host.configs().filter(item=>!item.archived).map(item=>`${item.id} — ${item.name}`).join('\n')};
        const updated=await this.host.switchPersona(binding.scope,command.personaId,()=>this.authorize(context),turn);
        return {kind:'reply',text:t('personaSwitched',{id:command.personaId}),data:{action:'set',currentTurnPersonaId:turn?.snapshot.personaId??this.host.activeTurnSnapshot(updated)?.personaId??command.personaId,effective:turn?'current':'next_turn'}};
      }
      case 'model':{
        const current=this.authorize(context);
        if(command.action==='list'){
          const models=await this.host.models(),latest=this.authorize(context),saved=this.host.effectiveConfig(latest);
          const selected=(context.snapshot??this.host.activeTurnSnapshot(latest))?.config.model??saved.model;
          return {kind:'reply',text:t('currentModel',{model:selected?`${selected.provider} / ${selected.model}`:t('notConfigured'),override:latest.modelOverride?t('sessionOverride'):''})+(models.length?t('availableModels')+models.map(model=>`${model.provider} ${model.model}`).join('\n'):''),data:{action:'list',sessionId:latest.sessionId,personaId:saved.id,currentTurnModel:selected,nextTurnModel:saved.model,override:!!latest.modelOverride,effective:'current',models}};
        }
        if(command.action==='set'&&(!command.provider||!command.model))throw new SystemMessageError('modelUsage');
        const selected=command.action==='reset'?null:{provider:command.provider!,model:command.model!};
        const updated=await this.host.setModel(current.scope,selected,()=>this.authorize(context),turn);
        const saved=this.host.effectiveConfig(updated),active=turn?.snapshot??this.host.activeTurnSnapshot(updated);
        return {kind:'reply',text:selected?t('modelSwitched',selected):t('modelReset'),data:{action:command.action,sessionId:updated.sessionId,personaId:saved.id,currentTurnModel:active?.config.model??saved.model,nextTurnModel:saved.model,override:!!updated.modelOverride,effective:turn?'current':'next_turn'}};
      }
      case 'image':{
        const current=this.authorize(context);
        if(command.action==='list'){
          const status=this.host.imageSelection(current,context.snapshot);
          return {kind:'reply',text:t('imageSelection',{current:status.currentTurnProtocol,next:status.nextTurnProtocol,source:status.override?t('sessionOverride'):t('imageDefault'),protocols:status.protocols.join(', ')}),data:{action:'list',sessionId:current.sessionId,...status,effective:'current'}};
        }
        const parsed=imageProtocolSchema.safeParse(command.protocol?.trim().toLowerCase());
        if(command.action==='set'&&!parsed.success)throw new SystemMessageError('imageUsage');
        const updated=await this.host.setImage(current.scope,command.action==='reset'?null:parsed.data!,()=>this.authorize(context),turn);
        const status=this.host.imageSelection(updated,turn?.snapshot);
        return {kind:'reply',text:t(command.action==='reset'?'imageReset':'imageSwitched',{protocol:status.nextTurnProtocol}),data:{action:command.action,sessionId:updated.sessionId,...status,effective:turn?'current':'next_turn'}};
      }
      case 'voice':{
        const current=this.authorize(context),roleLabel=command.role.toUpperCase();
        if(command.action==='list'){
          const catalog=this.host.voiceCatalog(command.role,current,context.snapshot),items=catalog.items.filter(item=>item.selectable);
          const rows=items.map(item=>`${item.id} — ${item.displayName}${item.modelLabel?` · ${item.modelLabel}`:''}`);
          const voice=catalog.current??t('notConfigured'),saved=catalog.next??t('notConfigured');
          const source=catalog.override?t('sessionOverride'):'';
          const detail=catalog.current===catalog.next?source:t('nextVoice',{voice:saved+source});
          return {kind:'reply',text:t('currentVoice',{role:roleLabel,current:voice,override:detail,voices:rows.join('\n')||t('none')}),data:{action:'list',role:command.role,sessionId:current.sessionId,current:catalog.current,next:catalog.next,override:catalog.override,effective:'current',items}};
        }
        if(command.action==='set'&&!command.ref)throw new SystemMessageError('voiceUsage',{role:roleLabel});
        const updated=await this.host.setVoice(current.scope,command.role,command.ref??null,()=>this.authorize(context),turn);
        const catalog=this.host.voiceCatalog(command.role,updated,turn?.snapshot);
        return {kind:'reply',text:command.action==='set'?t('voiceSwitched',{role:roleLabel,id:command.ref!}):t('voiceReset',{role:roleLabel}),data:{action:command.action,role:command.role,sessionId:updated.sessionId,current:catalog.current,next:catalog.next,override:catalog.override,effective:turn?'current':'next_turn'}};
      }
      case 'skills':if(command.action==='list')return{kind:'reply',text:this.host.commandServices.skills?await this.host.commandServices.skills.list(binding,locale):t('currentSkills',{names:config.skills.join(', ')||t('none')})};this.authorize(context);if(!command.name)throw new SystemMessageError('skillUsage');if(context.source==='tool')return this.queue(context,{action:'skill',name:skillNameSchema.parse(command.name),enabled:command.enabled!});if(!this.host.commandServices.skills)throw new SystemMessageError('skillServiceMissing');return{kind:'reply',text:await this.host.commandServices.skills.toggle(binding,skillNameSchema.parse(command.name),command.enabled!,()=>this.authorize(context),locale)};
      case 'reload':this.authorize(context,true);if(this.host.commandServices.skills)return{kind:'reply',text:await this.host.commandServices.skills.reload(binding,locale)};await this.host.applyPersonaFiles(config.id);return{kind:'reply',text:t('personaFilesApplied')};
      case 'restart':this.authorize(context,true);if(!this.host.commandServices.evolution)throw new SystemMessageError('coordinatorMissing');return{kind:'reply',text:await this.host.commandServices.evolution.restart(binding)};
      case 'stats':this.authorize(context);if(!this.host.commandServices.stats)throw new SystemMessageError('statsServiceMissing');return{kind:'reply',text:await this.host.commandServices.stats(binding,command.args,locale)};
      case 'proactive':this.authorize(context);if(!this.host.commandServices.automation)throw new SystemMessageError('proactiveServiceMissing');return{kind:'reply',text:await this.host.commandServices.automation.proactive(binding,command.action,command.args,locale)};
      case 'schedule':this.authorize(context);if(!this.host.commandServices.automation)throw new SystemMessageError('scheduleServiceMissing');return{kind:'reply',text:await this.host.commandServices.automation.schedule(binding,command.action,command.args,locale)};
      case 'evolve':this.authorize(context,true);if(!this.host.commandServices.evolution)throw new SystemMessageError('evolutionServiceMissing');if(!command.args)throw new SystemMessageError('evolveUsage');{const [action,...rest]=command.args.split(/\s+/);const id=rest.join(' ');if(action.toLowerCase()==='status')return{kind:'reply',text:await this.host.commandServices.evolution.status(binding,id||undefined,locale)};if(action.toLowerCase()==='history')return{kind:'reply',text:await this.host.commandServices.evolution.history(binding)};if(action.toLowerCase()==='rollback'){if(!id)throw new SystemMessageError('rollbackUsage');return{kind:'reply',text:await this.host.commandServices.evolution.rollback(binding,id)};}return{kind:'rewrite',text:await this.host.commandServices.evolution.request(binding,command.args)};}
    }
    return{kind:'none'};
  }
}
