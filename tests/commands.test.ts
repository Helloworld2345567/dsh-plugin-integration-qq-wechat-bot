import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store,scopeKey} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {botSchema,configSchema,type CallerScope,type InboundMessage,type ChannelAdapter} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';
import {parseCommand} from '../src/core/commands.js';

const scope=(senderId='alice',kind:'private'|'group'='private'):CallerScope=>({botId:'one',platform:'qq',accountId:'one',kind,channelId:kind==='group'?'room':senderId,senderId});
let seq=0;
const input=(text:string,s=scope()):InboundMessage=>({id:`m-${++seq}`,scope:s,text,attachments:[],reply:{target:s.channelId},timestamp:Date.now()});
function gate(){let resolve!:(value?:any)=>void;const promise=new Promise<any>(r=>resolve=r);return{promise,resolve};}
async function fixture(t:any,overrides:Partial<HarnessPort>={}){
  const home=await mkdtemp(path.resolve('.codex/commands-'));const store=new Store(home);store.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true,trustedUsers:['alice']}));
  const runs:InboundMessage[][]=[];const sent:string[]=[];const assets=new Assets(store),media=new MediaService(store,assets);
  const harness:HarnessPort={run:async(binding,messages)=>{runs.push(messages);binding.persisted=true;store.updateSession(binding);return{turnId:`turn-${runs.length}`,outputs:[],snapshot:freezeTurn(store.effectiveConfig(binding),store.bot('one'),binding.scope,messages.map(m=>m.id))};},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async config=>{if(config.model?.model==='bad')throw Error('BAD_MODEL');},inspectSession:async()=>{},models:async()=>[{provider:'ProviderA',model:'ModelCase'}],...overrides};
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.from('media'),send:async(_b,_c,d)=>{sent.push(d.output.text??'asset');return'receipt';}};
  const runtime=new BotRuntime(store,assets,media,harness,createChannelRegistry([{id:'qq',displayName:'QQ',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}},{id:'weixin',displayName:'Weixin',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}}]),{read:async()=>({accountId:'one'}),write:async()=>{},remove:async()=>{}},60000);
  t.after(async()=>{await runtime.close();store.close();await rm(home,{recursive:true,force:true});});return{store,runtime,harness,runs,sent,media,assets};
}

