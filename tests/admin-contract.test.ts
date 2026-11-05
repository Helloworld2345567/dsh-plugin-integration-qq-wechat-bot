import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/infrastructure/sqlite/store.js';
import {Admin} from '../src/harness/admin.js';
import {adminCommandRequestSchema,adminQueryRequestSchema} from '../src/harness/admin-contract.js';
import {botSchema} from '../src/core/types.js';
import {createBotCredentials} from '../src/harness/credentials.js';
import type {Credentials} from '../src/core/runtime-ports.js';

async function fixture(t:any,credentials?:Credentials){
  const home=await mkdtemp(path.resolve('.codex/admin-contract-'));const store=new Store(home,undefined,{secureDefaults:true});
  store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true}));
  const runtime:any={repos:store.repositories(),states:new Map([['bot','connected']]),activeSessions:()=>0,health:()=>({ready:true,quiescing:false,activeTasks:0,pendingDeliveries:0,pendingSessionActions:0,connections:{bot:'connected'},latency:{}}),credentials:credentials??{read:async()=>({accountId:'account'})},media:{analysisStatus:async()=>({enabled:false,available:false})}};
  const admin=new Admin({} as any,runtime,'token',async()=>{});t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});return{store,admin};
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

test('legacy state facade remains available separately from the summary query',async t=>{
  const {admin}=await fixture(t);const legacy:any=await admin.invoke('state',{});assert.ok(Array.isArray(legacy.configs));assert.ok(Array.isArray(legacy.bots));assert.ok('sessions' in legacy);const summary:any=await admin.query({version:1,kind:'query',name:'overview.summary',input:{}});assert.equal('sessions' in summary.data,false);assert.equal('jobs' in summary.data,false);
});

test('numeric and mixed-case bot IDs do not break summary, bot list or legacy state queries',async t=>{
  const {admin,store}=await fixture(t,createBotCredentials({readRecord:async()=>undefined,modifyRecord:async(_key,mutate)=>mutate(undefined),deleteRecord:async()=>{}}));
  for(const id of ['1','QQ_Bot'])store.saveBot(botSchema.parse({id,name:id,channel:'qq'}));
  const summary:any=await admin.query({version:1,kind:'query',name:'overview.summary',input:{}});
  const bots:any=await admin.query({version:1,kind:'query',name:'bots.list',input:{}});
  const state:any=await admin.invoke('state',{});
  for(const result of [summary.data.bots,bots.data,state.bots])for(const id of ['1','QQ_Bot'])assert.equal(result.find((bot:any)=>bot.id===id).credentialConfigured,false);
});

test('deleting a bot hides it from all bot queries and invalidates a pending login result',async t=>{
  const {admin,store}=await fixture(t);const runtime=admin.runtime as any;
  store.saveBot({...store.bot('bot'),enabled:false});store.saveBot(botSchema.parse({id:'other',name:'Other',channel:'qq',accountId:'other'}));
  let finishLogin!:(value:unknown)=>void;let writes=0;
  runtime.channels={require:()=>({adapter:{pollLogin:()=>new Promise(resolve=>{finishLogin=resolve;})}})};
  runtime.credentials.write=async()=>{writes++;};
  runtime.deleteBot=async(id:string)=>{store.saveBot({...store.bot(id),enabled:false,archived:true});};
  admin.attempts.set('pending',{botId:'bot',ticket:'ticket',expires:Date.now()+60000});
  const polling=admin.invoke('login.poll',{attempt:'pending'});
  assert.deepEqual(await admin.command({version:1,kind:'command',name:'bot.delete',input:{id:'bot'}}),{ok:true});
  finishLogin({status:'confirmed',credential:{accountId:'account'}});
  await assert.rejects(polling,/状态已改变/);assert.equal(writes,0);assert.equal(admin.attempts.size,0);
  const summary:any=await admin.query({version:1,kind:'query',name:'overview.summary',input:{}});
  const bots:any=await admin.query({version:1,kind:'query',name:'bots.list',input:{}});const state:any=await admin.invoke('state',{});
  for(const list of [summary.data.bots,bots.data,state.bots])assert.deepEqual(list.map((bot:any)=>bot.id),['other']);
  assert.equal(summary.data.counts.bots,1);
  await assert.rejects(admin.invoke('login.begin',{id:'bot'}),/已删除/);
  await assert.rejects(admin.invoke('bot.credentials',{id:'bot',credential:{accountId:'account',appSecret:'secret'}}),/已删除/);
});

