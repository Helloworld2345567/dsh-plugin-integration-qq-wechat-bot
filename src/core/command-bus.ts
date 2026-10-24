import type {ParsedCommand} from './commands.js';
import {commandHelp} from './commands.js';
import {skillNameSchema,type BotConfig,type BotInstance,type CallerScope,type SessionBinding,type SessionRecord,type TurnSnapshot} from './types.js';
import {trusted} from './policy.js';
import type {DeferredSessionAction} from './session-actions.js';

export type CommandSource='slash'|'natural'|'tool'|'admin';
export type ManagementCommand=
  | {kind:'session';action:'help'|'stop'|'new'|'reset'|'status'|'sessions'|'resume'|'compact';args:string}
  | {kind:'persona';action:'list'|'set';personaId?:string}
  | {kind:'model';action:'list'|'set'|'reset';provider?:string;model?:string}
  | {kind:'skills';action:'list'|'toggle';name?:string;enabled?:boolean}
  | {kind:'reload'}
  | {kind:'restart'}
  | {kind:'evolve';args:string}
  | {kind:'stats';args:string}
  | {kind:'proactive';action:'on'|'off'|'status'|'now'|'set';args:string}
  | {kind:'schedule';action:'list'|'create'|'pause'|'resume'|'run'|'delete';args:string};

export interface CommandContext {source:CommandSource;binding:SessionBinding;snapshot?:TurnSnapshot;signal:AbortSignal;authorize?:()=>void}
export type QueuedCommandResult={status:'queued';actionId:string;action:string};
export type CommandResult=
  | {kind:'reply';text:string;data?:unknown}
  | {kind:'none'}
  | {kind:'deferred';task:Promise<string>;sessionId:string}
  | {kind:'queued';value:QueuedCommandResult}
  | {kind:'rewrite';text:string};
export interface CommandServices {
  skills?:{list(binding:SessionBinding):Promise<string>;toggle(binding:SessionBinding,name:string,enabled:boolean,authorize?:()=>void):Promise<string>;reload(binding:SessionBinding):Promise<string>};
  evolution?:{request(binding:SessionBinding,goal:string):Promise<string>;status(binding:SessionBinding,id?:string):Promise<string>;history(binding:SessionBinding):Promise<string>;rollback(binding:SessionBinding,id:string):Promise<string>;restart(binding:SessionBinding):Promise<string>};
  stats?:(binding:SessionBinding,args:string)=>Promise<string>;
  automation?:{proactive(binding:SessionBinding,action:'on'|'off'|'status'|'now'|'set',args:string):Promise<string>;schedule(binding:SessionBinding,action:'list'|'create'|'pause'|'resume'|'run'|'delete',args:string):Promise<string>};
}
export interface CommandHost {
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
  switchPersona(scope:CallerScope,id:string,authorize?:()=>void):Promise<SessionBinding>;
  setModel(scope:CallerScope,model:BotConfig['model'],authorize?:()=>void):Promise<SessionBinding>;
  applyPersonaFiles(id:string):Promise<BotConfig>;
  models():Promise<Array<{provider:string;model:string;inputModalities?:string[]}>>;
  commandServices:CommandServices;
}

