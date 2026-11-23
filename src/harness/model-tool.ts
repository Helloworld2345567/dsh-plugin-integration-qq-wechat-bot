import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botModelArgumentsSchema,type BotModelArguments,type BotModelResult} from '../core/features.js';

/** The closure supplies the real agent binding; model arguments cannot select a caller or session. */
export function defineBotModelTool(execute:(args:BotModelArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_model',
    description:"List chat models for this trusted private chat. set a listed provider and model, or reset to the bot default. The next model request in this turn uses the selection, which persists for this session.",
    parameters:{action:{type:'string',required:true,enum:['list','set','reset']},provider:{type:'string'},model:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>{const {sessionId,personaId,...result}=await execute(botModelArgumentsSchema.parse(args),exec) as BotModelResult;return JSON.stringify(result);},
  });
}
