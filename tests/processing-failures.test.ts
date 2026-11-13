import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {scopeKey} from '../src/core/identity.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {botSchema,type CallerScope,type InboundMessage,type ChannelAdapter} from '../src/core/types.js';
import {recentFailureContext} from '../src/core/failure-context.js';
import {freezeTurn} from '../src/core/policy.js';

test('attachment download failure sends an explicit durable failure instead of silently losing the edit request',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new SqlitePersistence(root);const sent:string[]=[];let calls=0;
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};
  const message:InboundMessage={id:'new-reference',scope,text:'参考此图生成图片，将人物换成你',attachments:[{kind:'image',name:'reference.jpg',mime:'image/jpeg',url:'https://example.invalid/image'}],reply:{target:'alice'},timestamp:Date.now()};
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>{throw Error('Invalid IP address: undefined');},send:async(_bot,_credential,delivery)=>{sent.push(delivery.output.text!);return'receipt';}};
  const harness:HarnessPort={run:async()=>{calls++;throw Error('model must not run');},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const assets=new Assets(store.repositories());const runtime=new BotRuntime(store.repositories(),assets,new MediaService(store.repositories(),assets),harness,createChannelRegistry([{id:'qq',displayName:'QQ',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}},{id:'weixin',displayName:'Weixin',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}}]),{read:async()=>({accountId:'one'}),write:async()=>{},remove:async()=>{}},60000);
  t.after(async()=>{await runtime.close();store.close();await rm(root,{recursive:true,force:true});});
  await runtime.receive(message);await runtime.process(scopeKey(scope));
  assert.equal(calls,0);assert.equal(sent.length,1,'the failed image request must not disappear without feedback');
  assert.match(sent[0],/图片.*未送入模型/);assert.match(sent[0],/没有生成新图/);
  assert.equal(store.deliveries.deliveries(['sent'])[0].sourceId,message.id);
  const failure=store.failures.failures()[0];assert.equal(failure.stage,'attachments');assert.deepEqual(failure.sourceIds,[message.id]);
  const followup={...message,id:'followup',text:'调用失败了吗',attachments:[],timestamp:failure.at!+1};
  const binding=store.sessions.binding(scope);const context=recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup]);assert.match(context!,/no new image was generated/);assert.match(context!,/参考此图/);
  assert.equal(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},{...binding,sessionId:'different-session'},[followup]),undefined);
  assert.equal(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},{...binding,key:'different-scope'},[followup]),undefined);
  assert.equal(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup],failure.at!+600001),undefined);
  await runtime.receive(message);await runtime.process(scopeKey(scope));assert.equal(sent.length,1,'duplicate platform event cannot duplicate failure feedback');
});

test('model provider failures preserve an actionable error code in the user-facing failure',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new SqlitePersistence(root);const sent:string[]=[];
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};
  const message:InboundMessage={id:'model-failure',scope,text:'为什么没有回复',attachments:[],reply:{target:'alice'},timestamp:Date.now()};
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.from(''),send:async(_bot,_credential,delivery)=>{sent.push(delivery.output.text!);return'receipt';}};
  const harness:HarnessPort={run:async()=>{throw Error('INVALID_REQUEST: upstream model rejected the request');},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const assets=new Assets(store.repositories());const runtime=new BotRuntime(store.repositories(),assets,new MediaService(store.repositories(),assets),harness,createChannelRegistry([{id:'qq',displayName:'QQ',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}},{id:'weixin',displayName:'Weixin',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}}]),{read:async()=>({accountId:'one'}),write:async()=>{},remove:async()=>{}},0);
  t.after(async()=>{await runtime.close();store.close();await rm(root,{recursive:true,force:true});});
  await runtime.receive(message);await runtime.process(scopeKey(scope));
  assert.equal(sent.length,1);assert.match(sent[0],/模型请求失败/);assert.match(sent[0],/INVALID_REQUEST/);assert.match(sent[0],/重置模型/);
  assert.equal(store.failures.failures()[0].code,'INVALID_REQUEST: upstream model rejected the request');
});

