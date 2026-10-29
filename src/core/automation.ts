import { randomUUID } from 'node:crypto';
import type { CallerScope, InboundMessage, Output, SessionBinding } from './types.js';
import type { Store } from './store.js';
import { scopeKey } from './store.js';
import {trusted} from './policy.js';
import {proactivePatchSchema,scheduleOptionsSchema} from './automation-contract.js';
import {localTime,isQuiet,nextDailyTime} from './automation-time.js';

export type AutomationKind = 'scheduled' | 'proactive';
export type AutomationState = 'active' | 'paused' | 'blocked' | 'failed' | 'completed';

export interface ProactiveConfig {
  id: string; kind: 'proactive'; botId: string; scopeKey: string; scope: CallerScope;
  enabled: boolean; timezone: string; dailyLimit: number; quietFrom: string; quietTo: string;
  minIntervalMinutes: number; cooldownMinutes: number; allowWeb: boolean; maxLength: number;
  failureStopsDay: boolean; nextAt?:number; createdAt: number; updatedAt: number;
}
export interface ScheduledJob {
  id: string; kind: 'scheduled'; botId: string; scopeKey: string; scope: CallerScope;
  enabled: boolean; timezone: string; prompt: string; runAt?: number; intervalMs?: number; dailyAt?:string;
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

export interface AutomationServices {
  runPrompt(binding:SessionBinding,prompt:string,kind:AutomationKind,signal:AbortSignal):Promise<{turnId:string;outputs:Output[]}>;
  flush():Promise<void>;
  available?(scopeKey:string):boolean;
}
export class AutomationScheduler {
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private closed=false;
  private running=new Set<string>();
  private callbacks=new Set<Promise<void>>();
  constructor(readonly store:Store,readonly services:AutomationServices,readonly defaultTimezone='Asia/Shanghai'){}
  start():void {
    this.closed=false;
    for(const item of this.listProactive())if(item.enabled)this.scheduleProactive(item);
    for(const item of this.listJobs())if(item.enabled)this.scheduleJob(item);
  }
  close():void {this.closed=true;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();}
  async drain():Promise<void>{await Promise.all([...this.callbacks]);}
  listProactive():ProactiveConfig[]{return this.store.list('proactive-config');}
  listJobs():ScheduledJob[]{return this.store.list('scheduled-job');}
  private clear(key:string):void {const old=this.timers.get(key);if(old)clearTimeout(old);this.timers.delete(key);}
  private arm(key:string,at:number,callback:()=>Promise<void>):void {
    this.clear(key);if(this.closed)return;
    this.timers.set(key,setTimeout(()=>{
      this.timers.delete(key);
      // The cap is a wake-up to check the deadline, not permission to run early.
      if(at>Date.now()){this.arm(key,at,callback);return;}
      const work=callback().catch(error=>this.store.saveFailure(`automation:${key}`,{code:error instanceof Error?error.message:'AUTOMATION_FAILED',at:Date.now()})).finally(()=>this.callbacks.delete(work));
      this.callbacks.add(work);
    },Math.min(Math.max(0,at-Date.now()),MAX_DELAY)));
  }
  createJob(scope:CallerScope,prompt:string,options:{runAt?:number;intervalMs?:number;dailyAt?:string;timezone?:string}={}):ScheduledJob {
    if(!prompt.trim()||prompt.length>12000)throw Error('SCHEDULE_PROMPT_INVALID');
    const parsed=scheduleOptionsSchema.parse(options),now=Date.now(),timezone=parsed.timezone??this.defaultTimezone;
    const nextAt=parsed.dailyAt?nextDailyTime(parsed.dailyAt,timezone,now):parsed.runAt??(parsed.intervalMs?now+parsed.intervalMs:undefined);
    if(!nextAt||!Number.isSafeInteger(nextAt)||nextAt>8640000000000000||nextAt<=now)throw Error('SCHEDULE_TIME_INVALID');
    const job:ScheduledJob={...parsed,id:randomUUID(),kind:'scheduled',botId:scope.botId,scopeKey:scopeKey(scope),scope,enabled:true,timezone,prompt:prompt.trim(),nextAt,state:'active',createdAt:now,updatedAt:now};
    this.store.put('scheduled-job',job.id,job);this.scheduleJob(job);return job;
  }
  setJob(id:string,enabled:boolean):ScheduledJob {
    const job=this.store.get<ScheduledJob>('scheduled-job',id);if(!job)throw Error('SCHEDULE_NOT_FOUND');
    if(enabled&&!job.nextAt&&!job.intervalMs&&!job.dailyAt)throw Error('SCHEDULE_COMPLETED');
    const nextAt=enabled&&job.dailyAt?nextDailyTime(job.dailyAt,job.timezone):job.nextAt??(job.intervalMs?Date.now()+job.intervalMs:undefined);
    const next:ScheduledJob={...job,nextAt,enabled,state:enabled?'active':'paused',updatedAt:Date.now()};
    this.store.put('scheduled-job',id,next);this.clear(`job:${id}`);if(enabled)this.scheduleJob(next);return next;
  }
  deleteJob(id:string):void {this.clear(`job:${id}`);this.clear(`manual:scheduled:${id}`);this.store.db.prepare("DELETE FROM records WHERE kind='scheduled-job' AND id=?").run(id);}
  queueJob(job:ScheduledJob):void {this.queueManual(job);}
  queueProactive(scope:CallerScope):void {
    const config=this.store.get<ProactiveConfig>('proactive-config',scopeKey(scope));if(!config)throw Error('PROACTIVE_NOT_CONFIGURED');this.queueManual(config);
  }
  private queueManual(item:ScheduledJob|ProactiveConfig):void {
    const key=`manual:${item.kind}:${item.id}`;
    const run=async()=>{
      const latest=this.store.get<ScheduledJob|ProactiveConfig>(item.kind==='scheduled'?'scheduled-job':'proactive-config',item.id);if(!latest)return;
      if(this.services.available?.(item.scopeKey)===false||this.running.has(item.id)){this.arm(key,Date.now()+1000,run);return;}
      if(latest.kind==='scheduled')await this.runJob(latest);else await this.executeProactive(latest,true);
    };
    this.arm(key,Date.now()+1,run);
  }
  configureProactive(scope:CallerScope,patch:Partial<ProactiveConfig>):ProactiveConfig {
    const settings=proactivePatchSchema.parse(patch),key=scopeKey(scope),previous=this.store.get<ProactiveConfig>('proactive-config',key),now=Date.now();
    const next:ProactiveConfig={enabled:false,timezone:this.defaultTimezone,dailyLimit:3,quietFrom:'00:00',quietTo:'09:00',minIntervalMinutes:180,cooldownMinutes:30,allowWeb:false,maxLength:1200,failureStopsDay:false,...previous,...settings,id:key,kind:'proactive',botId:scope.botId,scopeKey:key,scope,createdAt:previous?.createdAt??now,updatedAt:now,nextAt:undefined};
    this.clear(`proactive:${key}`);if(!next.enabled)this.clear(`manual:proactive:${key}`);this.store.put('proactive-config',key,next);if(next.enabled)this.scheduleProactive(next);return this.store.get<ProactiveConfig>('proactive-config',key)!;
  }
  setProactive(scope:CallerScope,enabled:boolean):ProactiveConfig{return this.configureProactive(scope,{enabled});}
  async runProactive(scope:CallerScope,force=false):Promise<AutomationRun>{
    const config=this.store.get<ProactiveConfig>('proactive-config',scopeKey(scope));if(!config)throw Error('PROACTIVE_NOT_CONFIGURED');
    return this.executeProactive(config,force);
  }
  private today(config:ProactiveConfig,at=Date.now()):AutomationRun[]{
    const date=localTime(at,config.timezone).date;
    return this.store.list<AutomationRun>('proactive-run').filter(run=>run.automationId===config.id&&localTime(run.startedAt,config.timezone).date===date);
  }
  private nextProactive(config:ProactiveConfig):number {
    const now=Date.now(),today=this.today(config,now),success=today.filter(r=>r.state==='succeeded'),date=localTime(now,config.timezone).date;
    const done=success.length>=config.dailyLimit||config.failureStopsDay&&today.some(r=>r.state==='failed');
    const latest=this.latest(config.scopeKey),last=success.at(-1);
    const earliest=Math.max(now+60000,(latest?.timestamp??0)+config.cooldownMinutes*60000,(last?.startedAt??0)+config.minIntervalMinutes*60000);
    // Spread eligible conversations within the next hour; never randomize into quiet hours.
    let at=Math.ceil(earliest/60000)*60000;
    for(;at<earliest+3*86400000;at+=60000)if(!isQuiet(at,config)&&(!done||localTime(at,config.timezone).date!==date))break;
    const spread=Math.floor(Math.random()*60)*60000,target=at+spread;
    return !isQuiet(target,config)&&localTime(target,config.timezone).date===localTime(at,config.timezone).date?target:at;
  }
  private scheduleProactive(config:ProactiveConfig,retryAt?:number):void {
    if(!config.enabled||this.closed)return;
    const next={...config,nextAt:retryAt??config.nextAt??this.nextProactive(config)};
    this.store.put('proactive-config',next.id,next);
    this.arm(`proactive:${next.id}`,next.nextAt!,async()=>{
      const current=this.store.get<ProactiveConfig>('proactive-config',next.id);if(!current?.enabled)return;
      if(this.running.has(current.id)||this.services.available?.(current.scopeKey)===false){this.scheduleProactive(current,Date.now()+60000);return;}
      await this.executeProactive(current);
      const latest=this.store.get<ProactiveConfig>('proactive-config',next.id);
      if(latest?.enabled&&!this.closed)this.scheduleProactive({...latest,nextAt:undefined});
    });
  }
  private scheduleJob(job:ScheduledJob,retryAt?:number):void {
    if(!job.enabled||job.nextAt===undefined||this.closed)return;
    this.arm(`job:${job.id}`,retryAt??job.nextAt,async()=>{
      const current=this.store.get<ScheduledJob>('scheduled-job',job.id);if(!current?.enabled)return;
      if(this.running.has(current.id)||this.services.available?.(current.scopeKey)===false){this.scheduleJob(current,Date.now()+60000);return;}
      const run=await this.runJob(current);
      const latest=this.store.get<ScheduledJob>('scheduled-job',job.id);
      if(!latest?.enabled)return;
      if(run.error==='AUTOMATION_BUSY'){this.scheduleJob(latest,Date.now()+60000);return;}
      const nextAt=latest.dailyAt?nextDailyTime(latest.dailyAt,latest.timezone):latest.intervalMs?Date.now()+latest.intervalMs:undefined;
      const next:ScheduledJob={...latest,nextAt,enabled:nextAt!==undefined,state:nextAt!==undefined?'active':run.state==='succeeded'?'completed':run.state==='blocked'?'blocked':'failed',updatedAt:Date.now()};
      this.store.put('scheduled-job',next.id,next);this.scheduleJob(next);
    });
  }
  private latest(scope:string):InboundMessage|undefined{return this.store.allMessages().filter(message=>scopeKey(message.scope)===scope).at(-1);}
  private unavailable(scope:CallerScope):string|undefined {
    const bot=this.store.bot(scope.botId);
    if(!bot.enabled||bot.archived)return 'BOT_UNAVAILABLE';
    if(!trusted(bot,scope))return 'TRUSTED_PRIVATE_REQUIRED';
    if(this.services.available?.(scopeKey(scope))===false)return 'AUTOMATION_BUSY';
  }
  private newRun(item:ScheduledJob|ProactiveConfig):AutomationRun {
    const run:AutomationRun={id:randomUUID(),automationId:item.id,kind:item.kind,scopeKey:item.scopeKey,scheduledAt:item.nextAt??Date.now(),startedAt:Date.now(),state:'running'};
    this.store.put(item.kind==='proactive'?'proactive-run':'job-run',run.id,run);return run;
  }
  private async executeProactive(config:ProactiveConfig,force=false):Promise<AutomationRun>{
    const run=this.newRun(config),unavailable=this.unavailable(config.scope);
    if(unavailable)return this.finish(run,'blocked',unavailable);
    if(this.running.has(config.id))return this.finish(run,'skipped','PROACTIVE_ALREADY_RUNNING');
    if(!force&&!config.enabled)return this.finish(run,'skipped','PROACTIVE_DISABLED');
    const latest=this.latest(config.scopeKey);if(!latest)return this.finish(run,'blocked','PROACTIVE_CONTEXT_MISSING');
    if(!force&&isQuiet(Date.now(),config))return this.finish(run,'skipped','PROACTIVE_QUIET_HOURS');
    const today=this.today(config),success=today.filter(item=>item.state==='succeeded');
    if(success.length>=config.dailyLimit)return this.finish(run,'skipped','PROACTIVE_DAILY_LIMIT');
    if(!force&&config.failureStopsDay&&today.some(r=>r.state==='failed'))return this.finish(run,'skipped','PROACTIVE_FAILURE_STOPS_DAY');
    if(!force&&Date.now()-latest.timestamp<config.cooldownMinutes*60000)return this.finish(run,'skipped','PROACTIVE_USER_ACTIVE');
    const last=success.at(-1);if(!force&&last&&Date.now()-last.startedAt<config.minIntervalMinutes*60000)return this.finish(run,'skipped','PROACTIVE_MIN_INTERVAL');
    const now=localTime(Date.now(),config.timezone);
    const prompt=`你是当前会话中的角色。现在是 ${now.date}（${config.timezone}），请根据已有对话自然开启一个新话题，或进行简短关心问候。不要声称未验证的现实经历，不要重复最近主动消息。只输出一条适合继续聊天的中文消息，长度不超过 ${config.maxLength} 字。`;
    return this.execute(config,run,prompt,latest);
  }
  async runJob(job:ScheduledJob):Promise<AutomationRun>{
    const run=this.newRun(job),unavailable=this.unavailable(job.scope);
    if(unavailable)return this.finish(run,'blocked',unavailable);
    if(this.running.has(job.id))return this.finish(run,'skipped','SCHEDULE_ALREADY_RUNNING');
    const latest=this.latest(job.scopeKey);if(!latest)return this.finish(run,'blocked','SCHEDULE_CONTEXT_MISSING');
    return this.execute(job,run,job.prompt,latest);
  }
  private async execute(item:ScheduledJob|ProactiveConfig,run:AutomationRun,prompt:string,latest:InboundMessage):Promise<AutomationRun>{
    if(item.scope.platform==='weixin'&&!latest.replyEnvelope?.payload?.contextToken&&!latest.reply.contextToken)return this.finish(run,'blocked','WEIXIN_CONTEXT_TOKEN_MISSING');
    const binding=this.store.binding(item.scope);this.running.add(item.id);
    try{
      const result=await this.services.runPrompt(binding,prompt,item.kind,new AbortController().signal);
      const bot=this.store.bot(item.botId),current=this.store.findBinding(binding.key);
      if(!bot.enabled||bot.archived||!trusted(bot,item.scope)||current?.sessionId!==binding.sessionId||current.generation!==binding.generation)throw Error('AUTOMATION_CONTEXT_CHANGED');
      const active=this.store.get<ScheduledJob|ProactiveConfig>(item.kind==='proactive'?'proactive-config':'scheduled-job',item.id);
      if(!active||item.enabled&&!active.enabled)throw Error('AUTOMATION_DISABLED');
      const reply={...(latest.replyEnvelope?.payload??latest.reply)};
      // Background QQ messages are active sends, not replies to an expired inbound message.
      if(item.scope.platform==='qq')delete reply.msgId;
      const envelope=latest.replyEnvelope?{...latest.replyEnvelope,payload:reply}:undefined;
      const outputs=chunkOutputs(result.outputs);if(!outputs.length)throw Error('AUTOMATION_EMPTY_OUTPUT');
      this.store.enqueue(binding,`automation:${run.id}`,`${item.kind}:${run.id}`,outputs,reply,envelope);
      run.turnId=result.turnId;await this.services.flush();return this.finish(run,'succeeded');
    }catch(error){return this.finish(run,'failed',error instanceof Error?error.message:'AUTOMATION_FAILED');}
    finally{this.running.delete(item.id);}
  }
  private finish(run:AutomationRun,state:AutomationRun['state'],error?:string):AutomationRun{
    const next={...run,state,finishedAt:Date.now(),...(error?{error}:{})};this.store.put(run.kind==='proactive'?'proactive-run':'job-run',run.id,next);return next;
  }
}