const SESSION_ACTIONS=new Set(['help','stop','new','reset','status','sessions','resume','compact']);
export function managementCommand(parsed:ParsedCommand):ManagementCommand|undefined {
  const args=parsed.args;
  if(SESSION_ACTIONS.has(parsed.name))return{kind:'session',action:parsed.name as Extract<ManagementCommand,{kind:'session'}>['action'],args};
  if(parsed.name==='persona')return args?{kind:'persona',action:'set',personaId:args}:{kind:'persona',action:'list'};
  if(parsed.name==='model'){
    if(!args)return{kind:'model',action:'list'};
    if(args.toLowerCase()==='reset')return{kind:'model',action:'reset'};
    const match=/^(\S+)\s+(\S+)$/.exec(args);return{kind:'model',action:'set',provider:match?.[1],model:match?.[2]};
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
    const bot=this.host.bot(binding.scope);if(!bot.enabled||bot.archived||!trusted(bot,binding.scope))throw new Error('此命令仅供可信私聊用户使用');
    if(hostTools&&!this.host.effectiveConfig(binding).allowHostTools)throw new Error('当前人格未允许本机工具');
  }
  private authorize(context:CommandContext,hostTools=false):SessionBinding {context.signal.throwIfAborted();context.authorize?.();const current=this.host.binding(context.binding.scope);this.trusted(current,hostTools);return current;}
  private queue(context:CommandContext,input:DeferredSessionAction):CommandResult {
    if(!context.snapshot)throw Error('COMMAND_SNAPSHOT_REQUIRED');
    return{kind:'queued',value:this.host.queueSessionAction(context.binding,context.snapshot,input,context.signal)};
  }
  private sessionStatusText(binding:SessionBinding,config:BotConfig):string {
    const state=({waiting_upgrade:'等待升级',compacting:'压缩中',running:'执行中',idle:'空闲'} as Record<string,string>)[this.host.sessionStatus(binding.scope)]??this.host.sessionStatus(binding.scope);
    return `会话：${binding.sessionId}\n人格：${config.name}（${config.id}）\n模型：${config.model?`${config.model.provider} / ${config.model.model}`:'未配置'}\n状态：${state}`;
  }
  async execute(context:CommandContext,command:ManagementCommand):Promise<CommandResult>{
    context.signal.throwIfAborted();const binding=context.binding;const config=this.host.effectiveConfig(binding);const bot=this.host.bot(binding.scope);const privileged=trusted(bot,binding.scope);
    switch(command.kind){
      case 'session':
        switch(command.action){
          case 'help':return{kind:'reply',text:commandHelp(privileged,config.allowHostTools)};
          case 'stop':if(context.source==='tool')return this.queue(context,{action:'stop'});await this.host.stopSession(binding.scope);return{kind:'reply',text:'已停止当前会话任务。'};
          case 'new':case 'reset':if(context.source==='tool')return this.queue(context,{action:'new'});return{kind:'reply',text:`已开启新会话：${(await this.host.newSession(binding.scope)).sessionId}`};
          case 'status':return{kind:'reply',text:this.sessionStatusText(binding,config),data:{sessionId:binding.sessionId,persona:{id:config.id,name:config.name},model:config.model,modelOverride:!!binding.modelOverride,currentTurnPersonaId:context.snapshot?.config.id??config.id,currentTurnModel:context.snapshot?.config.model??config.model,state:this.host.sessionStatus(binding.scope)}};
          case 'sessions':{const page=command.args?Number(command.args):1;if(!Number.isSafeInteger(page)||page<1)throw new Error('用法：/sessions [正整数页码]');const all=this.host.sessions(binding.scope);const rows=all.slice((page-1)*10,page*10);return{kind:'reply',text:`会话（第 ${page} / ${Math.max(1,Math.ceil(all.length/10))} 页）：\n`+(rows.map(record=>`${record.id}${record.id===binding.sessionId?' [当前]':''}${record.persisted?'':' [尚无历史]'}${record.personaId?` 人格:${record.personaId}`:''}`).join('\n')||'此页无记录'),data:{page,pages:Math.max(1,Math.ceil(all.length/10)),sessions:rows}};}
          case 'resume':if(!command.args)throw new Error('用法：/resume <会话ID>');this.host.session(binding.scope,command.args);if(context.source==='tool')return this.queue(context,{action:'resume',sessionId:command.args});return{kind:'reply',text:`已恢复会话：${(await this.host.resumeSession(binding.scope,command.args)).sessionId}`};
          case 'compact':if(context.source==='tool')return this.queue(context,{action:'compact'});if(this.host.busy(binding))throw new Error('当前会话忙碌，请稍后再压缩');return{kind:'deferred',task:this.host.compactSession(binding.scope).then(result=>result||'上下文压缩完成。'),sessionId:binding.sessionId};
        }
        break;
      case 'persona':this.authorize(context);if(!command.personaId)return{kind:'reply',text:`当前人格：${config.id}\n`+this.host.configs().filter(item=>!item.archived).map(item=>`${item.id} — ${item.name}`).join('\n')};if(context.source==='tool')return this.queue(context,{action:'persona',personaId:command.personaId});await this.host.switchPersona(binding.scope,command.personaId,()=>this.authorize(context));return{kind:'reply',text:`已切换人格：${command.personaId}，下一轮生效。`};
      case 'model':this.authorize(context);if(command.action==='list'){const models=await this.host.models();this.authorize(context);return{kind:'reply',text:`当前模型：${config.model?`${config.model.provider} / ${config.model.model}`:'未配置'}${binding.modelOverride?'（会话覆盖）':''}`+(models.length?'\n可用模型：\n'+models.map(model=>`${model.provider} ${model.model}`).join('\n'):''),data:{action:'list',sessionId:binding.sessionId,personaId:config.id,currentTurnModel:context.snapshot?.config.model??config.model,nextTurnModel:this.host.effectiveConfig(this.host.binding(binding.scope)).model,override:!!binding.modelOverride,effective:'current',models}};}if(command.action==='reset'){await this.host.setModel(binding.scope,null,()=>this.authorize(context));const current=this.host.binding(binding.scope);return{kind:'reply',text:'已恢复人格默认模型。',data:{action:'reset',sessionId:current.sessionId,personaId:this.host.effectiveConfig(current).id,currentTurnModel:context.snapshot?.config.model??config.model,nextTurnModel:this.host.effectiveConfig(current).model,override:!!current.modelOverride,effective:'next_turn'}};}if(!command.provider||!command.model)throw Error('用法：/model <提供商> <模型> 或 /model reset');await this.host.setModel(binding.scope,{provider:command.provider,model:command.model},()=>this.authorize(context));{const current=this.host.binding(binding.scope);return{kind:'reply',text:`已切换模型：${command.provider} / ${command.model}，下一轮生效。`,data:{action:'set',sessionId:current.sessionId,personaId:this.host.effectiveConfig(current).id,currentTurnModel:context.snapshot?.config.model??config.model,nextTurnModel:this.host.effectiveConfig(current).model,override:true,effective:'next_turn'}};}
      case 'skills':if(command.action==='list')return{kind:'reply',text:this.host.commandServices.skills?await this.host.commandServices.skills.list(binding):`当前技能：${config.skills.join('、')||'无'}`};this.authorize(context);if(!command.name)throw Error('用法：/skill enable|disable <名称>');if(context.source==='tool')return this.queue(context,{action:'skill',name:skillNameSchema.parse(command.name),enabled:command.enabled!});if(!this.host.commandServices.skills)throw new Error('技能服务未启用');return{kind:'reply',text:await this.host.commandServices.skills.toggle(binding,skillNameSchema.parse(command.name),command.enabled!,()=>this.authorize(context))};
      case 'reload':this.authorize(context,true);if(this.host.commandServices.skills)return{kind:'reply',text:await this.host.commandServices.skills.reload(binding)};await this.host.applyPersonaFiles(config.id);return{kind:'reply',text:'人格文件已应用，下一轮生效。'};
      case 'restart':this.authorize(context,true);if(!this.host.commandServices.evolution)throw new Error('升级协调器未启用');return{kind:'reply',text:await this.host.commandServices.evolution.restart(binding)};
      case 'stats':this.authorize(context);if(!this.host.commandServices.stats)throw new Error('统计服务未启用');return{kind:'reply',text:await this.host.commandServices.stats(binding,command.args)};
      case 'proactive':this.authorize(context);if(!this.host.commandServices.automation)throw Error('主动会话服务未启用');return{kind:'reply',text:await this.host.commandServices.automation.proactive(binding,command.action,command.args)};
      case 'schedule':this.authorize(context);if(!this.host.commandServices.automation)throw Error('定时任务服务未启用');return{kind:'reply',text:await this.host.commandServices.automation.schedule(binding,command.action,command.args)};
      case 'evolve':this.authorize(context,true);if(!this.host.commandServices.evolution)throw new Error('自修改服务未启用');if(!command.args)throw new Error('用法：/evolve <要求>，或 status [ID]、history、rollback <ID>');{const [action,...rest]=command.args.split(/\s+/);const id=rest.join(' ');if(action.toLowerCase()==='status')return{kind:'reply',text:await this.host.commandServices.evolution.status(binding,id||undefined)};if(action.toLowerCase()==='history')return{kind:'reply',text:await this.host.commandServices.evolution.history(binding)};if(action.toLowerCase()==='rollback'){if(!id)throw new Error('用法：/evolve rollback <任务ID>');return{kind:'reply',text:await this.host.commandServices.evolution.rollback(binding,id)};}return{kind:'rewrite',text:await this.host.commandServices.evolution.request(binding,command.args)};}
    }
    return{kind:'none'};
  }
}