test('model-stage failures are not injected again into later turns',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new SqlitePersistence(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};
  const binding=store.sessions.binding(scope),source:InboundMessage={id:'model-source',scope,text:'上一轮模型请求',attachments:[],reply:{},timestamp:Date.now()};
  store.inbox.accept(source);
  store.failures.saveFailure('model-stage-failure',{sessionId:binding.sessionId,scope:binding.key,state:'failed',stage:'model',sourceIds:[source.id],at:Date.now(),code:'INVALID_REQUEST'});
  const followup={...source,id:'followup',text:'继续处理',timestamp:Date.now()+1};
  assert.equal(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup]),undefined);
});

test('another bot credential failure cannot relabel a completed request or its accepted delivery',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new SqlitePersistence(root);const assets=new Assets(store.repositories());
  for(const id of ['good','bad'])store.bots.saveBot(botSchema.parse({id,name:id,channel:'qq',accountId:id,enabled:true}));
  const scope:CallerScope={botId:'good',platform:'qq',accountId:'good',kind:'private',channelId:'alice',senderId:'alice'};
  const other=store.sessions.binding({...scope,botId:'bad',accountId:'bad'});store.deliveries.enqueue(other,'other-request','other-turn',[{type:'text',text:'other reply'},{type:'text',text:'later chunk'}],{});
  const message:InboundMessage={id:'successful-request',scope,text:'answer this request',attachments:[],reply:{},timestamp:Date.now()};
  let acceptOwn!:()=>void;const ownAccepted=new Promise<void>(resolve=>acceptOwn=resolve);const sent:string[]=[];
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>{throw Error('unused');},send:async(bot)=>{sent.push(bot.id);acceptOwn();return'accepted-receipt';}};
  const harness:HarnessPort={run:async(binding,messages)=>({turnId:'successful-turn',outputs:[{type:'text',text:'accepted reply'}],snapshot:freezeTurn(store.personas.effectiveConfig(binding),store.bots.bot('good'),scope,messages.map(m=>m.id))}),cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const runtime=new BotRuntime(store.repositories(),assets,new MediaService(store.repositories(),assets),harness,createChannelRegistry([{id:'qq',displayName:'QQ',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}},{id:'weixin',displayName:'Weixin',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}}]),{read:async id=>{if(id==='bad'){await ownAccepted;await new Promise<void>(resolve=>setImmediate(resolve));throw Error('OTHER_BOT_CREDENTIAL_FAILURE');}return{accountId:id};},write:async()=>{},remove:async()=>{}},60000);
  t.after(async()=>{await runtime.close();store.close();await rm(root,{recursive:true,force:true});});
  await runtime.receive(message);await runtime.process(scopeKey(scope));
  assert.deepEqual(sent,['good']);assert.equal(store.deliveries.deliveries(['sent'])[0].receipt,'accepted-receipt');
  assert.deepEqual(store.inbox.messages(scopeKey(scope),['complete']).map(m=>m.id),[message.id],'accepted result must retain its completed request');
  assert.equal(store.failures.failures().filter(f=>f.sessionId===store.sessions.binding(scope).sessionId).length,0);
  const rejected=store.deliveries.deliveries().find(d=>d.botId==='bad')!;assert.equal(rejected.state,'failed');assert.equal(rejected.error,'OTHER_BOT_CREDENTIAL_FAILURE');
  assert.deepEqual(store.deliveries.deliveries().filter(d=>d.botId==='bad').map(d=>d.state),['failed','failed'],'later chunks proceed after a failed delivery without relabelling the accepted request');
  assert.equal(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},store.sessions.binding(scope),[{...message,id:'followup',timestamp:Date.now()+1}]),undefined);
});

