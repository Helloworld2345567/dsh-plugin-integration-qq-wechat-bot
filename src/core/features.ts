import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {BotRuntime} from './runtime.js';
import {configSchema,type BotConfig,type SessionBinding,type SessionRecord,type TurnSnapshot} from './types.js';
import {allowedNow} from './policy.js';
import {DynamicSkills} from './skills.js';
import {EvolutionService} from './evolution.js';
import {StatsService,statsQuerySchema,type StatsQueryInput,type StatsResult} from './stats.js';
import {SqliteStatsData} from './sqlite-stats-data.js';
import {packageRoot} from './paths.js';
import {scopeKey} from './store.js';
import {managementCommand} from './command-bus.js';
import type {LifecyclePort,SessionHistoryPort} from './runtime-ports.js';

export const botModelArgumentsSchema=z.object({action:z.enum(['list','set','reset']),provider:z.string().min(1).max(150).optional(),model:z.string().min(1).max(200).optional()}).strict().superRefine((value,ctx)=>{
  if(value.action==='set'&&(!value.provider||!value.model))ctx.addIssue({code:'custom',message:'set 需要 list 返回的准确 provider 和 model'});
  if(value.action!=='set'&&(value.provider!==undefined||value.model!==undefined))ctx.addIssue({code:'custom',message:'list/reset 不接受 provider 或 model'});
});
export type BotModelArguments=z.infer<typeof botModelArgumentsSchema>;
export interface BotModelResult {action:BotModelArguments['action'];sessionId:string;personaId:string;currentTurnModel:BotConfig['model'];nextTurnModel:BotConfig['model'];override:boolean;effective:'current'|'next_turn';models?:Array<{provider:string;model:string;inputModalities?:string[]}>}

interface ContentChange {id:string;kind:'persona'|'skill'|'reload';scopeKey:string;configId:string;goal:string;before:BotConfig;after?:BotConfig;phase:'preparing'|'succeeded'|'failed'|'rolled-back';createdAt:number;updatedAt:number;error?:string}
export function parseStatsArguments(args:string):StatsQueryInput {
  if(!args.trim())return{};
  const result:Record<string,unknown>={};
  for(const word of args.trim().split(/\s+/)){if(['today','7d','30d','all','custom'].includes(word))result.range=word;else if(word==='groups')result.groups=true;else{const match=/^(bot|model|provider|kind|from|to)=(.+)$/.exec(word);if(!match)throw Error('/stats [today|7d|30d|all|custom] [bot=ID] [model=名称] [kind=agent|subagent|compaction|media] [from=日期 to=日期] [groups]');result[match[1]==='bot'?'botId':match[1]]=match[2];}}
  return statsQuerySchema.parse(result);
}
export function renderStats(value:StatsResult):string {
  const s=value.summary;const lines=[`统计（北京时间）：${value.range.preset}`,`机器人在线 ${s.onlineBots}/${s.totalBots}`,`消息：收到 ${s.received}，平台接受 ${s.sent}，结果未知 ${s.unknown}，失败 ${s.failed}，取消 ${s.cancelled}`,`已知 token ${s.knownTokens}（未缓存输入 ${s.inputTokens}，输出 ${s.outputTokens}，缓存读 ${s.cacheReadTokens}，缓存写 ${s.cacheWriteTokens}）；用量未知 ${s.unknownUsageCalls}/${s.calls} 次`];
  lines.push(`缓存读/写未报告 ${s.unknownCacheReadCalls}/${s.unknownCacheWriteCalls} 次；推理未报告 ${s.unknownReasoningCalls} 次。`);
  for(const model of value.models)lines.push(`${model.botId} · ${model.provider}/${model.model} · ${model.kind}：${model.knownTokens} token，${model.calls} 次，${model.unknownUsageCalls} 次用量未知`);
  for(const bot of value.bots)lines.push(`${bot.name}：${bot.status}；${bot.groupSupport==='unsupported'?'群聊不支持':`已知群 ${bot.groupCount}（非完整名单）`}`);
  for(const group of value.groups)lines.push(`群 ${group.name??group.groupId} (${group.botId})：${group.state}`);
  if(value.coverage.unknownSentTime)lines.push(`另有 ${value.coverage.unknownSentTime} 条历史发送缺少时间，不计入指定日期。`);
  return lines.join('\n');
}

