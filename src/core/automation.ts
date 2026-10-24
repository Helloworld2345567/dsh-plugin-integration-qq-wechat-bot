import { randomUUID } from 'node:crypto';
import type { HarnessPort } from './runtime-ports.js';
import type { CallerScope, InboundMessage, Output, SessionBinding } from './types.js';
import type { Store } from './store.js';
import { scopeKey } from './store.js';

export type AutomationKind = 'scheduled' | 'proactive';
export type AutomationState = 'active' | 'paused' | 'blocked' | 'failed';

export interface ProactiveConfig {
  id: string; kind: 'proactive'; botId: string; scopeKey: string; scope: CallerScope;
  enabled: boolean; timezone: string; dailyLimit: number; quietFrom: string; quietTo: string;
  minIntervalMinutes: number; cooldownMinutes: number; allowWeb: boolean; maxLength: number;
  failureStopsDay: boolean; createdAt: number; updatedAt: number;
}
export interface ScheduledJob {
  id: string; kind: 'scheduled'; botId: string; scopeKey: string; scope: CallerScope;
  enabled: boolean; timezone: string; prompt: string; runAt?: number; intervalMs?: number;
  nextAt?: number; state: AutomationState; createdAt: number; updatedAt: number;
}
export interface AutomationRun { id:string; automationId:string; kind:AutomationKind; scopeKey:string; scheduledAt:number; startedAt:number; finishedAt?:number; state:'running'|'succeeded'|'failed'|'blocked'|'skipped'; error?:string; turnId?:string }

const MAX_DELAY = 24 * 60 * 60 * 1000;
export function chunkText(text:string,max=1800):string[] {
  const result:string[]=[]; let remaining=text.trim();
  while(remaining.length>max){
    const candidate=remaining.slice(0,max+1); const points=[candidate.lastIndexOf('\n\n'),candidate.lastIndexOf('\n'),candidate.lastIndexOf('。'),candidate.lastIndexOf('！'),candidate.lastIndexOf('？'),candidate.lastIndexOf('. '),candidate.lastIndexOf(' ' )];
    const cut=Math.max(...points.filter(point=>point>=Math.floor(max*.55)));
    const at=cut>0?cut+1:max; result.push(remaining.slice(0,at).trim()); remaining=remaining.slice(at).trim();
  }
  if(remaining)result.push(remaining); return result;
}
function chunkOutputs(outputs:Output[]):Output[] { const result:Output[]=[]; for(const output of outputs){ if(output.type==='text'&&output.text)for(const text of chunkText(output.text))result.push({type:'text',text}); else result.push(output); } return result; }

