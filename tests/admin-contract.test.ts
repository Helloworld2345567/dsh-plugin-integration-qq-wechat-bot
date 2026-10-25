import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/core/store.js';
import {Admin} from '../src/harness/admin.js';
import {adminCommandRequestSchema,adminQueryRequestSchema} from '../src/harness/admin-contract.js';
import {botSchema} from '../src/core/types.js';

async function fixture(t:any){
  const home=await mkdtemp(path.resolve('.codex/admin-contract-'));const store=new Store(home,undefined,{secureDefaults:true});
  store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true}));
  const runtime:any={store,states:new Map([['bot','connected']]),activeSessions:()=>0,health:()=>({ready:true,quiescing:false,activeTasks:0,pendingDeliveries:0,pendingSessionActions:0,connections:{bot:'connected'},latency:{}}),credentials:{read:async()=>({accountId:'account'})}};
  const admin=new Admin({} as any,runtime,'token',async()=>{});t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});return{store,admin};
}

test('versioned query and command contracts reject unknown fields and invalid envelopes',()=>{
  const query={version:1,kind:'query',name:'overview.summary',input:{}};
  assert.equal(adminQueryRequestSchema.parse(query).name,'overview.summary');
  assert.throws(()=>adminQueryRequestSchema.parse({...query,input:{unexpected:true}}));
  assert.throws(()=>adminQueryRequestSchema.parse({...query,name:'state'}));
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.start',input:{id:'bot',unexpected:true}}));
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.start',input:{}}));
});

test('overview summary is bounded, redacted and supports unchanged revision responses',async t=>{
  const {admin}=await fixture(t);const first:any=await admin.query({version:1,kind:'query',name:'overview.summary',input:{}});
  assert.equal(first.contractVersion,1);assert.match(first.revision,/^sha256:/);assert.ok(first.data);
  assert.equal(first.data.configs[0].allowHostTools,false);assert.equal(first.data.bots[0].credentialConfigured,true);
  assert.equal(first.data.configs[0].voice.enabled,false);
  const voiceStatus:any=await admin.invoke('skill.voice.status',{});assert.equal(voiceStatus.default.enabled,false);assert.equal(voiceStatus.default.format,'mp3');assert.doesNotMatch(JSON.stringify(voiceStatus),/token|appSecret|apiKey/i);
  const serialized=JSON.stringify(first.data);assert.doesNotMatch(serialized,/personaPrompt|reply|storageDirectory|workspaceRoot|appSecret|token/);
  assert.equal((await admin.query({version:1,kind:'query',name:'overview.summary',input:{changedSince:first.revision}}) as any).unchanged,true);
});

test('legacy state facade remains available separately from the summary query',async t=>{
  const {admin}=await fixture(t);const legacy:any=await admin.invoke('state',{});assert.ok(Array.isArray(legacy.configs));assert.ok(Array.isArray(legacy.bots));assert.ok('sessions' in legacy);const summary:any=await admin.query({version:1,kind:'query',name:'overview.summary',input:{}});assert.equal('sessions' in summary.data,false);assert.equal('jobs' in summary.data,false);
});

test('session and delivery queries are bounded and cursor-paginated without reply metadata',async t=>{
  const {admin,store}=await fixture(t);const scope={botId:'bot',platform:'qq' as const,accountId:'account',kind:'private' as const,channelId:'channel',senderId:'sender'};const binding=store.binding(scope);for(let i=0;i<3;i++)store.enqueue(binding,`source-${i}`,`turn-${i}`,[{type:'text',text:`reply-${i}`}],{target:'secret'});
  const first:any=await admin.query({version:1,kind:'query',name:'overview.deliveries',input:{limit:2}});assert.equal(first.items.length,2);assert.equal(first.hasMore,true);assert.equal('reply' in first.items[0],false);
  const second:any=await admin.query({version:1,kind:'query',name:'overview.deliveries',input:{limit:2,cursor:first.nextCursor}});assert.equal(second.items.length,1);assert.notEqual(second.items[0].id,first.items[0].id);
  const sessions:any=await admin.query({version:1,kind:'query',name:'overview.sessions',input:{limit:1}});assert.equal(sessions.items.length,1);assert.equal('scope' in sessions.items[0],false);
});
