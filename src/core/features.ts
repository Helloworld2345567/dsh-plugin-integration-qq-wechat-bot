import type {SystemLocale} from '../i18n/common.js';
import {systemDescriptor,systemMessage,SystemMessageError,builtinSkillDescription} from '../i18n/system.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {BotRuntime} from './runtime.js';
import {configSchema,type BotConfig,type SessionBinding,type TurnSnapshot} from './types.js';
import {allowedNow,freezeTurn} from './policy.js';
import {DynamicSkills} from './skills.js';
import {EvolutionService} from './evolution.js';
import {StatsService,statsQuerySchema,type StatsQueryInput,type StatsResult} from './stats.js';

import {packageRoot} from './paths.js';
import {scopeKey} from './identity.js';
import {managementCommand} from './command-bus.js';
import type {LifecyclePort,SessionHistoryPort} from './runtime-ports.js';

export const botModelArgumentsSchema=z.object({action:z.enum(['list','set','reset']),provider:z.string().min(1).max(150).optional(),model:z.string().min(1).max(200).optional()}).strict().superRefine((value,ctx)=>{
  if(value.action==='set'&&(!value.provider||!value.model))ctx.addIssue({code:'custom',message:'set 需要 list 返回的准确 provider 和 model',params:{message:systemDescriptor('modelSetRequired')}});
  if(value.action!=='set'&&(value.provider!==undefined||value.model!==undefined))ctx.addIssue({code:'custom',message:'list/reset 不接受 provider 或 model',params:{message:systemDescriptor('modelListResetInvalid')}});
});
export type BotModelArguments=z.infer<typeof botModelArgumentsSchema>;
export interface BotModelResult {action:BotModelArguments['action'];sessionId:string;personaId:string;currentTurnModel:BotConfig['model'];nextTurnModel:BotConfig['model'];override:boolean;effective:'current'|'next_turn';models?:Array<{provider:string;model:string;inputModalities?:string[];reasoning?:{supported:boolean;efforts:string[]}}>}
export const botVoiceArgumentsSchema=z.object({role:z.enum(['tts','sts']),action:z.enum(['list','set','reset']),id:z.string().trim().min(1).max(200).optional()}).strict().superRefine((value,ctx)=>{
  if(value.action==='set'&&!value.id)ctx.addIssue({code:'custom',message:'set 需要 list 返回的准确音色 ID',params:{message:systemDescriptor('voiceSetRequired')}});
  if(value.action!=='set'&&value.id!==undefined)ctx.addIssue({code:'custom',message:'list/reset 不接受音色 ID',params:{message:systemDescriptor('voiceListResetInvalid')}});
});
export type BotVoiceArguments=z.infer<typeof botVoiceArgumentsSchema>;
export interface BotVoiceResult {role:BotVoiceArguments['role'];action:BotVoiceArguments['action'];sessionId:string;current?:string;next?:string;override:boolean;effective:'current'|'next_turn';items?:ReadonlyArray<{id:string;displayName:string;modelLabel?:string;state:string;selectable:boolean;serviceId?:string;profileId?:string}>}

interface ContentChange {id:string;kind:'persona'|'skill'|'reload';scopeKey:string;configId:string;goal:string;before:BotConfig;after?:BotConfig;phase:'preparing'|'succeeded'|'failed'|'rolled-back';createdAt:number;updatedAt:number;error?:string}
export function parseStatsArguments(args:string):StatsQueryInput {
  if(!args.trim())return{};
  const result:Record<string,unknown>={};
  for(const word of args.trim().split(/\s+/)){if(['today','7d','30d','all','custom'].includes(word))result.range=word;else if(word==='groups')result.groups=true;else{const match=/^(bot|model|provider|kind|from|to)=(.+)$/.exec(word);if(!match)throw new SystemMessageError('statsUsage');result[match[1]==='bot'?'botId':match[1]]=match[2];}}
  return statsQuerySchema.parse(result);
}
export function renderStats(value:StatsResult,locale:SystemLocale='zh'):string {
  const t=(key:Parameters<typeof systemMessage>[1],params?:Parameters<typeof systemMessage>[2])=>systemMessage(locale,key,params);
  const s=value.summary;const lines=[t('statsHeading',{range:value.range.preset}),t('statsBots',{online:s.onlineBots,total:s.totalBots}),t('statsMessages',{received:s.received,sent:s.sent,unknown:s.unknown,failed:s.failed,cancelled:s.cancelled}),t('statsTokens',{tokens:s.knownTokens,input:s.inputTokens,output:s.outputTokens,read:s.cacheReadTokens,write:s.cacheWriteTokens,unknown:s.unknownUsageCalls,calls:s.calls})];
  lines.push(t('statsUnreported',{read:s.unknownCacheReadCalls,write:s.unknownCacheWriteCalls,reasoning:s.unknownReasoningCalls}));
  for(const model of value.models)lines.push(t('statsModel',{bot:model.botId,provider:model.provider,model:model.model,kind:model.kind,tokens:model.knownTokens,calls:model.calls,unknown:model.unknownUsageCalls}));
  for(const bot of value.bots)lines.push(t('statsBot',{name:bot.name,status:bot.status,groups:bot.groupSupport==='unsupported'?t('groupsUnsupported'):t('knownGroups',{count:bot.groupCount})}));
  for(const group of value.groups)lines.push(t('statsGroup',{name:group.name??group.groupId,bot:group.botId,state:group.state}));
  if(value.coverage.unknownSentTime)lines.push(t('statsMissingTime',{count:value.coverage.unknownSentTime}));
  return lines.join('\n');
}

