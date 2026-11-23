import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../../../src/infrastructure/sqlite/persistence.js';
import {Admin} from '../../../src/harness/admin.js';
import {adminCommandRequestSchema,adminQueryRequestSchema} from '../../../src/harness/admin-contract.js';
import {botSchema} from '../../../src/core/types.js';
import {createBotCredentials} from '../../../src/harness/credentials.js';
import type {Credentials} from '../../../src/core/runtime-ports.js';

async function fixture(t:any,credentials?:Credentials,chooseDirectory?:(initial?:string)=>Promise<string|undefined>){
  const home=await mkdtemp(path.resolve('.codex/admin-contract-'));const store=new SqlitePersistence(home,undefined,{secureDefaults:true});
  store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true}));
  const runtime:any={repos:store.repositories(),states:new Map([['bot','connected']]),activeSessions:()=>0,health:()=>({ready:true,quiescing:false,activeTasks:0,pendingDeliveries:0,pendingSessionActions:0,connections:{bot:'connected'},latency:{}}),credentials:credentials??{read:async()=>({accountId:'account'})},media:{analysisStatus:async()=>({enabled:false,available:false})}};
  const admin=new Admin({} as any,runtime,'token',async()=>{},undefined,undefined,chooseDirectory);t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});return{store,admin};
}

test('versioned query and command contracts reject unknown fields and invalid envelopes',()=>{
  const query={version:1,kind:'query',name:'overview.summary',input:{}};
  assert.equal(adminQueryRequestSchema.parse(query).name,'overview.summary');
  assert.throws(()=>adminQueryRequestSchema.parse({...query,input:{unexpected:true}}));
  assert.throws(()=>adminQueryRequestSchema.parse({...query,name:'state'}));
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.start',input:{id:'bot',unexpected:true}}));
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.start',input:{}}));
  assert.equal(adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.delete',input:{id:'1'}}).name,'bot.delete');
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.delete',input:{}}));
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.delete',input:{id:'1',all:true}}));
  assert.equal(adminCommandRequestSchema.parse({version:1,kind:'command',name:'delivery.retry',input:{id:'delivery'}}).name,'delivery.retry');
  assert.equal(adminCommandRequestSchema.parse({version:1,kind:'command',name:'session.delete',input:{id:'session'}}).name,'session.delete');
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'session.delete',input:{id:'session',scopeKey:'other'}}));
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'session.delete',input:{id:''}}));
  assert.equal(adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.service.start',input:{}}).name,'bot.service.start');
  assert.equal(adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.service.stop',input:{}}).name,'bot.service.stop');
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.service.start',input:{id:'unexpected'}}));
  assert.equal(adminCommandRequestSchema.parse({version:1,kind:'command',name:'service.start',input:{serviceId:'breeze-tts'}}).name,'service.start');
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'service.start',input:{serviceId:'rvc'}}));
});

test('session deletion command reports replacement only when deleting the current session',async t=>{
  const {admin}=await fixture(t);let received='';
  (admin.runtime as any).deleteSession=async(id:string)=>{received=id;return{current:true,newSessionId:'replacement'};};
  assert.deepEqual(await admin.command({version:1,kind:'command',name:'session.delete',input:{id:'current'}}),{ok:true,current:true,newSessionId:'replacement'});
  assert.equal(received,'current');
  (admin.runtime as any).deleteSession=async()=>({current:false});
  assert.deepEqual(await admin.command({version:1,kind:'command',name:'session.delete',input:{id:'history'}}),{ok:true,current:false});
});

test('workspace commands validate explicit asset selections and session export delegates to the host',async t=>{
  assert.equal(adminQueryRequestSchema.parse({version:1,kind:'query',name:'workspace.storage',input:{botId:'bot',kind:'image'}}).name,'workspace.storage');
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'workspace.cleanup',input:{botId:'bot',assetIds:[],path:'untrusted'}}));
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'workspace.pin',input:{botId:'bot',assetId:'asset',pinned:'yes'}}));
  const {admin}=await fixture(t);let requested='';
  (admin.runtime as any).harness={exportSessionHistory:async(id:string)=>{requested=id;return '/fixture/history.jsonl';}};
  assert.deepEqual(await admin.command({version:1,kind:'command',name:'session.export',input:{id:'session'}}),{ok:true,path:'/fixture/history.jsonl'});
  assert.equal(requested,'session');
});

test('workspace directories show the persisted session location after the configured root changes',async t=>{
  const {admin,store}=await fixture(t),binding=store.sessions.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});
  const actual=path.join(store.home,'existing-scope');store.sessions.setWorkspace(binding.key,binding.sessionId,actual);
  store.bots.saveBot({...store.bots.bot('bot'),workingDirectory:path.join(store.home,'new-root')});
  const result:any=await admin.invoke('directories',{});
  assert.equal(result.sessions[0].scopeDirectory,actual);
  assert.equal(result.sessions[0].directory,path.join(actual,'sessions',binding.sessionId));
});

