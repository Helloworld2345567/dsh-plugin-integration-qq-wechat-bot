import {systemDescriptor,systemMessage,type SystemMessageKey} from '../i18n/system.js';
import {z} from 'zod';
import {validClock,validTimezone} from './automation-time.js';

const clock=z.string().refine(validClock,{message:'时间格式必须为 HH:mm',params:{message:systemDescriptor('clockInvalid')}});
export const timezoneSchema=z.string().min(1).refine(validTimezone,{message:'无效时区',params:{message:systemDescriptor('zoneInvalid')}});
export const proactivePatchSchema=z.object({
  enabled:z.boolean().optional(),timezone:timezoneSchema.optional(),dailyLimit:z.number().int().min(1).max(10).optional(),
  quietFrom:clock.optional(),quietTo:clock.optional(),minIntervalMinutes:z.number().int().min(1).max(1440).optional(),
  cooldownMinutes:z.number().int().min(0).max(1440).optional(),allowWeb:z.boolean().optional(),maxLength:z.number().int().min(1).max(12000).optional(),failureStopsDay:z.boolean().optional(),
}).strict();
export const scheduleOptionsSchema=z.object({runAt:z.number().int().positive().max(8640000000000000).optional(),intervalMs:z.number().int().min(1000).max(Number.MAX_SAFE_INTEGER).optional(),dailyAt:clock.optional(),timezone:timezoneSchema.optional()}).strict().superRefine((value,ctx)=>{
  if(value.dailyAt&&(value.runAt!==undefined||value.intervalMs!==undefined))ctx.addIssue({code:'custom',message:'dailyAt 不可与 runAt/intervalMs 同时使用',params:{message:systemDescriptor('dailyAtConflict')}});
});
export const botScheduleArgumentsSchema=z.object({
  action:z.enum(['list','create','pause','resume','delete']),jobId:z.string().min(1).max(128).optional(),prompt:z.string().trim().min(1).max(12000).optional(),
  delayMs:z.number().int().min(1000).max(Number.MAX_SAFE_INTEGER).optional(),runAt:z.string().datetime({offset:true}).optional(),intervalMs:z.number().int().min(1000).max(Number.MAX_SAFE_INTEGER).optional(),dailyAt:clock.optional(),timezone:timezoneSchema.optional(),
}).strict().superRefine((v,ctx)=>{
  const fail=(key:SystemMessageKey)=>ctx.addIssue({code:'custom',message:systemMessage('zh',key),params:{message:systemDescriptor(key)}});
  if(v.action==='create'){
    if(!v.prompt)fail('schedulePromptRequired');
    if(v.jobId)fail('scheduleCreateIdInvalid');
    if([v.delayMs,v.runAt,v.dailyAt].filter(x=>x!==undefined).length>1||v.dailyAt&&v.intervalMs!==undefined)fail('scheduleTimeConflict');
    if([v.delayMs,v.runAt,v.dailyAt,v.intervalMs].every(x=>x===undefined))fail('scheduleTimeRequired');
  }else{
    if(v.action!=='list'&&!v.jobId)fail('scheduleListIdRequired');
    if(v.action==='list'&&v.jobId)fail('scheduleListIdInvalid');
    if([v.prompt,v.delayMs,v.runAt,v.intervalMs,v.dailyAt,v.timezone].some(x=>x!==undefined))fail('scheduleCreateOnly');
  }
});
export const botProactiveArgumentsSchema=proactivePatchSchema.omit({enabled:true}).extend({action:z.enum(['status','on','off','set'])}).strict().superRefine((v,ctx)=>{
  if(v.action!=='set'&&Object.keys(v).length>1)ctx.addIssue({code:'custom',message:'设置参数只用于 set',params:{message:systemDescriptor('proactiveSetOnly')}});
});
export type BotScheduleArguments=z.infer<typeof botScheduleArgumentsSchema>;
export type BotProactiveArguments=z.infer<typeof botProactiveArgumentsSchema>;