/** One service boundary used by the model tools, slash commands and local admin UI. */
export class BotFeatures {
  readonly skills:DynamicSkills;readonly stats:StatsService;readonly evolution:EvolutionService;
  constructor(readonly runtime:BotRuntime,lifecycle?:LifecyclePort){
    const repos=runtime.repos;this.skills=new DynamicSkills(repos.personas,repos.storage.home);this.stats=new StatsService(repos.stats,()=>runtime.states,()=>repos.bots.bots(),Date.now,runtime.channels);this.evolution=new EvolutionService(repos.evolution,packageRoot(),{lifecycle});
    for(const record of runtime.repos.evolution.contentChanges<ContentChange>())if(record.phase==='preparing'){
      const current=(()=>{try{return runtime.repos.personas.config(record.configId);}catch{return undefined;}})();
      record.phase=current&&record.after&&JSON.stringify(current)===JSON.stringify(record.after)?'succeeded':'failed';record.error=record.phase==='failed'?'Publication was interrupted. Check the current revision and draft.':undefined;runtime.repos.evolution.saveContentChange(record.id,record);
    }
    runtime.commandServices={...runtime.commandServices,
      skills:{list:async (b,locale='zh')=>this.skills.list(runtime.effectiveConfig(b)).map(s=>`${s.name}: ${builtinSkillDescription(s.name,locale)??s.description}`).join('\n')||systemMessage(locale,'noSkills'),toggle:async(b,name,enabled,authorize?:()=>void,locale:SystemLocale='zh')=>{
        const current=runtime.effectiveConfig(b),owner=runtime.repos.bots.bot(b.scope.botId);
        const check=()=>{
          const binding=runtime.repos.sessions.findBinding(b.key);
          if(!binding||binding.sessionId!==b.sessionId||binding.generation!==b.generation||scopeKey(b.scope)!==b.key||scopeKey(binding.scope)!==b.key)throw Error('SKILL_SESSION_CHANGED');
          this.authorize(binding);const config=runtime.effectiveConfig(binding);
          if(config.id!==current.id||config.revision!==current.revision)throw Error('SKILL_PERSONA_CHANGED');
          if(JSON.stringify(runtime.repos.bots.bot(b.scope.botId).settings)!==JSON.stringify(owner.settings))throw Error('SKILL_SETTINGS_CHANGED');
          authorize?.();
        };
        check();const next={...current,skills:enabled?[...new Set([...current.skills,name])]:current.skills.filter(n=>n!==name)};
        await runtime.harness.validateModel(next);check();runtime.saveBot({...runtime.repos.bots.bot(owner.id),settings:{...owner.settings!,skills:next.skills}});return systemMessage(locale,enabled?'skillEnabled':'skillDisabled',{name});
      },reload:async (b,locale='zh')=>{this.authorize(b);const result=await this.reload(b);return systemMessage(locale,'filesApplied',{name:result.after!.name,revision:result.after!.revision}); }},
      evolution:{request:async(b,goal)=>{this.authorize(b,undefined,true);return `The user requests a change to the bot: ${goal}\nComplete the change and verification. Use bot_evolve(persona) for persona updates and skill_write for skill additions or updates. For plugin code, create an isolated candidateRoot, edit it, validate, then queue apply. Report actual results; do not restart directly or edit the live installation.`;},status:async(b,id,locale='zh')=>{this.authorize(b,undefined,true);return JSON.stringify(id?this.task(b,id):this.history(b)[0]??{status:systemMessage(locale,'noEvolution')});},history:async b=>{this.authorize(b,undefined,true);return JSON.stringify(this.history(b));},rollback:async(b,id)=>{this.authorize(b,undefined,true);return JSON.stringify(await this.rollback(b,id));},restart:async b=>{this.authorize(b,undefined,true);return JSON.stringify(this.evolution.queueRestart(b.key,this.config(b).id));}},
      stats:async(b,args,locale='zh')=>{this.authorize(b);return renderStats(this.stats.query(parseStatsArguments(args)),locale);},
    };
  }
  private config(binding:SessionBinding):BotConfig {return this.runtime.repos.personas.config(this.runtime.repos.personas.effectiveConfig(this.runtime.repos.sessions.findBinding(binding.key)??binding).id);}
  private authorize(binding:SessionBinding,snapshot?:TurnSnapshot,host=false):void {
    const bot=this.runtime.repos.bots.bot(binding.scope.botId);const config=this.runtime.effectiveConfig(this.runtime.repos.sessions.findBinding(binding.key)??binding);const before=snapshot??freezeTurn(config,bot,binding.scope,[],this.runtime.profiles,this.runtime.systemLocale());
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
      signal.throwIfAborted();const current=this.runtime.repos.sessions.findBinding(binding.key);
      if(!current||current.sessionId!==binding.sessionId||scopeKey(current.scope)!==binding.key||scopeKey(binding.scope)!==binding.key||snapshot.botId!==current.scope.botId)throw Error('MODEL_SESSION_CHANGED');
      const bot=this.runtime.repos.bots.bot(current.scope.botId);if(!allowedNow('bot_model',snapshot,this.runtime.effectiveConfig(current),bot,current.scope))throw Error('TRUSTED_PRIVATE_REQUIRED');
    };
    authorize();const args=botModelArgumentsSchema.parse(input);const command=managementCommand({name:'model',args:args.action==='list'?'':args.action==='reset'?'reset':`${args.provider} ${args.model}`})!;const result=await this.runtime.commandBus.execute({source:'tool',binding,snapshot,signal,authorize},command);if(result.kind!=='reply'||!result.data)throw Error('MODEL_CONTROL_FAILED');return result.data as BotModelResult;
  }
  async voice(binding:SessionBinding,snapshot:TurnSnapshot,input:unknown,signal:AbortSignal):Promise<BotVoiceResult>{
    const authorize=():void=>{
      signal.throwIfAborted();const current=this.runtime.repos.sessions.findBinding(binding.key);
      if(!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation||scopeKey(current.scope)!==binding.key||scopeKey(binding.scope)!==binding.key||snapshot.botId!==current.scope.botId)throw Error('VOICE_SESSION_CHANGED');
      const bot=this.runtime.repos.bots.bot(current.scope.botId);if(!allowedNow('bot_voice_control',snapshot,this.runtime.effectiveConfig(current),bot,current.scope))throw Error('TRUSTED_PRIVATE_REQUIRED');
    };
    authorize();const args=botVoiceArgumentsSchema.parse(input),command=managementCommand({name:args.role,args:args.action==='list'?'':args.action==='reset'?'reset':`set ${args.id}`})!;
    const result=await this.runtime.commandBus.execute({source:'tool',binding,snapshot,signal,authorize},command);if(result.kind!=='reply'||!result.data)throw Error('VOICE_CONTROL_FAILED');return result.data as BotVoiceResult;
  }
  history(binding?:SessionBinding){return [...this.evolution.history(),...this.runtime.repos.evolution.contentChanges<ContentChange>()].filter(t=>!binding||t.scopeKey===binding.key).sort((a,b)=>b.createdAt-a.createdAt);}
  task(binding:SessionBinding,id:string){const result=this.runtime.repos.evolution.findContentChange<ContentChange>(id)??this.evolution.inspect(id);if(result.scopeKey!==binding.key)throw Error('EVOLUTION_TASK_NOT_OWNED');return result;}
  private async publish(binding:SessionBinding,kind:ContentChange['kind'],goal:string,next:BotConfig,before:BotConfig,fileDigest?:string,snapshot?:TurnSnapshot,restoreDrafts=false):Promise<ContentChange>{
    this.authorize(binding,snapshot);const record:ContentChange={id:randomUUID(),kind,scopeKey:binding.key,configId:before.id,goal,before,after:{...next,revision:before.revision+1},phase:'preparing',createdAt:Date.now(),updatedAt:Date.now()};
    if(kind!=='persona'&&!restoreDrafts)this.skills.assertDrafts(next);
    const draftFingerprint=kind==='persona'?undefined:this.skills.draftFingerprint(before.id);
    this.runtime.repos.evolution.saveContentChange(record.id,record);
    try{
      if(kind!=='persona')await this.runtime.harness.validateModel(this.runtime.effectiveConfig(binding));this.authorize(binding,snapshot);
      if(draftFingerprint!==undefined&&draftFingerprint!==this.skills.draftFingerprint(before.id))throw Error('SKILL_DRAFT_CHANGED: Skill files changed during validation');
      // Revision and persona-file fingerprints are checked again after async model validation.
      const commit=()=>this.runtime.repos.personas.saveConfig(next,before.revision,fileDigest);
      record.after=restoreDrafts?this.skills.restoreDrafts(next,before,commit):commit();
      if(kind==='skill'||kind==='reload'){
        const bot=this.runtime.repos.bots.bot(binding.scope.botId),settings=bot.settings!;
        const added=next.skills.filter(name=>!before.skills.includes(name)),removed=new Set(before.skills.filter(name=>!next.skills.includes(name)));
        const versions={...settings.skillVersions};
        for(const name of new Set([...Object.keys(before.skillVersions),...Object.keys(next.skillVersions)]))if(before.skillVersions[name]!==next.skillVersions[name]){
          if(next.skillVersions[name])versions[name]=next.skillVersions[name];else delete versions[name];
        }
        this.runtime.saveBot({...bot,settings:{...settings,skills:[...new Set([...settings.skills.filter(name=>!removed.has(name)),...added])],skillVersions:versions}});
      }
      this.runtime.harness.recheckPermissions?.();record.phase='succeeded';record.updatedAt=Date.now();this.runtime.repos.evolution.saveContentChange(record.id,record);return record;
    }catch(error){record.phase='failed';record.error=error instanceof Error?error.message:String(error);this.runtime.repos.evolution.saveContentChange(record.id,record);throw error;}
  }
  async reload(binding:SessionBinding,snapshot?:TurnSnapshot):Promise<ContentChange>{
    this.authorize(binding,snapshot);const current=this.config(binding);const file=this.runtime.repos.personas.readPersonaDraft(current.id);if(file.config.revision!==current.revision)throw Error('PERSONA_REVISION_CONFLICT');
    const next=this.skills.stageDrafts(file.config);return this.publish(binding,'reload','Apply persona and skill files',next,current,file.digest,snapshot);
  }
  private async rollback(binding:SessionBinding,id:string,snapshot?:TurnSnapshot){
    this.authorize(binding,snapshot);const task=this.task(binding,id);
    if('before'in task){const current=this.runtime.repos.personas.config(task.configId);if(task.phase!=='succeeded'||current.revision!==task.after?.revision)throw new SystemMessageError('rollbackChanged');const result=await this.publish(binding,task.kind,`Rollback ${id}`,{...task.before,revision:current.revision},current,undefined,snapshot,true);task.phase='rolled-back';this.runtime.repos.evolution.saveContentChange(task.id,task);return result;}
    return this.evolution.rollback(id);
  }
  async execute(binding:SessionBinding,snapshot:TurnSnapshot,args:Record<string,unknown>,signal:AbortSignal):Promise<unknown>{
    signal.throwIfAborted();
    const action=z.string().parse(args.action);this.authorizeEvolutionAction(binding,snapshot,action);const current=this.config(binding);
    const id=()=>z.string().min(1).max(80).parse(args.taskId);
    switch(action){
      case 'create':return this.evolution.create(binding.key,current.id,z.string().min(1).max(20000).parse(args.goal),{trustedAdmin:true});
      case 'status':case 'inspect':return args.taskId?this.task(binding,id()):this.history(binding)[0]??{status:systemMessage(snapshot.systemLocale??'zh','noEvolution')};
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
    const sessions:string[]=[];
    for(const record of this.runtime.repos.sessions.sessionsAll()){
      if(!record.persisted)continue;this.stats.observeSession(record.id,record.scope.botId,record.id,'agent');sessions.push(record.id);
      try{const log=await history.readSession(record.id);for(const event of log.events)this.stats.recordNative(record.id,event,{refresh:false});}catch{/* Missing history is not zero usage and is never assigned to a guessed owner. */}
    }
    this.stats.refreshSessions(sessions);
  }
}