test('model directory picker command returns the selected path without saving settings',async t=>{
  const selected=path.resolve('.codex/selected-models');let received:string|undefined;
  const {admin}=await fixture(t,undefined,async initial=>{received=initial;return selected;});
  const result:any=await admin.command({version:1,kind:'command',name:'service.settings.pick-directory',input:{current:'E:\\TTS_and_STS\\models'}});
  assert.deepEqual(result,{path:selected});assert.equal(received,'E:\\TTS_and_STS\\models');
});

test('bot service commands toggle the runtime without changing bot preferences',async t=>{
  const {admin,store}=await fixture(t);let running=false,starts=0,stops=0;const runtime=admin.runtime as any;
  runtime.startService=async()=>{starts++;running=true;};runtime.stopService=async()=>{stops++;running=false;};runtime.serviceRunning=()=>running;
  assert.deepEqual(await admin.command({version:1,kind:'command',name:'bot.service.start',input:{}}),{running:true});
  assert.deepEqual(await admin.command({version:1,kind:'command',name:'bot.service.stop',input:{}}),{running:false});
  assert.equal(starts,1);assert.equal(stops,1);assert.equal(store.bots.bot('bot').enabled,true);
});

test('overview summary is bounded, redacted and supports unchanged revision responses',async t=>{
  const {admin}=await fixture(t);const first:any=await admin.query({version:1,kind:'query',name:'overview.summary',input:{}});
  assert.equal(first.contractVersion,1);assert.match(first.revision,/^sha256:/);assert.ok(first.data);
  assert.equal(first.data.configs[0].allowHostTools,false);assert.equal(first.data.bots[0].credentialConfigured,true);
  assert.equal(first.data.configs[0].voice.enabled,false);
  const voiceStatus:any=await admin.invoke('skill.voice.status',{});assert.equal(voiceStatus.default.enabled,false);assert.equal(voiceStatus.default.format,'mp3');assert.doesNotMatch(JSON.stringify(voiceStatus),/token|appSecret|apiKey/i);
  const serialized=JSON.stringify(first.data);assert.doesNotMatch(serialized,/"(?:personaPrompt|reply|replyEnvelope|storageDirectory|workspaceRoot|appSecret|token)":/);
  assert.equal((await admin.query({version:1,kind:'query',name:'overview.summary',input:{changedSince:first.revision}}) as any).unchanged,true);
});

test('numeric and mixed-case bot IDs work in summary and bot list queries',async t=>{
  const {admin,store}=await fixture(t,createBotCredentials({readRecord:async()=>undefined,modifyRecord:async(_key,mutate)=>mutate(undefined),deleteRecord:async()=>{}}));
  for(const id of ['1','QQ_Bot'])store.bots.saveBot(botSchema.parse({id,name:id,channel:'qq'}));
  const summary:any=await admin.query({version:1,kind:'query',name:'overview.summary',input:{}});
  const bots:any=await admin.query({version:1,kind:'query',name:'bots.list',input:{}});
  for(const result of [summary.data.bots,bots.data])for(const id of ['1','QQ_Bot'])assert.equal(result.find((bot:any)=>bot.id===id).credentialConfigured,false);
});

test('bot list provides current private sessions for its own channel account with the effective persona',async t=>{
  const {admin,store}=await fixture(t);
  const scope={botId:'bot',platform:'qq',accountId:'account',kind:'private' as const,channelId:'alice',senderId:'alice'};
  store.sessions.binding(scope);
  const alice=store.sessions.reset(scope);
  const bob=store.sessions.binding({...scope,channelId:'bob',senderId:'bob'});
  store.sessions.updateSession({...bob,personaId:'companion'});
  store.sessions.binding({...scope,kind:'group',channelId:'group'});
  store.sessions.binding({...scope,accountId:'previous-account'});
  store.sessions.binding({...scope,platform:'weixin'});
  store.bots.saveBot(botSchema.parse({id:'other',name:'Other',channel:'qq',accountId:'second-account'}));
  const other=store.sessions.binding({...scope,botId:'other',accountId:'second-account'});

  const result:any=await admin.query({version:1,kind:'query',name:'bots.list',input:{}});
  const sessions=result.data.find((bot:any)=>bot.id==='bot').privateSessions;
  assert.deepEqual(sessions.sort((a:any,b:any)=>a.senderId.localeCompare(b.senderId)),[
    {senderId:'alice',sessionId:alice.sessionId,platform:'qq',personaId:'default'},
    {senderId:'bob',sessionId:bob.sessionId,platform:'qq',personaId:'companion'},
  ]);
  assert.deepEqual(result.data.find((bot:any)=>bot.id==='other').privateSessions,[
    {senderId:'alice',sessionId:other.sessionId,platform:'qq',personaId:'default'},
  ]);
});

