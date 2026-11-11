import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botScheduleArgumentsSchema,botProactiveArgumentsSchema,type BotScheduleArguments,type BotProactiveArguments} from '../core/automation-contract.js';

export function defineBotScheduleTool(execute:(args:BotScheduleArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_schedule',
    description:"Manage persistent scheduled tasks for the current trusted private-chat session without local-tool permissions. list returns current time, time zone and real tasks. create schedules prompt execution and sends the result to this session: delayMs is a delay in milliseconds; runAt is an ISO timestamp with UTC offset; intervalMs is a repeat interval; dailyAt is HH:mm every day in the selected time zone, such as 00:00. Creation succeeds only when a jobId is returned. pause/resume/delete require a jobId from list. Call this tool directly for reminders or scheduled messages; do not claim scheduling is panel-only or unsupported in the background.",
    parameters:{action:{type:'string',required:true,enum:['list','create','pause','resume','delete']},jobId:{type:'string'},prompt:{type:'string'},delayMs:{type:'number'},runAt:{type:'string'},intervalMs:{type:'number'},dailyAt:{type:'string'},timezone:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>JSON.stringify(await execute(botScheduleArgumentsSchema.parse(args),exec)),
  });
}
export function defineBotProactiveTool(execute:(args:BotProactiveArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_proactive',
    description:"Manage daily proactive conversations for the current trusted private-chat session. status reads the real enabled state, next time and settings. on/off toggles it; set changes daily limits, time zone, quiet hours, intervals and other supplied fields while preserving the remaining settings and enabled state. For a fixed daily reminder, use bot_schedule dailyAt. Confirm settings only from actual tool results; do not send the user to the panel unnecessarily.",
    parameters:{action:{type:'string',required:true,enum:['status','on','off','set']},timezone:{type:'string'},dailyLimit:{type:'number'},quietFrom:{type:'string'},quietTo:{type:'string'},minIntervalMinutes:{type:'number'},cooldownMinutes:{type:'number'},allowWeb:{type:'boolean'},maxLength:{type:'number'},failureStopsDay:{type:'boolean'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},isConcurrencySafe:args=>args.action==='status',
    execute:async(args,exec)=>JSON.stringify(await execute(botProactiveArgumentsSchema.parse(args),exec)),
  });
}
