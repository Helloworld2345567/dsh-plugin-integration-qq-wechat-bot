import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {AutomationScheduler,chunkText} from '../src/core/automation.js';
import {Store} from '../src/core/store.js';
import {botSchema} from '../src/core/types.js';
import {BUSINESS_TOOLS,permitted} from '../src/core/policy.js';
import {nextDailyTime,isQuiet,localTime} from '../src/core/automation-time.js';

async function fixture(){const home=await mkdtemp(path.resolve('.codex/automation-'));const store=new Store(home);const scope={botId:'bot',platform:'qq',accountId:'account',kind:'private' as const,channelId:'user',senderId:'trusted'};store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true,trustedUsers:['trusted']}));store.accept({id:'source',scope,text:'上次我们聊了旅行。',attachments:[],reply:{target:'user',kind:'private',msgId:'source'},timestamp:Date.now()-3600000});const calls:{prompt:string}[]=[];const scheduler=new AutomationScheduler(store,{runPrompt:async(_binding,prompt)=>{calls.push({prompt});return{turnId:'turn',outputs:[{type:'text',text:'这是一段主动消息。'}]};},flush:async()=>{}});return{home,store,scope,scheduler,calls};}

test('chunkText prefers boundaries and preserves all text',()=>{const input='第一段。\n\n第二段内容。';assert.deepEqual(chunkText(input,8),['第一段。','第二段内容。']);});
test('proactive run uses an isolated run and enqueues ordered output',async t=>{const f=await fixture();t.after(async()=>{f.store.close();await rm(f.home,{recursive:true,force:true});});f.scheduler.configureProactive(f.scope,{enabled:false,cooldownMinutes:0});const run=await f.scheduler.runProactive(f.scope,true);assert.equal(run.state,'succeeded');assert.equal(f.calls.length,1);assert.equal(f.store.deliveries()[0].output.text,'这是一段主动消息。');assert.equal(f.store.list('job-run').length,0);});
test('proactive daily limit blocks after successful run',async t=>{const f=await fixture();t.after(async()=>{f.store.close();await rm(f.home,{recursive:true,force:true});});f.scheduler.configureProactive(f.scope,{enabled:false,cooldownMinutes:0,dailyLimit:1});assert.equal((await f.scheduler.runProactive(f.scope,true)).state,'succeeded');assert.equal((await f.scheduler.runProactive(f.scope,true)).error,'PROACTIVE_DAILY_LIMIT');});

test('trusted chat exposes scheduling and proactive management without host tools',async t=>{
  const f=await fixture();t.after(async()=>{f.scheduler.close();f.store.close();await rm(f.home,{recursive:true,force:true});});
  for(const name of ['bot_schedule','bot_proactive']){
    assert.equal(BUSINESS_TOOLS.has(name),true,`${name} must be available to the chat model`);
    assert.equal(permitted(name,{...f.store.config('sakura'),allowHostTools:false},f.store.bot('bot'),f.scope),true);
  }
});

test('saving proactive preferences preserves enabled state and previous custom settings',async t=>{
  const f=await fixture();t.after(async()=>{f.scheduler.close();f.store.close();await rm(f.home,{recursive:true,force:true});});
  f.scheduler.configureProactive(f.scope,{enabled:true,timezone:'Asia/Tokyo',quietFrom:'23:00',quietTo:'08:00',cooldownMinutes:45});
  const updated=f.scheduler.configureProactive(f.scope,{dailyLimit:2});
  assert.equal(updated.enabled,true,'saving settings must not silently disable daily conversations');
  assert.equal(updated.timezone,'Asia/Tokyo');assert.equal(updated.quietFrom,'23:00');assert.equal(updated.cooldownMinutes,45);
});

test('a task more than a day away waits for its due time and completes only once',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-29T00:00:00Z')});
  const f=await fixture();t.after(async()=>{f.scheduler.close();f.store.close();await rm(f.home,{recursive:true,force:true});});
  f.scheduler.createJob(f.scope,'两天后提醒',{runAt:Date.now()+2*86400000});
  t.mock.timers.tick(86400000);await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(f.calls.length,0,'timer cap must re-arm, not execute early');
  t.mock.timers.tick(86400000);await new Promise<void>(resolve=>setImmediate(resolve));
  assert.equal(f.calls.length,1);assert.equal(f.scheduler.listJobs()[0].enabled,false);
  f.scheduler.start();t.mock.timers.tick(86400000);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(f.calls.length,1);
});