test('a QR request completing after deletion cannot create a new login attempt',async t=>{
  const {admin,store}=await fixture(t);const runtime=admin.runtime as any;store.saveBot({...store.bot('bot'),enabled:false});
  let finishLogin!:(value:unknown)=>void;
  runtime.channels={require:()=>({adapter:{beginLogin:()=>new Promise(resolve=>{finishLogin=resolve;})}})};
  runtime.deleteBot=async(id:string)=>{store.saveBot({...store.bot(id),enabled:false,archived:true});};
  const login=admin.invoke('login.begin',{id:'bot'});await admin.invoke('bot.delete',{id:'bot'});
  finishLogin({status:'pending',ticket:'late-ticket',qr:'data:image/png;base64,AA=='});
  await assert.rejects(login,/状态已改变/);assert.equal(admin.attempts.size,0);
});

test('session and delivery queries are bounded and cursor-paginated without reply metadata',async t=>{
  const {admin,store}=await fixture(t);const scope={botId:'bot',platform:'qq' as const,accountId:'account',kind:'private' as const,channelId:'channel',senderId:'sender'};const binding=store.binding(scope);for(let i=0;i<3;i++)store.enqueue(binding,`source-${i}`,`turn-${i}`,[{type:'text',text:`reply-${i}`}],{target:'secret'});
  const first:any=await admin.query({version:1,kind:'query',name:'overview.deliveries',input:{limit:2}});assert.equal(first.items.length,2);assert.equal(first.hasMore,true);assert.equal('reply' in first.items[0],false);
  const second:any=await admin.query({version:1,kind:'query',name:'overview.deliveries',input:{limit:2,cursor:first.nextCursor}});assert.equal(second.items.length,1);assert.notEqual(second.items[0].id,first.items[0].id);
  const sessions:any=await admin.query({version:1,kind:'query',name:'overview.sessions',input:{limit:1}});assert.equal(sessions.items.length,1);assert.equal('scope' in sessions.items[0],false);
});

test('delivery query exposes recovery state without leaking channel upload secrets',async t=>{
  const {admin,store}=await fixture(t);const scope={botId:'bot',platform:'qq' as const,accountId:'account',kind:'private' as const,channelId:'channel',senderId:'sender'};const binding=store.binding(scope);store.enqueue(binding,'source','turn',[{type:'asset',assetId:'asset'}],{});
  const delivery=store.deliveries()[0];store.deliveryState({...delivery,attempt:{number:2,phase:'commit',assetId:'asset',aesKey:'secret-key',uploadQuery:'secret-query',lastError:'receipt lost',causeCode:'ECONNRESET',autoRetryCount:2}},'unknown',undefined,'receipt lost');
  const result:any=await admin.query({version:1,kind:'query',name:'overview.deliveries',input:{limit:10,scopeKey:binding.key}});assert.equal(result.items[0].state,'unknown');assert.equal(result.items[0].attempt.phase,'commit');assert.equal(result.items[0].attempt.causeCode,'ECONNRESET');assert.equal(result.items[0].attempt.autoRetryCount,2);assert.equal('aesKey' in result.items[0].attempt,false);assert.equal('uploadQuery' in result.items[0].attempt,false);
});

test('delivery query exposes sanitized platform rejection details and hides upload credentials',async t=>{
  const {admin,store}=await fixture(t),binding=store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'channel',senderId:'sender'});store.enqueue(binding,'source','turn',[{type:'asset',assetId:'asset'}],{});
  const delivery=store.deliveries()[0];store.deliveryState({...delivery,attempt:{number:1,phase:'upload',httpStatus:400,platformCode:'400100',platformMessage:'file too large https://signed.example/private?token=secret',platformTraceId:'qq-trace-123',fileInfo:'secret-upload-receipt',aesKey:'secret-key',lastError:'HTTP 400'}},'failed',undefined,'HTTP 400');
  const result:any=await admin.query({version:1,kind:'query',name:'overview.deliveries',input:{limit:10,scopeKey:binding.key}}),attempt=result.items[0].attempt;
  assert.equal(attempt.httpStatus,400);assert.equal(attempt.platformCode,'400100');assert.equal(attempt.platformTraceId,'qq-trace-123');assert.match(attempt.platformMessage,/file too large/);assert.doesNotMatch(JSON.stringify(result),/signed\.example|token=secret|secret-upload-receipt|secret-key/);
});