test('a queued followup sees failures recorded after its arrival and current request IDs are excluded',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new SqlitePersistence(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};const binding=store.sessions.binding(scope);const now=Date.now();
  const photo:InboundMessage={id:'photo',scope,text:'edit my photo',attachments:[],reply:{},timestamp:now-300};store.inbox.accept(photo);
  store.failures.saveFailure('photo-failure',{sessionId:binding.sessionId,scope:binding.key,state:'failed',stage:'attachments',sourceIds:[photo.id],at:now-100,code:'DOWNLOAD_FAILED'});
  const followup={...photo,id:'queued-followup',text:'was it generated?',timestamp:now-200};
  assert.match(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup],now)!,/edit my photo/);
  assert.equal(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[photo],now),undefined,'a current request cannot also be represented as a prior failed request');
  assert.equal(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup],now+600001),undefined);
});

test('historical delivery failure context yields to accepted outputs but not to a sent failure notice',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new SqlitePersistence(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};const binding=store.sessions.binding(scope);const now=Date.now();
  const source:InboundMessage={id:'original',scope,text:'original request',attachments:[],reply:{},timestamp:now-200};store.inbox.accept(source);
  const failure={sessionId:binding.sessionId,scope:binding.key,state:'failed',stage:'delivery',sourceIds:[source.id],at:now-100,code:'FLUSH_FAILED'};store.failures.saveFailure('historical',failure);
  const followup={...source,id:'followup',timestamp:now};
  store.deliveries.enqueue(binding,source.id,'failure:original',[{type:'text',text:'could not process'}],{});store.deliveries.deliveryState(store.deliveries.deliveries()[0],'sent','failure-receipt');
  assert.match(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup],now)!,/delivery status is unconfirmed/);
  store.deliveries.enqueue(binding,source.id,'model-turn',[{type:'text',text:'result'},{type:'text',text:'second chunk'}],{});const [output,second]=store.deliveries.deliveries(['pending']);
  assert.match(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup],now)!,/delivery status is unconfirmed/);
  store.deliveries.deliveryState(output,'unknown');const deduplicated=recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup],Date.now()+1)!;
  assert.equal(JSON.parse(deduplicated.split('\n')[1]).length,1,'failure and delivery records for one source are still deduplicated internally');assert.doesNotMatch(deduplicated,/sourceId|deliveryId/);
  store.deliveries.deliveryState(output,'sent','result-receipt');assert.match(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup],now)!,/delivery status is unconfirmed/,'a partial send cannot supersede a delivery failure');
  store.deliveries.deliveryState(second,'sent','second-receipt');assert.equal(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup],now),undefined,'successful original output supersedes stale delivery failure');
});

test('uncertain delivery state is visible to the next turn without triggering a duplicate resend',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new SqlitePersistence(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};const binding=store.sessions.binding(scope);const now=Date.now();
  const source:InboundMessage={id:'unknown-image',scope,text:'生成一张图片',attachments:[],reply:{},timestamp:now-100};store.inbox.accept(source);
  store.deliveries.enqueue(binding,source.id,'image-turn',[{type:'asset',assetId:'asset-one'}],{});const delivery=store.deliveries.deliveries()[0];store.deliveries.deliveryState(delivery,'unknown',undefined,'receipt lost');
  const followup={...source,id:'ask-status',text:'图片发来了吗',timestamp:now};const context=recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup],Date.now()+1);
  assert.match(context!,/Platform delivery status is unknown/);assert.match(context!,/asset-one/);assert.match(context!,/Do not resend automatically/);assert.match(context!,/queued does not mean delivered/);
  assert.doesNotMatch(context!,/sourceId|deliveryId|unknown-image/);assert.ok(!context!.includes(delivery.id));
});