/** One service boundary used by the model tools, slash commands and local admin UI. */
export class BotFeatures {
  readonly skills:DynamicSkills;readonly stats:StatsService;readonly evolution:EvolutionService;
  constructor(readonly runtime:BotRuntime,lifecycle?:LifecyclePort){
    this.skills=new DynamicSkills(runtime.store);this.stats=new StatsService(new SqliteStatsData(runtime.store),()=>runtime.states,()=>runtime.store.bots(),Date.now,runtime.channels);this.evolution=new EvolutionService(runtime.store,packageRoot(),{lifecycle});
    for(const record of runtime.store.contentChanges<ContentChange>())if(record.phase==='preparing'){
      const current=(()=>{try{return runtime.store.config(record.configId);}catch{return undefined;}})();
      record.phase=current&&record.after&&JSON.stringify(current)===JSON.stringify(record.after)?'succeeded':'failed';record.error=record.phase==='failed'?'发布被中断，请核对当前版本和草稿':undefined;runtime.store.saveContentChange(record.id,record);
    }
    runtime.commandServices={...runtime.commandServices,
      skills:{list:async b=>this.skills.list(runtime.effectiveConfig(b)).map(s=>`${s.name}：${s.description}`).join('\n')||'当前未启用技能。',toggle:async(b,name,enabled,authorize?:()=>void)=>{
        const current=this.config(b);
        const check=()=>{
          const binding=runtime.store.findBinding(b.key);
          if(!binding||binding.sessionId!==b.sessionId||binding.generation!==b.generation||scopeKey(b.scope)!==b.key||scopeKey(binding.scope)!==b.key)throw Error('SKILL_SESSION_CHANGED');
          this.authorize(binding);const config=this.config(binding);
          if(config.id!==current.id||config.revision!==current.revision)throw Error('SKILL_PERSONA_CHANGED');
          authorize?.();
        };
        check();const next={...current,skills:enabled?[...new Set([...current.skills,name])]:current.skills.filter(n=>n!==name)};
        await runtime.harness.validateModel(next);check();runtime.store.saveConfig(next,current.revision);runtime.harness.recheckPermissions?.();return `技能 ${name} 已${enabled?'启用':'停用'}。`;
      },reload:async b=>{this.authorize(b);const result=await this.reload(b);return `已应用 ${result.after!.name} v${result.after!.revision}，下一轮生效。`; }},
      evolution:{request:async(b,goal)=>{this.authorize(b,undefined,true);return `用户要求修改小樱自身：${goal}\n请完成修改和验证。人格修改使用 bot_evolve(persona)，技能新增或更新使用 skill_write。插件代码使用 create 获取隔离 candidateRoot，编辑后 validate，再 apply 排队生效。记录真实结果，不要直接重启或修改线上安装文件。`;},status:async(b,id)=>{this.authorize(b,undefined,true);return JSON.stringify(id?this.task(b,id):this.history(b)[0]??{status:'暂无改进任务'});},history:async b=>{this.authorize(b,undefined,true);return JSON.stringify(this.history(b));},rollback:async(b,id)=>{this.authorize(b,undefined,true);return JSON.stringify(await this.rollback(b,id));},restart:async b=>{this.authorize(b,undefined,true);return JSON.stringify(this.evolution.queueRestart(b.key,this.config(b).id));}},
      stats:async(b,args)=>{this.authorize(b);return renderStats(this.stats.query(parseStatsArguments(args)));},
    };
  }
  private config(binding:SessionBinding):BotConfig {return this.runtime.store.config(this.runtime.store.effectiveConfig(this.runtime.store.findBinding(binding.key)??binding).id);}
  private authorize(binding:SessionBinding,snapshot?:TurnSnapshot,host=false):void {
    const bot=this.runtime.store.bot(binding.scope.botId);const config=this.config(binding);const before=snapshot??{config,botId:bot.id,trusted:binding.scope.kind==='private'&&bot.trustedUsers.includes(binding.scope.senderId),sourceIds:[],startedAt:Date.now()};
    // Persona and skill maintenance only changes the configured bot data. Shell,
    // candidate activation and lifecycle operations remain host-authorized.
    const permission=host?'bot_evolve':'bot_stats';
    if(!allowedNow(permission,before,config,bot,binding.scope))throw Error(host?'TRUSTED_HOST_PERMISSION_REQUIRED':'TRUSTED_PRIVATE_REQUIRED');
  }
  private authorizeEvolutionAction(binding:SessionBinding,snapshot:TurnSnapshot,action:string):void {
    const hostActions=new Set(['create','validate','apply','restart']);
    this.authorize(binding,snapshot,hostActions.has(action));
  }
  async model(binding:SessionBinding,snapshot:TurnSnapshot,input:unknown,signal:AbortSignal):Promise<BotModelResult>{
    const authorize=():void=>{
      signal.throwIfAborted();const current=this.runtime.store.findBinding(binding.key);
      if(!current||current.sessionId!==binding.sessionId||scopeKey(current.scope)!==binding.key||scopeKey(binding.scope)!==binding.key||snapshot.botId!==current.scope.botId)throw Error('MODEL_SESSION_CHANGED');
      const bot=this.runtime.store.bot(current.scope.botId);if(!allowedNow('bot_model',snapshot,this.runtime.effectiveConfig(current),bot,current.scope))throw Error('TRUSTED_PRIVATE_REQUIRED');
    };
    authorize();const args=botModelArgumentsSchema.parse(input);const command=managementCommand({name:'model',args:args.action==='list'?'':args.action==='reset'?'reset':`${args.provider} ${args.model}`})!;const result=await this.runtime.commandBus.execute({source:'tool',binding,snapshot,signal,authorize},command);if(result.kind!=='reply'||!result.data)throw Error('MODEL_CONTROL_FAILED');return result.data as BotModelResult;
  }
  history(binding?:SessionBinding){return [...this.evolution.history(),...this.runtime.store.contentChanges<ContentChange>()].filter(t=>!binding||t.scopeKey===binding.key).sort((a,b)=>b.createdAt-a.createdAt);}
  task(binding:SessionBinding,id:string){const result=this.runtime.store.findContentChange<ContentChange>(id)??this.evolution.inspect(id);if(result.scopeKey!==binding.key)throw Error('EVOLUTION_TASK_NOT_OWNED');return result;}
  private async publish(binding:SessionBinding,kind:ContentChange['kind'],goal:string,next:BotConfig,before:BotConfig,fileDigest?:string,snapshot?:TurnSnapshot,restoreDrafts=false):Promise<ContentChange>{
    this.authorize(binding,snapshot);const record:ContentChange={id:randomUUID(),kind,scopeKey:binding.key,configId:before.id,goal,before,after:{...next,revision:before.revision+1},phase:'preparing',createdAt:Date.now(),updatedAt:Date.now()};
    if(kind!=='persona'&&!restoreDrafts)this.skills.assertDrafts(next);
    const draftFingerprint=kind==='persona'?undefined:this.skills.draftFingerprint(before.id);
    this.runtime.store.saveContentChange(record.id,record);
    try{
      await this.runtime.harness.validateModel(next);this.authorize(binding,snapshot);
      if(draftFingerprint!==undefined&&draftFingerprint!==this.skills.draftFingerprint(before.id))throw Error('SKILL_DRAFT_CHANGED: 技能文件在校验期间发生变化');
      // Revision and persona-file fingerprints are checked again after async model validation.
      const commit=()=>this.runtime.store.saveConfig(next,before.revision,fileDigest);
      record.after=restoreDrafts?this.skills.restoreDrafts(next,before,commit):commit();
      this.runtime.harness.recheckPermissions?.();record.phase='succeeded';record.updatedAt=Date.now();this.runtime.store.saveContentChange(record.id,record);return record;
    }catch(error){record.phase='failed';record.error=error instanceof Error?error.message:String(error);this.runtime.store.saveContentChange(record.id,record);throw error;}
  }
  async reload(binding:SessionBinding,snapshot?:TurnSnapshot):Promise<ContentChange>{
    this.authorize(binding,snapshot);const current=this.config(binding);const file=this.runtime.store.readPersonaDraft(current.id);if(file.config.revision!==current.revision)throw Error('PERSONA_REVISION_CONFLICT');
    const next=this.skills.stageDrafts(file.config);return this.publish(binding,'reload','应用人格与技能文件',next,current,file.digest,snapshot);
  }
  private async rollback(binding:SessionBinding,id:string,snapshot?:TurnSnapshot){
    this.authorize(binding,snapshot);const task=this.task(binding,id);
    if('before'in task){const current=this.runtime.store.config(task.configId);if(task.phase!=='succeeded'||current.revision!==task.after?.revision)throw Error('已有后续修改，不能覆盖回退');const result=await this.publish(binding,task.kind,`回退 ${id}`,{...task.before,revision:current.revision},current,undefined,snapshot,true);task.phase='rolled-back';this.runtime.store.saveContentChange(task.id,task);return result;}
    return this.evolution.rollback(id);
  }
  async execute(binding:SessionBinding,snapshot:TurnSnapshot,args:Record<string,unknown>,signal:AbortSignal):Promise<unknown>{
    signal.throwIfAborted();
    const action=z.string().parse(args.action);this.authorizeEvolutionAction(binding,snapshot,action);const current=this.config(binding);
    const id=()=>z.string().min(1).max(80).parse(args.taskId);
    switch(action){
      case 'create':return this.evolution.create(binding.key,current.id,z.string().min(1).max(20000).parse(args.goal),{trustedAdmin:true});
      case 'status':case 'inspect':return args.taskId?this.task(binding,id()):this.history(binding)[0]??{status:'暂无改进任务'};
      case 'history':return this.history(binding);
      case 'validate':this.task(binding,id());return this.evolution.validate(id(),signal);
      case 'apply':this.task(binding,id());return this.evolution.queueApply(id());
      case 'restart':return this.evolution.queueRestart(binding.key,current.id);
      case 'rollback':return this.rollback(binding,id(),snapshot);
      case 'reload':return this.reload(binding,snapshot);
      case 'persona':case 'skill_write':{
        const expected=z.number().int().positive().parse(args.expectedRevision??snapshot.config.revision);if(current.id!==snapshot.config.id||current.revision!==expected)throw Error('PERSONA_REVISION_CONFLICT');
        let next:BotConfig;
        if(action==='persona')next=configSchema.parse({...current,personaPrompt:z.string().min(1).max(32000).parse(args.content)});
        else {const files=z.array(z.object({path:z.string().min(1),content:z.string()}).strict()).min(1).max(200).parse(JSON.parse(z.string().parse(args.files)));next=this.skills.stageFiles(current,z.string().parse(args.name),files);}
        return this.publish(binding,action==='persona'?'persona':'skill',typeof args.goal==='string'?args.goal:action,next,current,undefined,snapshot);
      }
      default:throw Error('UNKNOWN_EVOLUTION_ACTION');
    }
  }
  async backfill(history:SessionHistoryPort):Promise<void>{
    for(const record of this.runtime.store.sessionsAll()){
      if(!record.persisted)continue;this.stats.observeSession(record.id,record.scope.botId,record.id,'agent');
      try{const log=await history.readSession(record.id);for(const event of log.events)this.stats.recordNative(record.id,event);}catch{/* Missing history is not zero usage and is never assigned to a guessed owner. */}
    }
  }
}
