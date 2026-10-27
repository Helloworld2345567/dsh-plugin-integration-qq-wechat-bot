import {z} from 'zod';
import type {BotRuntime} from './runtime.js';
import type {BotFeatures} from './features.js';
import {idSchema,skillNameSchema,type SessionBinding,type TurnSnapshot} from './types.js';
import {scopeKey} from './store.js';
import {trusted} from './policy.js';
import {commandHelp} from './commands.js';
import {packagedSkills} from './skills.js';
import {managementCommand} from './command-bus.js';

export const botSessionArgumentsSchema=z.object({
  action:z.enum(['help','status','list','new','stop','compact','resume']),
  page:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  sessionId:z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/).optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.action!=='list'&&value.page!==undefined)ctx.addIssue({code:'custom',message:'page 仅用于 list'});
  if(value.action==='resume'&&!value.sessionId)ctx.addIssue({code:'custom',message:'resume 需要所属历史会话的 sessionId'});
  if(value.action!=='resume'&&value.sessionId!==undefined)ctx.addIssue({code:'custom',message:'sessionId 仅作为 resume 目标'});
});
export const botPersonaArgumentsSchema=z.object({action:z.enum(['list','set']),personaId:idSchema.optional()}).strict().superRefine((value,ctx)=>{
  if(value.action==='set'&&!value.personaId)ctx.addIssue({code:'custom',message:'set 需要 list 返回的人格 ID'});
  if(value.action==='list'&&value.personaId!==undefined)ctx.addIssue({code:'custom',message:'list 不接受 personaId'});
});
export const botSkillsArgumentsSchema=z.object({action:z.enum(['list','enable','disable']),name:skillNameSchema.optional()}).strict().superRefine((value,ctx)=>{
  if(value.action!=='list'&&!value.name)ctx.addIssue({code:'custom',message:'启停技能需要准确名称'});
  if(value.action==='list'&&value.name!==undefined)ctx.addIssue({code:'custom',message:'list 不接受 name'});
});
export type BotSessionArguments=z.infer<typeof botSessionArgumentsSchema>;
export type BotPersonaArguments=z.infer<typeof botPersonaArgumentsSchema>;
export type BotSkillsArguments=z.infer<typeof botSkillsArgumentsSchema>;

/** Identity comes from the native Agent closure; channel mutations run outside the calling turn. */
export class BotManagement {
  constructor(readonly runtime:BotRuntime,readonly features:BotFeatures){}
  private async busSession(binding:SessionBinding,snapshot:TurnSnapshot,input:BotSessionArguments,signal:AbortSignal){
    if(!['status','new','stop','compact','resume'].includes(input.action))return;
    const args=input.action==='resume'?input.sessionId??'':'';const command=managementCommand({name:input.action,args});if(!command)throw Error('UNKNOWN_MANAGEMENT_COMMAND');const result=await this.runtime.commandBus.execute({source:'tool',binding,snapshot,signal},command);
    if(result.kind==='queued')return result.value;
    if(result.kind!=='reply')return result;
    const data=result.data as Record<string,unknown>|undefined;return{action:input.action,text:result.text,...data};
  }

  private current(binding:SessionBinding,snapshot:TurnSnapshot,signal:AbortSignal,privileged=false):SessionBinding {
    signal.throwIfAborted();const current=this.runtime.store.findBinding(binding.key);
    if(!current||current.sessionId!==binding.sessionId||current.generation!==binding.generation||scopeKey(binding.scope)!==binding.key||scopeKey(current.scope)!==binding.key||snapshot.botId!==current.scope.botId)throw Error('MANAGEMENT_SESSION_CHANGED');
    const bot=this.runtime.store.bot(current.scope.botId);this.runtime.effectiveConfig(current);
    if(!bot.enabled||bot.archived)throw Error('BOT_UNAVAILABLE');
    if(privileged&&(!snapshot.trusted||!trusted(bot,current.scope)))throw Error('TRUSTED_PRIVATE_REQUIRED');
    return current;
  }

