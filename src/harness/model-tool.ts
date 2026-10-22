import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botModelArgumentsSchema,type BotModelArguments} from '../core/features.js';

/** The closure supplies the real agent binding; model arguments cannot select a caller or session. */
export function defineBotModelTool(execute:(args:BotModelArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_model',
    description:'管理当前可信私聊会话的模型。用户自然语言要求换模型时先 list 查询准确提供商和模型 ID，再 set；若存在多个符合候选，应让用户明确选择。reset 恢复当前人格默认模型。只修改当前会话，下轮生效；本轮及已启动子任务继续使用冻结模型。',
    parameters:{action:{type:'string',required:true,enum:['list','set','reset']},provider:{type:'string'},model:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>JSON.stringify(await execute(botModelArgumentsSchema.parse(args),exec)),
  });
}