for(const phase of ['prepare','upload'] as const)test(`failed ${phase} rejection is described as unsubmitted rather than possibly delivered`,async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-')),store=new SqlitePersistence(root);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'},binding=store.sessions.binding(scope),now=Date.now();
  const source:InboundMessage={id:'long-reading',scope,text:'朗读完整文章',attachments:[],reply:{},timestamp:now-100};store.inbox.accept(source);
  store.deliveries.enqueue(binding,source.id,'voice-turn',[{type:'asset',assetId:'long-audio'}],{});const delivery=store.deliveries.deliveries()[0];
  store.deliveries.deliveryState({...delivery,attempt:{number:1,phase,assetId:'long-audio',startedAt:now-50}},'failed',undefined,'REMOTE_HTTP_400');
  const context=recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[{...source,id:'followup',text:'没有收到语音',timestamp:now}],Date.now()+1)!;
  assert.match(context,/message was not committed or delivered/);assert.match(context,/Wait for an explicit user retry request/);assert.match(context,/long-audio/);
  assert.doesNotMatch(context,/may already have arrived|queue will continue|automatically retry/);assert.equal(store.deliveries.deliveries()[0].state,'failed');
});

for(const phase of ['prepare','upload'] as const)test(`crash recovery with a persisted ${phase} snapshot remains unknown`,async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-')),store=new SqlitePersistence(root);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'},binding=store.sessions.binding(scope),now=Date.now();
  const source:InboundMessage={id:'interrupted-reading',scope,text:'朗读完整文章',attachments:[],reply:{},timestamp:now-100};store.inbox.accept(source);
  store.deliveries.enqueue(binding,source.id,'voice-turn',[{type:'asset',assetId:'long-audio'}],{});const delivery=store.deliveries.deliveries()[0];
  store.deliveries.deliveryState({...delivery,attempt:{number:1,phase,assetId:'long-audio',startedAt:now-50}},'sending');
  store.recover();
  const context=recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[{...source,id:'followup',text:'没有收到语音',timestamp:now}],Date.now()+1)!;
  assert.match(context,/Platform delivery status is unknown and receipt is unconfirmed/);assert.match(context,/may already have arrived. Do not resend automatically/);assert.match(context,/long-audio/);
  assert.doesNotMatch(context,/message was not committed|not delivered|queue will continue|automatically retry/);assert.equal(store.deliveries.deliveries()[0].state,'unknown');
});

test('failed delivery context asks for explicit recovery instead of promising a background retry',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-')),store=new SqlitePersistence(root);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'},binding=store.sessions.binding(scope),now=Date.now();
  const source:InboundMessage={id:'original',scope,text:'发送音频',attachments:[],reply:{},timestamp:now-100};store.inbox.accept(source);
  store.deliveries.enqueue(binding,source.id,'voice-turn',[{type:'asset',assetId:'audio'}],{});store.deliveries.deliveryState(store.deliveries.deliveries()[0],'failed',undefined,'DELIVERY_PREPARATION_FAILED');
  const context=recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[{...source,id:'followup',timestamp:now}],Date.now()+1)!;
  assert.match(context,/Platform delivery failed and the message was not delivered/);assert.match(context,/Wait for an explicit user retry request/);assert.doesNotMatch(context,/queue will continue|automatically retry/);
});


test('failed progress never enters model failure context or masks a failed result',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new SqlitePersistence(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};const binding=store.sessions.binding(scope);const now=Date.now();
  const source:InboundMessage={id:'task',scope,text:'处理任务',attachments:[],reply:{},timestamp:now-100};store.inbox.accept(source);
  store.deliveries.enqueue(binding,source.id,'progress:run:1',[{type:'text',text:'任务还在进行中'}],{},undefined,{runId:'run',generation:binding.generation,expiresAt:now+60000});
  const delivery=store.deliveries.deliveries()[0];store.deliveries.deliveryState(delivery,'unknown',undefined,'receipt lost');const followup={...source,id:'followup',text:'结果呢'};
  assert.equal(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup]),undefined);
  store.deliveries.deliveryState(delivery,'sent','receipt');store.failures.saveFailure('failed-result',{sessionId:binding.sessionId,scope:binding.key,state:'failed',stage:'delivery',sourceIds:[source.id],at:now,code:'RESULT_FAILED'});
  assert.match(recentFailureContext({failures:store.failures,deliveries:store.deliveries,inbox:store.inbox},binding,[followup])!,/delivery status is unconfirmed/);
});