test('quiet hours crossing midnight suppress automatic conversations',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-29T15:30:00Z')});
  const f=await fixture();t.after(async()=>{f.scheduler.close();f.store.close();await rm(f.home,{recursive:true,force:true});});
  f.scheduler.configureProactive(f.scope,{enabled:true,quietFrom:'23:00',quietTo:'08:00',cooldownMinutes:0});
  const result=await f.scheduler.runProactive(f.scope);
  assert.equal(result.error,'PROACTIVE_QUIET_HOURS');assert.equal(f.calls.length,0);
});

test('daily wall times respect Shanghai, Tokyo and daylight saving instead of treating local time as UTC',()=>{
  assert.equal(new Date(nextDailyTime('00:00','Asia/Shanghai',Date.parse('2026-10-29T10:00:00Z'))).toISOString(),'2026-10-29T16:00:00.000Z');
  assert.equal(new Date(nextDailyTime('09:00','Asia/Tokyo',Date.parse('2026-10-29T01:00:00Z'))).toISOString(),'2026-10-30T00:00:00.000Z');
  assert.equal(new Date(nextDailyTime('09:00','America/New_York',Date.parse('2026-03-07T15:00:00Z'))).toISOString(),'2026-03-08T13:00:00.000Z');
});

test('proactive trigger is persisted across restarts, avoids quiet hours and renews on the next day',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-29T16:00:00Z')});t.mock.method(Math,'random',()=>0);
  const f=await fixture();t.after(async()=>{f.scheduler.close();f.store.close();await rm(f.home,{recursive:true,force:true});});
  const config=f.scheduler.configureProactive(f.scope,{enabled:true,dailyLimit:1,cooldownMinutes:0});
  assert.ok(config.nextAt);assert.equal(isQuiet(config.nextAt!,config),false);
  assert.equal(new Date(config.nextAt!).toISOString(),'2026-10-30T01:00:00.000Z');
  f.scheduler.close();f.scheduler.start();assert.equal(f.scheduler.listProactive()[0].nextAt,config.nextAt);
  t.mock.timers.tick(config.nextAt!-Date.now());await f.scheduler.drain();
  assert.equal(f.calls.length,1);assert.equal(f.store.deliveries()[0].reply.msgId,undefined);
  const next=f.scheduler.listProactive()[0].nextAt!;assert.equal(localTime(next,config.timezone).date,'2026-10-31');
  t.mock.timers.tick(next-Date.now());await f.scheduler.drain();assert.equal(f.calls.length,2);
  f.scheduler.setProactive(f.scope,false);t.mock.timers.tick(2*86400000);await f.scheduler.drain();assert.equal(f.calls.length,2);
});

test('busy sessions defer due tasks and deleted in-flight tasks cannot be resurrected',async t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.parse('2026-10-29T00:00:00Z')});
  const f=await fixture();t.after(async()=>{f.scheduler.close();f.store.close();await rm(f.home,{recursive:true,force:true});});
  let busy=true;f.scheduler.services.available=()=>!busy;
  const job=f.scheduler.createJob(f.scope,'稍后提醒',{runAt:Date.now()+1000});
  t.mock.timers.tick(1000);await f.scheduler.drain();assert.equal(f.calls.length,0);
  busy=false;t.mock.timers.tick(60000);await f.scheduler.drain();assert.equal(f.calls.length,1);
  assert.equal(f.scheduler.listJobs().find(j=>j.id===job.id)?.state,'completed');
  let release!:()=>void;f.scheduler.services.runPrompt=async()=>{await new Promise<void>(r=>{release=r;});return{turnId:'late',outputs:[{type:'text',text:'不得发送'}]};};
  const recurring=f.scheduler.createJob(f.scope,'循环提醒',{intervalMs:1000});
  t.mock.timers.tick(1000);f.scheduler.deleteJob(recurring.id);release();await f.scheduler.drain();
  assert.equal(f.scheduler.listJobs().some(j=>j.id===recurring.id),false);assert.equal(f.store.deliveries().length,1);
});

test('invalid settings never overwrite the persisted proactive configuration',async t=>{
  const f=await fixture();t.after(async()=>{f.scheduler.close();f.store.close();await rm(f.home,{recursive:true,force:true});});
  const original=f.scheduler.configureProactive(f.scope,{enabled:true});
  for(const patch of [{timezone:'invalid/zone'},{quietFrom:'25:00'},{cooldownMinutes:-1},{minIntervalMinutes:0},{scopeKey:'another'},{dailyLimit:1.5}])assert.throws(()=>f.scheduler.configureProactive(f.scope,patch));
  assert.deepEqual(f.scheduler.listProactive()[0],original);
  assert.throws(()=>f.scheduler.createJob(f.scope,'旧时间',{runAt:Date.now()-1000}));
});
