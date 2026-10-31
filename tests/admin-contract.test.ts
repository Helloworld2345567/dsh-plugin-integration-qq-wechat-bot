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
  const runtime:any={store,states:new Map([['bot','connected']]),activeSessions:()=>0,health:()=>({ready:true,quiescing:false,activeTasks:0,pendingDeliveries:0,pendingSessionActions:0,connections:{bot:'connected'},latency:{}}),credentials:{read:async()=>({accountId:'account'})},media:{analysisStatus:async()=>({enabled:false,available:false})}};
  const admin=new Admin({} as any,runtime,'token',async()=>{});t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});return{store,admin};
}

test('versioned query and command contracts reject unknown fields and invalid envelopes',()=>{
  const query={version:1,kind:'query',name:'overview.summary',input:{}};
  assert.equal(adminQueryRequestSchema.parse(query).name,'overview.summary');
  assert.throws(()=>adminQueryRequestSchema.parse({...query,input:{unexpected:true}}));
  assert.throws(()=>adminQueryRequestSchema.parse({...query,name:'state'}));
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.start',input:{id:'bot',unexpected:true}}));
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'bot.start',input:{}}));
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

test('GPT-SoVITS status separates complete configuration from revision-specific synthesis acceptance',async t=>{
  const {admin,store}=await fixture(t);
  const config=store.saveConfig({id:'voice',name:'Voice',personaPrompt:'A',model:{provider:'chat-provider',model:'chat-model'},media:{voice:{enabled:true,protocol:'gpt_sovits',replyMode:'auto',gptSovits:{baseUrl:'http://tts.invalid:9880',modelVersion:'v4',gptWeightsPath:'models/voice.ckpt',sovitsWeightsPath:'models/voice.pth',refAudioPath:'references/voice.wav',promptText:'参考音频文字',promptLang:'all_zh',textLang:'all_zh'}}}});
  admin.runtime.media.analysisStatus=async()=>({enabled:true,configured:true,keyConfigured:false,provider:'gpt_sovits',protocol:'gpt_sovits',model:'v4'});
  let status:any=(await admin.invoke('skill.voice.status',{}) as any).voice;
  assert.equal(status.provider,'gpt_sovits');assert.equal(status.model,'v4');assert.equal(status.format,'wav');assert.equal(status.replyMode,'auto');assert.equal(status.synthesisValidation.status,'NOT_RUN');
  assert.doesNotMatch(JSON.stringify(status),/baseUrl|weights|refAudioPath|chat-provider|chat-model/);
  store.saveCapabilityStatus('voice:1:voice',{configId:'voice',revision:config.revision,role:'voice',status:'PASS',evidence:'Audible reference fixture verified',updatedAt:1,source:'operator'});
  status=(await admin.invoke('skill.voice.status',{}) as any).voice;assert.equal(status.synthesisValidation.status,'PASS');
  store.saveConfig({...config,name:'Changed'},config.revision);
  status=(await admin.invoke('skill.voice.status',{}) as any).voice;assert.equal(status.synthesisValidation.status,'NOT_RUN');
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
