import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botSessionArgumentsSchema,botPersonaArgumentsSchema,botSkillsArgumentsSchema,type BotSessionArguments,type BotPersonaArguments,type BotSkillsArguments} from '../core/management.js';

export function defineBotSessionTool(execute:(args:BotSessionArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_session',
    description:'管理调用者自己的渠道会话。help/status/list 查询帮助、当前状态和所属历史。new/stop/compact/resume 只登记操作，在当前轮结束后执行；queued 不代表已完成。resume 的 sessionId 必须来自当前用户的 list 结果。不得替其他用户或父任务修改会话。',
    parameters:{action:{type:'string',required:true,enum:['help','status','list','new','stop','compact','resume']},page:{type:'number'},sessionId:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>['help','status','list'].includes(args.action),
    execute:async(args,exec)=>JSON.stringify(await execute(botSessionArgumentsSchema.parse(args),exec)),
  });
}

export function defineBotPersonaTool(execute:(args:BotPersonaArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_persona',
    description:'可信私聊查看或切换当前会话人格，无需本机工具权限。先 list 获取准确人格 ID，再 set。切换排队到当前轮结束，保留历史并清除临时模型覆盖；queued 不表示已经切换，本轮与已启动子任务保持冻结配置。不修改共享人格内容。',
    parameters:{action:{type:'string',required:true,enum:['list','set']},personaId:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>JSON.stringify(await execute(botPersonaArgumentsSchema.parse(args),exec)),
  });
}

export function defineBotSkillsTool(execute:(args:BotSkillsArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_skills',
    description:'查看当前人格技能。普通用户只能 list 已启用项；可信私聊可查看已发布但停用的技能，并 enable/disable。启停操作排队到当前轮结束，影响共享该人格的会话；queued 不代表已完成。新增或编辑技能使用 bot_evolve。',
    parameters:{action:{type:'string',required:true,enum:['list','enable','disable']},name:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>JSON.stringify(await execute(botSkillsArgumentsSchema.parse(args),exec)),
  });
}