test('deleting a bot hides it from all bot queries and invalidates a pending login result',async t=>{
  const {admin,store}=await fixture(t);const runtime=admin.runtime as any;
  store.bots.saveBot({...store.bots.bot('bot'),enabled:false});store.bots.saveBot(botSchema.parse({id:'other',name:'Other',channel:'qq',accountId:'other'}));
  let finishLogin!:(value:unknown)=>void;let writes=0;
  runtime.channels={require:()=>({adapter:{pollLogin:()=>new Promise(resolve=>{finishLogin=resolve;})}})};
  runtime.credentials.write=async()=>{writes++;};
  runtime.deleteBot=async(id:string)=>{store.bots.saveBot({...store.bots.bot(id),enabled:false,archived:true});};
  admin.attempts.set('pending',{botId:'bot',ticket:'ticket',expires:Date.now()+60000});
  const polling=admin.invoke('login.poll',{attempt:'pending'});
  assert.deepEqual(await admin.command({version:1,kind:'command',name:'bot.delete',input:{id:'bot'}}),{ok:true});
  finishLogin({status:'confirmed',credential:{accountId:'account'}});
  await assert.rejects(polling,/状态已改变/);assert.equal(writes,0);assert.equal(admin.attempts.size,0);
  const summary:any=await admin.query({version:1,kind:'query',name:'overview.summary',input:{}});
  const bots:any=await admin.query({version:1,kind:'query',name:'bots.list',input:{}});
  for(const list of [summary.data.bots,bots.data])assert.deepEqual(list.map((bot:any)=>bot.id),['other']);
  assert.equal(summary.data.counts.bots,1);
  await assert.rejects(admin.invoke('login.begin',{id:'bot'}),/已删除/);
  await assert.rejects(admin.invoke('bot.credentials',{id:'bot',credential:{accountId:'account',appSecret:'secret'}}),/已删除/);
});

test('a QR request completing after deletion cannot create a new login attempt',async t=>{
  const {admin,store}=await fixture(t);const runtime=admin.runtime as any;store.bots.saveBot({...store.bots.bot('bot'),enabled:false});
  let finishLogin!:(value:unknown)=>void;
  runtime.channels={require:()=>({adapter:{beginLogin:()=>new Promise(resolve=>{finishLogin=resolve;})}})};
  runtime.deleteBot=async(id:string)=>{store.bots.saveBot({...store.bots.bot(id),enabled:false,archived:true});};
  const login=admin.invoke('login.begin',{id:'bot'});await admin.invoke('bot.delete',{id:'bot'});
  finishLogin({status:'pending',ticket:'late-ticket',qr:'data:image/png;base64,AA=='});
  await assert.rejects(login,/状态已改变/);assert.equal(admin.attempts.size,0);
});

test('session and delivery queries are bounded and cursor-paginated without reply metadata',async t=>{
  const {admin,store}=await fixture(t);const scope={botId:'bot',platform:'qq' as const,accountId:'account',kind:'private' as const,channelId:'channel',senderId:'sender'};const binding=store.sessions.binding(scope);for(let i=0;i<3;i++)store.deliveries.enqueue(binding,`source-${i}`,`turn-${i}`,[{type:'text',text:`reply-${i}`}],{target:'secret'});
  const first:any=await admin.query({version:1,kind:'query',name:'overview.deliveries',input:{limit:2}});assert.equal(first.items.length,2);assert.equal(first.hasMore,true);assert.equal('reply' in first.items[0],false);
  const second:any=await admin.query({version:1,kind:'query',name:'overview.deliveries',input:{limit:2,cursor:first.nextCursor}});assert.equal(second.items.length,1);assert.notEqual(second.items[0].id,first.items[0].id);
  const sessions:any=await admin.query({version:1,kind:'query',name:'overview.sessions',input:{limit:1}});assert.equal(sessions.items.length,1);assert.equal('scope' in sessions.items[0],false);
});

test('session query exposes the live per-session model configuration after a model command',async t=>{
  const {admin,store}=await fixture(t);const scope={botId:'bot',platform:'qq' as const,accountId:'account',kind:'private' as const,channelId:'channel',senderId:'sender'};
  const binding=store.sessions.binding(scope);const before:any=await admin.query({version:1,kind:'query',name:'overview.summary',input:{}});
  store.sessions.updateSession({...binding,modelOverride:{provider:'Fixture',model:'SessionModel'}});
  const sessions:any=await admin.query({version:1,kind:'query',name:'overview.sessions',input:{limit:10}});const current=sessions.items.find((item:any)=>item.id===binding.sessionId);
  assert.deepEqual(current.modelOverride,{provider:'Fixture',model:'SessionModel'});assert.deepEqual(current.effectiveModel,current.modelOverride);
  const after:any=await admin.query({version:1,kind:'query',name:'overview.summary',input:{}});assert.notEqual(after.data.sessionRevision,before.data.sessionRevision);
});

