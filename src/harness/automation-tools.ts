import {defineTool,type ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botScheduleArgumentsSchema,botProactiveArgumentsSchema,type BotScheduleArguments,type BotProactiveArguments} from '../core/automation-contract.js';

export function defineBotScheduleTool(execute:(args:BotScheduleArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_schedule',
    description:'可信私聊管理当前会话的持久定时任务，无需本机工具权限。list 返回当前时间、时区与真实任务。create 创建后到时自动执行 prompt 并向本会话发送结果；delayMs 是延迟毫秒，runAt 是带 UTC 偏移的 ISO 时间，intervalMs 是重复间隔，dailyAt 是指定时区每天 HH:mm（例如每天00:00）。返回 jobId 才算创建成功。pause/resume/delete 必须用 list 返回的 jobId。用户请求提醒或定时消息时直接调用，不能声称只有面板或不支持后台调度。',
    parameters:{action:{type:'string',required:true,enum:['list','create','pause','resume','delete']},jobId:{type:'string'},prompt:{type:'string'},delayMs:{type:'number'},runAt:{type:'string'},intervalMs:{type:'number'},dailyAt:{type:'string'},timezone:{type:'string'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},isConcurrencySafe:args=>args.action==='list',
    execute:async(args,exec)=>JSON.stringify(await execute(botScheduleArgumentsSchema.parse(args),exec)),
  });
}
export function defineBotProactiveTool(execute:(args:BotProactiveArguments,exec:ToolRunContext)=>Promise<unknown>){
  return defineTool({
    name:'bot_proactive',
    description:'可信私聊管理当前会话的每日主动聊天。status 读取真实开启状态、下次时间及设置；on/off 开关；set 修改每日上限、时区、静默时段、间隔等，并保留其他设置与开关。每天固定时刻的提醒使用 bot_schedule 的 dailyAt。只根据工具结果确认设置，不需用户另去面板。',
    parameters:{action:{type:'string',required:true,enum:['status','on','off','set']},timezone:{type:'string'},dailyLimit:{type:'number'},quietFrom:{type:'string'},quietTo:{type:'string'},minIntervalMinutes:{type:'number'},cooldownMinutes:{type:'number'},allowWeb:{type:'boolean'},maxLength:{type:'number'},failureStopsDay:{type:'boolean'}},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},isConcurrencySafe:args=>args.action==='status',
    execute:async(args,exec)=>JSON.stringify(await execute(botProactiveArgumentsSchema.parse(args),exec)),
  });
}
