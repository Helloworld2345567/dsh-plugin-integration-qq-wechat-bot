import {z} from 'zod';
import {validClock,validTimezone} from './automation-time.js';

const clock=z.string().refine(validClock,'时间格式必须为 HH:mm');
export const timezoneSchema=z.string().min(1).refine(validTimezone,'无效时区');
export const proactivePatchSchema=z.object({
  enabled:z.boolean().optional(),timezone:timezoneSchema.optional(),dailyLimit:z.number().int().min(1).max(10).optional(),
  quietFrom:clock.optional(),quietTo:clock.optional(),minIntervalMinutes:z.number().int().min(1).max(1440).optional(),
  cooldownMinutes:z.number().int().min(0).max(1440).optional(),allowWeb:z.boolean().optional(),maxLength:z.number().int().min(1).max(12000).optional(),failureStopsDay:z.boolean().optional(),
}).strict();
export const scheduleOptionsSchema=z.object({runAt:z.number().int().positive().max(8640000000000000).optional(),intervalMs:z.number().int().min(1000).max(Number.MAX_SAFE_INTEGER).optional(),dailyAt:clock.optional(),timezone:timezoneSchema.optional()}).strict().superRefine((value,ctx)=>{
  if(value.dailyAt&&(value.runAt!==undefined||value.intervalMs!==undefined))ctx.addIssue({code:'custom',message:'dailyAt 不可与 runAt/intervalMs 同时使用'});
});
export const botScheduleArgumentsSchema=z.object({
  action:z.enum(['list','create','pause','resume','delete']),jobId:z.string().min(1).max(128).optional(),prompt:z.string().trim().min(1).max(12000).optional(),
  delayMs:z.number().int().min(1000).max(Number.MAX_SAFE_INTEGER).optional(),runAt:z.string().datetime({offset:true}).optional(),intervalMs:z.number().int().min(1000).max(Number.MAX_SAFE_INTEGER).optional(),dailyAt:clock.optional(),timezone:timezoneSchema.optional(),
}).strict().superRefine((v,ctx)=>{
  const fail=(message:string)=>ctx.addIssue({code:'custom',message});
  if(v.action==='create'){
    if(!v.prompt)fail('创建任务需要 prompt');
    if(v.jobId)fail('创建任务不接受 jobId');
    if([v.delayMs,v.runAt,v.dailyAt].filter(x=>x!==undefined).length>1||v.dailyAt&&v.intervalMs!==undefined)fail('时间参数相互冲突');
    if([v.delayMs,v.runAt,v.dailyAt,v.intervalMs].every(x=>x===undefined))fail('必须指定执行时间');
  }else{
    if(v.action!=='list'&&!v.jobId)fail('需要 list 返回的 jobId');
    if(v.action==='list'&&v.jobId)fail('list 不接受 jobId');
    if([v.prompt,v.delayMs,v.runAt,v.intervalMs,v.dailyAt,v.timezone].some(x=>x!==undefined))fail('时间与提示词只用于 create');
  }
});
export const botProactiveArgumentsSchema=proactivePatchSchema.omit({enabled:true}).extend({action:z.enum(['status','on','off','set'])}).strict().superRefine((v,ctx)=>{
  if(v.action!=='set'&&Object.keys(v).length>1)ctx.addIssue({code:'custom',message:'设置参数只用于 set'});
});
export type BotScheduleArguments=z.infer<typeof botScheduleArgumentsSchema>;
export type BotProactiveArguments=z.infer<typeof botProactiveArgumentsSchema>;
