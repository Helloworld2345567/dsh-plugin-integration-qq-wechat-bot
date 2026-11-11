import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botModelArgumentsSchema,type BotModelArguments,type BotModelResult} from '../core/features.js';

/** The closure supplies the real agent binding; model arguments cannot select a caller or session. */
export function defineBotModelTool(execute:(args:BotModelArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_model',
    description:"Manage the model for the current trusted private-chat session. When the user asks to switch models, first list exact provider and model IDs, then set. If several candidates match, ask the user to choose. reset restores the current persona default. Changes affect only this session from the next turn; this turn and already-started subtasks keep their frozen model.",
    parameters:{action:{type:'string',required:true,enum:['list','set','reset']},provider:{type:'string'},model:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>{const {sessionId,personaId,...result}=await execute(botModelArgumentsSchema.parse(args),exec) as BotModelResult;return JSON.stringify(result);},
  });
}