  async session(binding:SessionBinding,snapshot:TurnSnapshot,input:unknown,signal:AbortSignal){
    const current=this.current(binding,snapshot,signal);const args=botSessionArgumentsSchema.parse(input);const busResult=await this.busSession(current,snapshot,args,signal);if(busResult)return busResult;const config=this.runtime.effectiveConfig(current);
    switch(args.action){
      case 'help':return{action:args.action,text:commandHelp(snapshot.trusted&&trusted(this.runtime.store.bot(current.scope.botId),current.scope),snapshot.config.allowHostTools&&config.allowHostTools)};
      case 'status':return{action:args.action,sessionId:current.sessionId,persona:{id:config.id,name:config.name},model:config.model,modelOverride:!!current.modelOverride,currentTurnPersonaId:snapshot.config.id,currentTurnModel:snapshot.config.model,state:this.runtime.sessionStatus(current.scope)};
      case 'list':{
        const page=args.page??1;const all=this.runtime.store.sessions(current.scope);const sessions=all.slice((page-1)*10,page*10).map(record=>({sessionId:record.id,current:record.id===current.sessionId,persisted:record.persisted,createdAt:record.createdAt,updatedAt:record.updatedAt,...record.personaId?{personaId:record.personaId}:{}}));
        return{action:args.action,page,pages:Math.max(1,Math.ceil(all.length/10)),sessions};
      }
      case 'resume':this.runtime.store.session(current.scope,args.sessionId!);return this.runtime.queueSessionAction(current,snapshot,{action:'resume',sessionId:args.sessionId!},signal);
      default:return this.runtime.queueSessionAction(current,snapshot,{action:args.action},signal);
    }
  }

  async persona(binding:SessionBinding,snapshot:TurnSnapshot,input:unknown,signal:AbortSignal){
    const current=this.current(binding,snapshot,signal,true);const args=botPersonaArgumentsSchema.parse(input);const config=this.runtime.effectiveConfig(current);
    if(args.action==='list')return{action:args.action,sessionId:current.sessionId,currentPersonaId:config.id,currentTurnPersonaId:snapshot.config.id,personas:this.runtime.store.configs().filter(item=>!item.archived).map(item=>({id:item.id,name:item.name,revision:item.revision,current:item.id===config.id}))};
    this.runtime.store.config(args.personaId!);const command=managementCommand({name:'persona',args:args.personaId!})!;const result=await this.runtime.commandBus.execute({source:'tool',binding:current,snapshot,signal,authorize:()=>this.current(binding,snapshot,signal,true)},command);return result.kind==='queued'?result.value:result;
  }

  async skills(binding:SessionBinding,snapshot:TurnSnapshot,input:unknown,signal:AbortSignal){
    const args=botSkillsArgumentsSchema.parse(input);const current=this.current(binding,snapshot,signal,args.action!=='list');const config=this.runtime.effectiveConfig(current);
    if(args.action==='list'){
      const privileged=snapshot.trusted&&trusted(this.runtime.store.bot(current.scope.botId),current.scope);
      const names=privileged?[...new Set([...config.skills,...Object.keys(packagedSkills),...Object.keys(config.skillVersions)])]:[...config.skills];
      const skills=names.map(name=>{
        const base={name,enabled:config.skills.includes(name),builtin:Object.hasOwn(packagedSkills,name)};
        try{const item=this.features.skills.list({...config,skills:[name]})[0]!;return{...base,description:item.description,version:item.version,available:true};}
        catch{return{...base,description:'技能资源当前不可读取。',version:config.skillVersions[name]??null,available:false};}
      });
      return{action:args.action,personaId:config.id,revision:config.revision,skills};
    }
    const name=args.name!;if(!Object.hasOwn(packagedSkills,name)&&!Object.hasOwn(config.skillVersions,name)&&!(args.action==='disable'&&config.skills.includes(name)))throw Error('SKILL_NOT_PUBLISHED');
    const command=managementCommand({name:'skill',args:`${args.action} ${name}`})!;const result=await this.runtime.commandBus.execute({source:'tool',binding:current,snapshot,signal,authorize:()=>this.current(binding,snapshot,signal,true)},command);return result.kind==='queued'?result.value:result;
  }
}