function validTime(value:string):boolean { return /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function minutes(value:string):number { const [h,m]=value.split(':').map(Number); return h*60+m; }
function localParts(date:Date,timeZone:string):{date:string;minutes:number} {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get=(type:string)=>parts.find(part=>part.type===type)?.value??'00'; return {date:`${get('year')}-${get('month')}-${get('day')}`,minutes:Number(get('hour'))*60+Number(get('minute'))};
}
function nextProactiveTime(config:ProactiveConfig,now=Date.now(),random=Math.random):number {
  const base=new Date(now); const {date}=localParts(base,config.timezone); const seed=Math.floor(random()*14*60);
  const start=9*60+seed, end=24*60-1; const span=end-start; const slot=span/Math.max(1,config.dailyLimit);
  const index=Math.floor(random()*Math.max(1,config.dailyLimit)); const target=Math.min(end,Math.floor(start+slot*index+random()*Math.max(1,slot-1)));
  for(let day=0;day<2;day++){
    const candidate=new Date(base.getTime()+day*86400000); const iso=localParts(candidate,config.timezone).date; if(day===0&&iso!==date)continue;
    const utc=new Date(`${iso}T00:00:00Z`).getTime()+target*60000; if(utc>now)return utc;
  }
  return now+6*60*60*1000;
}

export interface AutomationServices { runPrompt(binding:SessionBinding,prompt:string,kind:AutomationKind,signal:AbortSignal):Promise<{turnId:string;outputs:Output[]}>; flush():Promise<void>; }
export class AutomationScheduler {
  private timers=new Map<string,ReturnType<typeof setTimeout>>(); private closed=false; private running=new Set<string>();
  constructor(readonly store:Store,readonly services:AutomationServices,readonly defaultTimezone='Asia/Shanghai'){}
  start():void { this.closed=false; for(const item of this.store.list<ProactiveConfig>('proactive-config'))if(item.enabled)this.scheduleProactive(item); for(const item of this.store.list<ScheduledJob>('scheduled-job'))if(item.enabled)this.scheduleJob(item); }
  close():void { this.closed=true; for(const timer of this.timers.values())clearTimeout(timer); this.timers.clear(); }
  listProactive():ProactiveConfig[]{return this.store.list('proactive-config');}
  listJobs():ScheduledJob[]{return this.store.list('scheduled-job');}
  createJob(scope:CallerScope,prompt:string,options:{runAt?:number;intervalMs?:number;timezone?:string}={}):ScheduledJob { if(!prompt.trim()||prompt.length>12000)throw Error('SCHEDULE_PROMPT_INVALID'); const now=Date.now(); const job:ScheduledJob={id:randomUUID(),kind:'scheduled',botId:scope.botId,scopeKey:scopeKey(scope),scope,enabled:true,timezone:options.timezone??this.defaultTimezone,prompt:prompt.trim(),runAt:options.runAt,intervalMs:options.intervalMs,nextAt:options.runAt??(options.intervalMs?now+options.intervalMs:undefined),state:'active',createdAt:now,updatedAt:now}; if(!job.nextAt)throw Error('SCHEDULE_TIME_REQUIRED'); this.store.put('scheduled-job',job.id,job);this.scheduleJob(job);return job; }
  setJob(id:string,enabled:boolean):ScheduledJob { const job=this.store.get<ScheduledJob>('scheduled-job',id);if(!job)throw Error('SCHEDULE_NOT_FOUND');const next:ScheduledJob={...job,enabled,state:enabled?'active':'paused',updatedAt:Date.now()};this.store.put('scheduled-job',id,next);if(enabled)this.scheduleJob(next);else{const timer=this.timers.get(`job:${id}`);if(timer)clearTimeout(timer);this.timers.delete(`job:${id}`);}return next; }
  deleteJob(id:string):void {const timer=this.timers.get(`job:${id}`);if(timer)clearTimeout(timer);this.timers.delete(`job:${id}`);this.store.db.prepare("DELETE FROM records WHERE kind='scheduled-job' AND id=?").run(id);}
  configureProactive(scope:CallerScope,patch:Partial<ProactiveConfig>):ProactiveConfig {
    const key=scopeKey(scope), previous=this.store.get<ProactiveConfig>('proactive-config',key); const now=Date.now();
    const next:ProactiveConfig={...(previous??{}),id:key,kind:'proactive',botId:scope.botId,scopeKey:key,scope,enabled:false,timezone:this.defaultTimezone,dailyLimit:3,quietFrom:'00:00',quietTo:'09:00',minIntervalMinutes:180,cooldownMinutes:30,allowWeb:false,maxLength:1200,failureStopsDay:false,createdAt:previous?.createdAt??now,updatedAt:now,...patch} as ProactiveConfig;
    if(!validTime(next.quietFrom)||!validTime(next.quietTo)||next.dailyLimit<1||next.dailyLimit>10)throw Error('PROACTIVE_CONFIG_INVALID'); this.store.put('proactive-config',key,next); if(next.enabled)this.scheduleProactive(next); return next;
  }
  setProactive(scope:CallerScope,enabled:boolean):ProactiveConfig { return this.configureProactive(scope,{enabled}); }
  async runProactive(scope:CallerScope,force=false):Promise<AutomationRun>{const config=this.store.get<ProactiveConfig>('proactive-config',scopeKey(scope));if(!config)throw Error('PROACTIVE_NOT_CONFIGURED');return this.executeProactive(config,force);}
  private scheduleProactive(config:ProactiveConfig):void { const key=`proactive:${config.id}`; const old=this.timers.get(key);if(old)clearTimeout(old);const delay=Math.max(0,nextProactiveTime(config)-Date.now());this.timers.set(key,setTimeout(()=>{this.timers.delete(key);void this.executeProactive(config).finally(()=>{if(config.enabled&&!this.closed)this.scheduleProactive(config);});},Math.min(delay,MAX_DELAY))); }
  private scheduleJob(job:ScheduledJob):void {if(!job.nextAt)return;const key=`job:${job.id}`,old=this.timers.get(key);if(old)clearTimeout(old);this.timers.set(key,setTimeout(()=>{this.timers.delete(key);void this.runJob(job).finally(()=>{if(job.enabled&&!this.closed){const next={...job,nextAt:job.intervalMs?Date.now()+job.intervalMs:undefined,updatedAt:Date.now()};this.store.put('scheduled-job',job.id,next);this.scheduleJob(next);}});},Math.min(Math.max(0,job.nextAt-Date.now()),MAX_DELAY)));}
  private latest(scope:string):InboundMessage|undefined {return this.store.allMessages().filter(message=>scopeKey(message.scope)===scope).at(-1);}
  private async executeProactive(config:ProactiveConfig,_force=false):Promise<AutomationRun>{const run:AutomationRun={id:randomUUID(),automationId:config.id,kind:'proactive',scopeKey:config.scopeKey,scheduledAt:Date.now(),startedAt:Date.now(),state:'running'};this.store.put('proactive-run',run.id,run);if(this.running.has(config.id))return this.finish(run,'skipped','PROACTIVE_ALREADY_RUNNING');const bot=this.store.bot(config.botId);if(!bot.enabled||bot.archived)return this.finish(run,'blocked','BOT_UNAVAILABLE');const latest=this.latest(config.scopeKey);if(!latest)return this.finish(run,'blocked','PROACTIVE_CONTEXT_MISSING');if(config.scope.platform==='weixin'&&!latest.replyEnvelope?.payload?.contextToken&&!latest.reply.contextToken)return this.finish(run,'blocked','WEIXIN_CONTEXT_TOKEN_MISSING');const now=localParts(new Date(),config.timezone);if(now.minutes<minutes(config.quietTo)&&now.minutes>=minutes(config.quietFrom))return this.finish(run,'skipped','PROACTIVE_QUIET_HOURS');const today=this.store.list<AutomationRun>('proactive-run').filter(item=>item.automationId===config.id&&item.state==='succeeded'&&localParts(new Date(item.startedAt),config.timezone).date===now.date);if(today.length>=config.dailyLimit)return this.finish(run,'skipped','PROACTIVE_DAILY_LIMIT');if(Date.now()-latest.timestamp<config.cooldownMinutes*60000)return this.finish(run,'skipped','PROACTIVE_USER_ACTIVE');const last=today.at(-1);if(last&&Date.now()-last.startedAt<config.minIntervalMinutes*60000)return this.finish(run,'skipped','PROACTIVE_MIN_INTERVAL');this.running.add(config.id);const binding=this.store.binding(config.scope);const prompt=`你是当前会话中的角色。现在是 ${now.date}，请根据已有对话自然开启一个新话题，或进行简短关心问候。不要声称未验证的现实经历，不要重复最近主动消息。只输出一条适合继续聊天的中文消息，长度不超过 ${config.maxLength} 字。`;const signal=new AbortController().signal;try{const result=await this.services.runPrompt(binding,prompt,'proactive',signal);const outputs=chunkOutputs(result.outputs);this.store.enqueue(binding,latest.id,`proactive:${run.id}`,outputs,latest.reply,latest.replyEnvelope);run.turnId=result.turnId;const done=this.finish(run,'succeeded');await this.services.flush();return done;}catch(error){return this.finish(run,'failed',error instanceof Error?error.message:'PROACTIVE_FAILED');}finally{this.running.delete(config.id);}}
  async runJob(job:ScheduledJob):Promise<AutomationRun>{const run:AutomationRun={id:randomUUID(),automationId:job.id,kind:'scheduled',scopeKey:job.scopeKey,scheduledAt:job.nextAt??Date.now(),startedAt:Date.now(),state:'running'};this.store.put('job-run',run.id,run);const latest=this.latest(job.scopeKey);if(!latest)return this.finish(run,'blocked','SCHEDULE_CONTEXT_MISSING');try{const result=await this.services.runPrompt(this.store.binding(job.scope),job.prompt,'scheduled',new AbortController().signal);this.store.enqueue(this.store.binding(job.scope),latest.id,`scheduled:${run.id}`,chunkOutputs(result.outputs),latest.reply,latest.replyEnvelope);run.turnId=result.turnId;const done=this.finish(run,'succeeded');await this.services.flush();return done;}catch(error){return this.finish(run,'failed',error instanceof Error?error.message:'SCHEDULED_FAILED');}}
  private finish(run:AutomationRun,state:AutomationRun['state'],error?:string):AutomationRun{const next={...run,state,finishedAt:Date.now(),...(error?{error}:{})};this.store.put(run.kind==='proactive'?'proactive-run':'job-run',run.id,next);return next;}
}
