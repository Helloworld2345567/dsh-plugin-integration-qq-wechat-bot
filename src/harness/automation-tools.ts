import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botScheduleArgumentsSchema,botProactiveArgumentsSchema,type BotScheduleArguments,type BotProactiveArguments} from '../core/automation-contract.js';

export function defineBotScheduleTool(execute:(args:BotScheduleArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_schedule',
    description:"List or manage scheduled tasks for the current trusted private session. create requires prompt and a time or interval; pause/resume/delete require a jobId.",
    parameters:{action:{type:'string',required:true,enum:['list','create','pause','resume','delete']},jobId:{type:'string'},prompt:{type:'string'},delayMs:{type:'number'},runAt:{type:'string'},intervalMs:{type:'number'},dailyAt:{type:'string'},timezone:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>JSON.stringify(await execute(botScheduleArgumentsSchema.parse(args),exec)),
  });
}
export function defineBotProactiveTool(execute:(args:BotProactiveArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_proactive',
    description:"Read or change proactive conversations for the current trusted private session. action is status, on, off or set; set accepts proactive settings fields.",
    parameters:{action:{type:'string',required:true,enum:['status','on','off','set']},timezone:{type:'string'},dailyLimit:{type:'number'},quietFrom:{type:'string'},quietTo:{type:'string'},minIntervalMinutes:{type:'number'},cooldownMinutes:{type:'number'},allowWeb:{type:'boolean'},maxLength:{type:'number'},failureStopsDay:{type:'boolean'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},isConcurrencySafe:args=>args.action==='status',
    execute:async(args,exec)=>JSON.stringify(await execute(botProactiveArgumentsSchema.parse(args),exec)),
  });
}
