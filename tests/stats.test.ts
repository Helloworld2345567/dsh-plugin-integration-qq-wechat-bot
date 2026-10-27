import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Store,scopeKey} from '../src/core/store.js';
import {StatsService,normalizeProviderUsage,statsWindow,shanghaiDay} from '../src/core/stats.js';
import {botSchema,type CallerScope,type ChannelAdapter} from '../src/core/types.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {SqliteStatsData} from '../src/core/sqlite-stats-data.js';

const now=Date.parse('2026-10-22T12:00:00+08:00');
const adapter={} as ChannelAdapter;const channels=createChannelRegistry([{id:'qq',displayName:'QQ',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}},{id:'weixin',displayName:'微信',adapter,capabilities:{conversations:['private'],login:[],groupSupport:'unsupported'}}]);
async function fixture(t:any){const dir=await mkdtemp(path.resolve('.codex/stats-test-'));const store=new Store(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});for(const channel of ['qq','weixin'] as const)store.saveBot(botSchema.parse({id:channel,name:channel,channel,accountId:channel}));const stats=new StatsService(new SqliteStatsData(store),()=>new Map([['qq','connected'],['weixin','connecting']]),()=>store.bots(),()=>now,channels);return{store,stats};}
const usage=(inputTokens:number,outputTokens=5)=>({inputTokens,outputTokens,cacheReadTokens:3,cacheWriteTokens:2,reasoningTokens:2});
test('native replay deduplicates and a retry opens a new metered attempt',async t=>{
  const {stats}=await fixture(t);stats.observeSession('session','qq');
  const events=[
    {seq:0,type:'request/header',data:{header:{config:{provider:'provider',model:'requested'}}}},
    {seq:1,type:'assistant/attempt',data:{turn:0,step:0,stream:[{type:'chunk',chunk:{type:'usage',usage:usage(10)}}]}},
    {seq:2,type:'assistant/message',data:{turn:0,step:0,message:{source:{provider:'actual',model:'actual-model'}},usage:usage(20)}},
    {seq:3,type:'llm/retry-started',data:{turn:0,step:0}},
    {seq:4,type:'assistant/message',data:{turn:0,step:0,message:{source:{provider:'actual',model:'actual-model'}},usage:usage(30)}},
    {seq:5,type:'assistant/attempt',data:{turn:0,step:1,stream:[]}},
  ].map(e=>({...e,time:now-100}));
  for(const e of events)stats.recordNative('session',e);for(const e of events.toReversed())stats.recordNative('session',e);
  stats.migrateLegacy();const result=stats.query();assert.equal(result.summary.calls,3);assert.equal(result.summary.unknownUsageCalls,1);assert.equal(result.summary.inputTokens,50);assert.equal(result.summary.outputTokens,10);assert.equal(result.summary.reasoningTokens,4);assert.equal(result.summary.knownTokens,70);
  assert.equal(result.models.find(m=>m.model==='actual-model')?.calls,2);assert.equal(result.models.find(m=>m.model==='requested')?.unknownUsageCalls,1);
});
test('duplicate native events add one fact and rebuild only once while recovering a missing projection',async t=>{
  const {stats}=await fixture(t);stats.observeSession('counted','qq');let rebuilds=0;const replace=stats.data.projection.replaceUsageCalls.bind(stats.data.projection);stats.data.projection.replaceUsageCalls=(owner,calls)=>{rebuilds++;replace(owner,calls);};
  const event={seq:1,time:now,type:'assistant/message',data:{turn:0,step:0,message:{source:{provider:'p',model:'m'}},usage:usage(2)}};
  for(let i=0;i<10;i++)stats.recordNative('counted',event);assert.equal(rebuilds,1);
  stats.data.projection.replaceUsageCalls('session:counted',[]);stats.recordNative('counted',event);assert.equal(rebuilds,3);
});
test('child, compaction and media attribution retain unknown usage without counting local work',async t=>{
  const {stats,store}=await fixture(t);stats.observeSession('child','qq','parent');
  stats.recordNative('child',{seq:1,time:now-10,type:'assistant/message',data:{turn:0,step:0,message:{source:{provider:'p',model:'child'}},usage:usage(1)}});
  stats.recordNative('child',{seq:2,time:now-10,type:'compaction/summary',data:{compactionId:'c',provider:'p',model:'summary',llmStreamCall:true,usage:usage(2)}});
  stats.recordNative('child',{seq:3,time:now-10,type:'compaction/summary',data:{compactionId:'template',provider:'p',model:'template'}});
  store.put('job','local',{id:'local',botId:'qq',operation:'document_read'});
  store.put('job','image',{id:'image',botId:'qq',modelCalls:[{id:'one',attempted:true,at:now-10,provider:'image',model:'image'},{id:'one',attempted:true,at:now-10,provider:'image',model:'image'}]});
  stats.migrateLegacy();const result=stats.query();assert.equal(result.summary.calls,3);assert.deepEqual(result.models.map(m=>m.kind).sort(),['compaction','media','subagent']);assert.equal(stats.query({kind:'media'}).summary.unknownUsageCalls,1);
  assert.throws(()=>stats.observeSession('child','weixin','parent'),/OWNER_CONFLICT/);
});
test('media attribution skips malformed legacy bindings without crashing or guessing a bot owner',async t=>{
  const {stats,store}=await fixture(t);const valid=store.binding({botId:'qq',platform:'qq',accountId:'qq',kind:'private',channelId:'alice',senderId:'alice'});
  for(const [key,value] of [['partial',{sessionId:'old'}],['missing',null],['guessed',{key:'guessed',scope:{botId:'qq'}}],['bad-hash',{...valid,key:'bad-hash'}]] as const)store.put('binding',key,value);
  for(const scope of [valid.key,'partial','missing','guessed','bad-hash'])store.put('job',scope,{id:scope,scope,modelCalls:[{id:'one',attempted:true,at:now-10,provider:'media',model:'actual',usage:usage(7)}]});
  stats.migrateLegacy();const result=stats.query();assert.equal(result.summary.calls,1);assert.equal(result.models[0].botId,'qq');assert.equal(result.summary.inputTokens,7);
});
test('compaction seam records failed requests and merges successful native summary once',async t=>{
  const {stats}=await fixture(t);stats.observeSession('s','qq');
  stats.recordAuxiliary('s',{id:'failed',at:now-10,provider:'p',model:'summary',kind:'compaction'});
  stats.recordAuxiliary('s',{id:'success',at:now-5,provider:'p',model:'summary',usage:usage(40),kind:'compaction'});
  stats.recordNative('s',{seq:1,time:now-5,type:'compaction/summary',data:{compactionId:'success',provider:'p',model:'summary',llmStreamCall:true,usage:usage(40)}});
  stats.migrateLegacy();const result=stats.query();assert.equal(result.summary.calls,2);assert.equal(result.summary.unknownUsageCalls,1);assert.equal(result.summary.inputTokens,40);
});
test('a media dispatch journal recovers usage after worker or host interruption',async t=>{
  const {stats,store}=await fixture(t);const folder=path.join(store.home,'jobs','interrupted');await mkdir(folder,{recursive:true});
  store.put('job','interrupted',{id:'interrupted',botId:'qq',provider:'native-provider',requestedModel:'configured',state:'running'});
  await writeFile(path.join(folder,'model-usage.json'),JSON.stringify([{id:'call',attempted:true,at:now-1,model:'actual',usage:{prompt_tokens:30,completion_tokens:8}}]));
  stats.migrateLegacy();const result=stats.query();assert.equal(result.summary.calls,1);assert.equal(result.summary.knownTokens,38);assert.equal(result.models[0].provider,'native-provider');assert.equal(result.models[0].model,'actual');
});
test('media raw counters normalize caches once and reasoning remains part of output',()=>{
  assert.deepEqual(normalizeProviderUsage({prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:40},completion_tokens_details:{reasoning_tokens:5}}),{inputTokens:60,outputTokens:20,cacheReadTokens:40,reasoningTokens:5,totalTokens:120});
  assert.equal(normalizeProviderUsage({prompt_tokens:10}),undefined);assert.equal(normalizeProviderUsage({prompt_tokens:10,completion_tokens:1,prompt_cache_hit_tokens:30}),undefined);
});
test('China day boundaries and date custom input do not inherit host timezone',()=>{
  const boundary=Date.parse('2026-10-21T16:00:00Z');assert.equal(shanghaiDay(boundary-1),'2026-10-21');assert.equal(shanghaiDay(boundary),'2026-10-22');
  assert.equal(statsWindow({range:'today'},now).from,boundary);assert.equal(statsWindow({range:'7d'},now).from,boundary-6*86400000);
  assert.deepEqual(statsWindow({range:'custom',from:'2026-10-21',to:'2026-10-22'},now),{preset:'custom',from:boundary-86400000,to:boundary});assert.throws(()=>statsWindow({range:'custom',from:'bad',to:'2026-10-22'},now));
  assert.equal(statsWindow({range:'custom',from:'2026-10-22T00:00',to:'2026-10-22T01:00'},now).from,boundary);
});
test('custom date end is exclusive for both model usage and received messages at Shanghai midnight',async t=>{
  const {stats,store}=await fixture(t);const boundary=Date.parse('2026-10-22T00:00:00+08:00');const scope:CallerScope={botId:'qq',platform:'qq',accountId:'qq',kind:'private',channelId:'alice',senderId:'alice'};
  stats.observeSession('boundary','qq');
  for(const [index,at] of [boundary-1,boundary,boundary+1].entries()){store.accept({id:String(index),scope,text:'boundary',attachments:[],reply:{},timestamp:at});stats.recordNative('boundary',{seq:index,time:at,type:'assistant/message',data:{turn:index,step:0,message:{source:{provider:'p',model:'m'}},usage:usage(1)}});}
  const before=stats.query({range:'custom',from:'2026-10-21',to:'2026-10-22'});assert.equal(before.summary.calls,1);assert.equal(before.summary.received,1);assert.deepEqual(before.trend.map(row=>row.date),['2026-10-21']);
  const after=stats.query({range:'custom',from:'2026-10-22',to:'2026-10-23'});assert.equal(after.summary.calls,2);assert.equal(after.summary.received,2);
});
test('durable messages count accepted delivery pieces and expose unknown legacy sending times',async t=>{
  const {stats,store}=await fixture(t);const scope:CallerScope={botId:'qq',platform:'qq',accountId:'qq',kind:'private',channelId:'alice',senderId:'alice'};
  const input={id:'m',scope,text:'hello',attachments:[],reply:{},timestamp:now-100};assert.equal(store.accept(input),true);assert.equal(store.accept(input),false);
  const binding=store.binding(scope);store.enqueue(binding,'m','turn',[{type:'text',text:'1'},{type:'text',text:'2'},{type:'text',text:'3'}],{});
  for(const [i,d] of store.deliveries().entries())store.db.prepare('UPDATE deliveries SET state=?,json=? WHERE id=?').run(i===2?'unknown':'sent',JSON.stringify({...d,...i===0?{sentAt:now-30}:{}}),d.id);
  stats.migrateLegacy();const today=stats.query();assert.equal(today.summary.received,1);assert.equal(today.summary.sent,1);assert.equal(today.summary.unknownSentTime,1);assert.equal(today.summary.onlineBots,1);
  const all=stats.query({range:'all'});assert.equal(all.summary.sent,2);assert.equal(all.summary.unknown,1);assert.equal(all.bots.find(b=>b.id==='weixin')?.groupSupport,'unsupported');
});
test('group observation cannot turn a departed group into confirmed joined membership',async t=>{
  const {stats}=await fixture(t);stats.observeGroup({botId:'qq',groupId:'group',event:'joined',at:now-20,eventId:'joined'});stats.observeGroup({botId:'qq',groupId:'group',event:'left',at:now-10,eventId:'left'});stats.observeGroup({botId:'qq',groupId:'group',event:'observed',at:now,name:'Example'});stats.observeGroup({botId:'qq',groupId:'group',event:'joined',at:now-20,eventId:'joined'});
  stats.migrateLegacy();const result=stats.query();assert.equal(result.groups[0].state,'left');assert.equal(result.groups[0].lastSeenAt,now);assert.equal(result.bots.find(b=>b.id==='qq')?.groupCount,0);assert.equal(result.coverage.groupListComplete,false);
});
test('source retention preserves projected message and usage statistics',async t=>{
  const {stats,store}=await fixture(t);const scope:CallerScope={botId:'qq',platform:'qq',accountId:'qq',kind:'private',channelId:'retained',senderId:'retained'};const at=now-40*86400000;store.accept({id:'old',scope,text:'old',attachments:[],reply:{},timestamp:at});store.mark(scopeKey(scope),['old'],'complete');stats.observeSession('retained-session','qq');stats.recordNative('retained-session',{seq:1,time:at,type:'assistant/message',data:{turn:0,step:0,message:{source:{provider:'p',model:'m'}},usage:usage(9)}});const before=stats.query({range:'all'});store.retain(now,{inbox:30,delivery:30,metric:30,failure:30});const after=stats.query({range:'all'});assert.deepEqual(after,before);
});
test('legacy group messages backfill only observed membership evidence',async t=>{
  const dir=await mkdtemp(path.resolve('.codex/stats-backfill-'));const store=new Store(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  store.saveBot(botSchema.parse({id:'qq',name:'QQ',channel:'qq',accountId:'qq'}));
  store.accept({id:'old',scope:{botId:'qq',platform:'qq',accountId:'qq',kind:'group',channelId:'old-room',senderId:'member'},text:'old',attachments:[],reply:{},timestamp:now-86400000});
  const stats=new StatsService(new SqliteStatsData(store),undefined,()=>store.bots(),()=>now,channels);const result=stats.query({range:'all'});
  assert.equal(result.groups[0].groupId,'old-room');assert.equal(result.groups[0].state,'observed');assert.equal(result.groups[0].complete,false);
});