test('delivery query exposes recovery state without leaking channel upload secrets',async t=>{
  const {admin,store}=await fixture(t);const scope={botId:'bot',platform:'qq' as const,accountId:'account',kind:'private' as const,channelId:'channel',senderId:'sender'};const binding=store.sessions.binding(scope);store.deliveries.enqueue(binding,'source','turn',[{type:'asset',assetId:'asset'}],{});
  const delivery=store.deliveries.deliveries()[0];store.deliveries.deliveryState({...delivery,attempt:{number:2,phase:'commit',assetId:'asset',aesKey:'secret-key',uploadQuery:'secret-query',lastError:'receipt lost',causeCode:'ECONNRESET',autoRetryCount:2}},'unknown',undefined,'receipt lost');
  const result:any=await admin.query({version:1,kind:'query',name:'overview.deliveries',input:{limit:10,scopeKey:binding.key}});assert.equal(result.items[0].state,'unknown');assert.equal(result.items[0].attempt.phase,'commit');assert.equal(result.items[0].attempt.causeCode,'ECONNRESET');assert.equal(result.items[0].attempt.autoRetryCount,2);assert.equal('aesKey' in result.items[0].attempt,false);assert.equal('uploadQuery' in result.items[0].attempt,false);
});

test('delivery query exposes sanitized platform rejection details and hides upload credentials',async t=>{
  const {admin,store}=await fixture(t),binding=store.sessions.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'channel',senderId:'sender'});store.deliveries.enqueue(binding,'source','turn',[{type:'asset',assetId:'asset'}],{});
  const delivery=store.deliveries.deliveries()[0];store.deliveries.deliveryState({...delivery,attempt:{number:1,phase:'upload',httpStatus:400,platformCode:'400100',platformMessage:'file too large https://signed.example/private?token=secret',platformTraceId:'qq-trace-123',fileInfo:'secret-upload-receipt',aesKey:'secret-key',lastError:'HTTP 400'}},'failed',undefined,'HTTP 400');
  const result:any=await admin.query({version:1,kind:'query',name:'overview.deliveries',input:{limit:10,scopeKey:binding.key}}),attempt=result.items[0].attempt;
  assert.equal(attempt.httpStatus,400);assert.equal(attempt.platformCode,'400100');assert.equal(attempt.platformTraceId,'qq-trace-123');assert.match(attempt.platformMessage,/file too large/);assert.doesNotMatch(JSON.stringify(result),/signed\.example|token=secret|secret-upload-receipt|secret-key/);
});

test('delivery filters apply before paging and uncertain sends require an explicit resend',async t=>{
  const {admin,store}=await fixture(t);
  const scope={botId:'bot',platform:'qq' as const,accountId:'account',kind:'private' as const,channelId:'channel',senderId:'sender'};
  const first=store.sessions.binding(scope);
  store.bots.saveBot({id:'another',name:'Another',channel:'qq',enabled:true});
  const other=store.sessions.binding({...scope,botId:'another'});
  store.deliveries.enqueue(first,'one','one',[{type:'text',text:'reply'}],{});
  store.deliveries.enqueue(other,'two','two',[{type:'text',text:'other'}],{});
  store.deliveries.enqueue(first,'three','three',[{type:'text',text:'stage'}],{},undefined,{runId:'run',generation:first.generation,expiresAt:1});
  for(const delivery of store.deliveries.deliveries())store.deliveries.deliveryState(delivery,delivery.purpose==='progress'?'failed':'unknown');
  const page:any=await admin.query({version:1,kind:'query',name:'overview.deliveries',input:{botId:'bot',state:'unknown',limit:1}});
  assert.equal(page.items.length,1);assert.equal(page.hasMore,false);assert.equal(page.items[0].botId,'bot');assert.equal(page.items[0].purpose,undefined);
  const id=page.items[0].id,calls:string[]=[];
  (admin.runtime as any).deliveryWorker={retry:async(id:string)=>{calls.push(id);}};
  const retry=(input:unknown)=>admin.command({version:1,kind:'command',name:'delivery.retry',input});
  await assert.rejects(retry({id}),/核对/);
  await assert.rejects(retry({id:store.deliveries.deliveries().find(row=>row.purpose==='progress')!.id,confirmUnknown:true}),/不可恢复/);
  assert.deepEqual(calls,[]);await retry({id,confirmUnknown:true});assert.deepEqual(calls,[id]);
});