test('commands preserve argument case, escape slashes, never send unknown commands to model and deduplicate',async t=>{
  assert.deepEqual(parseCommand('/PeRsOnA SakuraCase'),{name:'persona',args:'SakuraCase'});assert.equal(parseCommand('//status'),undefined);
  const f=await fixture(t);const unknown=input('/missing');await f.runtime.receive(unknown);await f.runtime.receive(unknown);assert.equal(f.sent.length,1);assert.match(f.sent[0],/未知命令/);assert.equal(f.runs.length,0);
  await f.runtime.receive(input('//status'));await f.runtime.process(scopeKey(scope()));assert.equal(f.runs[0][0].text,'/status');
});
test('session persona and model overrides keep history, preserve case and never alter another channel',async t=>{
  const f=await fixture(t);f.store.saveConfig(configSchema.parse({id:'SakuraCase',name:'Case',personaPrompt:'P',model:{provider:'P',model:'Base'}}));
  const id=f.store.binding(scope()).sessionId;await f.runtime.receive(input('/MODEL ProviderA ModelCase'));assert.deepEqual(f.runtime.effectiveConfig(f.store.binding(scope())).model,{provider:'ProviderA',model:'ModelCase'});
  await f.runtime.receive(input('/PERSONA SakuraCase'));assert.equal(f.store.binding(scope()).sessionId,id);assert.equal(f.store.binding(scope()).modelOverride,undefined);assert.equal(f.runtime.effectiveConfig(f.store.binding(scope())).id,'SakuraCase');assert.equal(f.runtime.effectiveConfig(f.store.binding(scope('bob'))).id,'default');
  await f.runtime.receive(input('/model ProviderA Other'));await f.runtime.receive(input('/model reset'));assert.equal(f.runtime.effectiveConfig(f.store.binding(scope())).model?.model,'Base');
  await f.runtime.receive(input('/model ProviderA bad'));assert.equal(f.runtime.effectiveConfig(f.store.binding(scope())).model?.model,'Base');assert.match(f.sent.at(-1)!,/BAD_MODEL/);
});
test('new keeps model/persona and stable memories, cancels deferred input and clears recent index boundary',async t=>{
  const f=await fixture(t);await f.runtime.switchPersona(scope(),'sakura');await f.runtime.setModel(scope(),{provider:'P',model:'M'});const before=f.store.binding(scope());
  const memory=input('我喜欢绿茶');f.store.accept(memory);f.store.mark(before.key,[memory.id],'complete');f.store.remember(before.key,'drink','绿茶',memory.id,memory.text);
  const held=input('https://example.com/clip');await f.runtime.receive(held);await new Promise(r=>setTimeout(r,5));await f.runtime.receive(input('/new'));const next=f.store.binding(scope());
  assert.notEqual(next.sessionId,before.sessionId);assert.equal(next.personaId,'sakura');assert.deepEqual(next.modelOverride,{provider:'P',model:'M'});assert.ok(f.store.recentSince(next.key)>before.recentSince!);assert.equal(f.store.memories(next.key).length,1);assert.equal(f.store.messages(next.key,['deferred']).length,0);assert.equal(f.store.sessions(scope()).length,2);
});
test('history restore verifies ownership and readability before disposing active session',async t=>{
  let readable=true;const disposed:string[]=[];const f=await fixture(t,{inspectSession:async()=>{if(!readable)throw Error('HISTORY_MISSING');},dispose:async id=>{if(id)disposed.push(id);}});
  await f.runtime.receive(input('history'));await f.runtime.process(scopeKey(scope()));const first=f.store.binding(scope());await f.runtime.newSession(scope());const current=f.store.binding(scope());
  const other=f.store.binding(scope('bob'));await assert.rejects(f.runtime.resumeSession(scope(),other.sessionId),/不属于/);assert.equal(f.store.binding(scope()).sessionId,current.sessionId);
  readable=false;await assert.rejects(f.runtime.resumeSession(scope(),first.sessionId),/HISTORY_MISSING/);assert.deepEqual(disposed,[first.sessionId]);assert.equal(f.store.binding(scope()).sessionId,current.sessionId);
  readable=true;await f.runtime.resumeSession(scope(),first.sessionId);assert.equal(f.store.binding(scope()).sessionId,first.sessionId);assert.equal(f.store.binding(scope()).persisted,true);
});
test('trusted private restriction covers global statistics, persona/model and self modifications',async t=>{
  const f=await fixture(t);let stats=0,evolves=0;f.runtime.commandServices.stats=async()=>{stats++;return'global';};f.runtime.commandServices.evolution={request:async()=>{evolves++;return'instructions';},status:async()=>'',history:async()=>'',rollback:async()=>'',restart:async()=>''};
  for(const user of [scope('bob'),scope('alice','group')])for(const text of ['/stats','/persona sakura','/model P M','/reload','/restart','/evolve add skill'])await f.runtime.receive(input(text,user));
  assert.equal(stats,0);assert.equal(evolves,0);assert.ok(f.sent.every(s=>s.includes('可信私聊')));
  await f.runtime.receive(input('/stats 7d'));assert.equal(stats,1);assert.equal(f.sent.at(-1),'global');
  const config=f.store.config('default');f.store.saveConfig({...config,allowHostTools:false},config.revision);await f.runtime.receive(input('/evolve add skill'));assert.equal(evolves,0);assert.match(f.sent.at(-1)!,/本机工具/);
});
test('compact returns receive immediately, is cancellable through stop and refuses a busy turn',async t=>{
  const began=gate();let aborted=false;const f=await fixture(t,{compact:async(_b,signal)=>{began.resolve();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true}));return'compressed';}});
  const binding=f.store.binding(scope());binding.persisted=true;f.store.updateSession(binding);
  await f.runtime.receive(input('/compact'));await began.promise;assert.equal(f.runtime.activeSessions('one'),1);await f.runtime.receive(input('/compact'));assert.match(f.sent.at(-1)!,/忙碌/);await f.runtime.receive(input('/stop'));assert.equal(aborted,true);assert.equal(f.runtime.activeSessions('one'),0);assert.equal(f.runs.length,0);
});
test('serial control operations preserve order during validation and duplicate command has one effect',async t=>{
  const validation=gate(),entered=gate();const f=await fixture(t,{validateModel:async c=>{if(c.model?.model==='Slow'){entered.resolve();await validation.promise;}}});
  const first=f.runtime.receive(input('/model P Slow'));await entered.promise;const second=f.runtime.receive(input('/persona sakura'));validation.resolve();await Promise.all([first,second]);assert.equal(f.store.binding(scope()).personaId,'sakura');assert.equal(f.store.binding(scope()).modelOverride,undefined);
  const command=input('/new');await Promise.all([f.runtime.receive(command),f.runtime.receive(command)]);assert.equal(f.store.sessions(scope()).length,2);
});
test('revoking trust during model validation prevents the pending configuration write',async t=>{
  const entered=gate(),release=gate();const f=await fixture(t,{validateModel:async()=>{entered.resolve();await release.promise;}});
  const command=f.runtime.receive(input('/model P Slow'));await entered.promise;f.runtime.saveBot({...f.store.bot('one'),trustedUsers:[]});release.resolve();await command;assert.equal(f.store.binding(scope()).modelOverride,undefined);assert.match(f.sent.at(-1)!,/可信私聊/);
});
test('late session persistence never overwrites newer overrides or resurrects an inactive session',async t=>{
  const f=await fixture(t);const original=f.store.binding(scope());await f.runtime.switchPersona(scope(),'sakura');f.store.markSessionPersisted(original);assert.equal(f.store.binding(scope()).personaId,'sakura');assert.equal(f.store.binding(scope()).persisted,true);
  const next=await f.runtime.newSession(scope());f.store.markSessionPersisted(original);assert.equal(f.store.binding(scope()).sessionId,next.sessionId);assert.equal(f.store.session(scope(),original.sessionId).persisted,true);
});
test('stop cancels a delivery waiting for credential IPC before any platform send',async t=>{
  const entered=gate(),release=gate();const f=await fixture(t);f.runtime.credentials.read=async()=>{entered.resolve();await release.promise;return{accountId:'one'};};const binding=f.store.binding(scope());f.store.enqueue(binding,'source','turn',[{type:'text',text:'late'}],{});
  const sending=f.runtime.flushDeliveries();await entered.promise;await f.runtime.stopSession(scope());release.resolve();await sending;assert.equal(f.sent.length,0);assert.equal(f.store.deliveries()[0].state,'cancelled');
});
test('resume and compact refuse an active turn without cancelling it',async t=>{
  const entered=gate(),release=gate();let cancelled=0;const f=await fixture(t,{cancel:()=>{cancelled++;},run:async(binding,messages)=>{entered.resolve();await release.promise;return{turnId:'busy',outputs:[],snapshot:freezeTurn(f.store.effectiveConfig(binding),f.store.bot('one'),binding.scope,messages.map(m=>m.id))};}});
  await f.runtime.receive(input('work'));const working=f.runtime.process(scopeKey(scope()));await entered.promise;await assert.rejects(f.runtime.resumeSession(scope(),'anything'),/忙碌/);await f.runtime.receive(input('/compact'));assert.match(f.sent.at(-1)!,/忙碌/);assert.equal(cancelled,0);release.resolve();await working;
});
test('quiesce drains active tasks while preserving enabled state and accepts queued messages and commands',async t=>{
  const entered=gate(),finish=gate();const f=await fixture(t,{run:async(binding,messages)=>{entered.resolve();await finish.promise;return{turnId:'held',outputs:[{type:'text',text:'done'}],snapshot:freezeTurn(f.store.effectiveConfig(binding),f.store.bot('one'),binding.scope,messages.map(m=>m.id))};}});
  await f.runtime.receive(input('work'));const processing=f.runtime.process(scopeKey(scope()));await entered.promise;const draining=f.runtime.quiesce();await f.runtime.receive(input('queued'));await f.runtime.receive(input('/status'));assert.equal(f.store.bot('one').enabled,true);assert.equal(f.runtime.health().quiescing,true);finish.resolve();await Promise.all([draining,processing]);assert.equal(f.store.messages(scopeKey(scope())).length,1);assert.equal(f.store.messages(scopeKey(scope()),['control']).length,1);assert.equal(f.sent[0],'done');f.runtime.resumeProcessing();await new Promise(r=>setImmediate(r));assert.equal(f.store.messages(scopeKey(scope()),['control']).length,0);assert.match(f.sent.at(-1)!,/会话：/);
});
test('evolve creates instructions before invoking agent and status uses command feedback',async t=>{
  const f=await fixture(t);let requested='';f.runtime.commandServices.evolution={request:async(_binding,goal)=>{requested=goal;return`Task id=test; bot_evolve: ${goal}`;},status:async()=> 'waiting',history:async()=> 'one',rollback:async()=> 'queued',restart:async()=> 'queued'};
  await f.runtime.receive(input('/evolve Add CaseSkill'));assert.equal(requested,'Add CaseSkill');assert.equal(f.sent.length,0);await f.runtime.process(scopeKey(scope()));assert.match(f.runs[0][0].text,/Task id=test/);await f.runtime.receive(input('/evolve status test'));assert.equal(f.sent.at(-1),'waiting');assert.equal(f.runs.length,1);
});
test('session backfill trusts binding and delivery evidence only and preserves unknown old send time',async t=>{
  const f=await fixture(t);const binding=f.store.binding(scope());f.store.enqueue(binding,'input','turn',[{type:'text',text:'old'}],{});const d=f.store.deliveries()[0];const {createdAt,updatedAt,...legacy}=d;
  f.store.db.prepare('UPDATE deliveries SET json=? WHERE id=?').run(JSON.stringify({...legacy,sessionId:'proved-history'}),d.id);const second=new Store(f.store.home);try{assert.equal(second.session(scope(),'proved-history').persisted,true);assert.equal(second.session(scope(),'proved-history').createdAt,0);assert.equal(second.deliveries()[0].sentAt,undefined);assert.throws(()=>second.session(scope('bob'),'proved-history'));}finally{second.close();}
});
test('session backfill preserves partial legacy bindings without inferring ownership or crashing',async t=>{
  const f=await fixture(t);f.store.put('binding','legacy',{sessionId:'unproven-history'});f.store.put('binding','invalid',{key:'invalid',sessionId:'invalid-scope',scope:{platform:'qq'}});const second=new Store(f.store.home);
  try{assert.deepEqual(second.get('binding','legacy'),{sessionId:'unproven-history'});assert.equal(second.get('session','unproven-history'),undefined);assert.equal(second.get('session','invalid-scope'),undefined);}finally{second.close();}
});
test('startup pause keeps recovered inbox and pending deliveries held until activation resumes',async t=>{
  const f=await fixture(t);const binding=f.store.binding(scope());f.store.enqueue(binding,'before-upgrade','turn',[{type:'text',text:'preserved'}],{});f.store.accept(input('queued before upgrade'));f.runtime.pauseProcessing();await f.runtime.initialize();await new Promise(r=>setImmediate(r));assert.equal(f.runs.length,0);assert.equal(f.sent.length,0);assert.equal(f.runtime.health().quiescing,true);f.runtime.resumeProcessing();await f.runtime.flushDeliveries();assert.deepEqual(f.sent,['preserved']);
});
test('stop can interrupt an in-flight task while upgrade quiesce is waiting for it',async t=>{
  const entered=gate();const f=await fixture(t,{run:async(binding,messages,signal)=>{entered.resolve();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return{turnId:'interrupted',outputs:[],snapshot:freezeTurn(f.store.effectiveConfig(binding),f.store.bot('one'),binding.scope,messages.map(m=>m.id))};}});
  await f.runtime.receive(input('work'));const working=f.runtime.process(scopeKey(scope()));await entered.promise;const quiescing=f.runtime.quiesce();await f.runtime.receive(input('/stop'));await Promise.all([working,quiescing]);assert.equal(f.runtime.activeSessions('one'),0);assert.equal(f.runtime.health().quiescing,true);assert.match(f.sent.at(-1)!,/已停止/);
});
test('delivery timestamps reflect actual success and never invent a sent time for unknown results',async t=>{
  const f=await fixture(t);const binding=f.store.binding(scope());f.store.enqueue(binding,'a','turn',[{type:'text',text:'one'},{type:'text',text:'two'}],{});const [one,two]=f.store.deliveries();assert.ok(one.createdAt);f.store.deliveryState(one,'sent','receipt');f.store.deliveryState(two,'unknown',undefined,'uncertain');const rows=f.store.deliveries();assert.ok(rows[0].sentAt);assert.equal(rows[1].sentAt,undefined);assert.ok(rows[1].updatedAt);
});
