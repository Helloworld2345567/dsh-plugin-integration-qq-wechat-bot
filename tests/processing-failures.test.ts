import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store,scopeKey} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {botSchema,type CallerScope,type InboundMessage,type ChannelAdapter} from '../src/core/types.js';
import {recentFailureContext} from '../src/core/failure-context.js';
import {freezeTurn} from '../src/core/policy.js';

test('attachment download failure sends an explicit durable failure instead of silently losing the edit request',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new Store(root);const sent:string[]=[];let calls=0;
  store.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};
  const message:InboundMessage={id:'new-reference',scope,text:'参考此图生成图片，将人物换成你',attachments:[{kind:'image',name:'reference.jpg',mime:'image/jpeg',url:'https://example.invalid/image'}],reply:{target:'alice'},timestamp:Date.now()};
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>{throw Error('Invalid IP address: undefined');},send:async(_bot,_credential,delivery)=>{sent.push(delivery.output.text!);return'receipt';}};
  const harness:HarnessPort={run:async()=>{calls++;throw Error('model must not run');},cancel:()=>{},dispose:async()=>{},validateModel:async()=>{}};
  const assets=new Assets(store);const runtime=new BotRuntime(store,assets,new MediaService(store,assets),harness,{qq:adapter,weixin:adapter},{read:async()=>({accountId:'one'}),write:async()=>{},remove:async()=>{}},60000);
  t.after(async()=>{await runtime.close();store.close();await rm(root,{recursive:true,force:true});});
  await runtime.receive(message);await runtime.process(scopeKey(scope));
  assert.equal(calls,0);assert.equal(sent.length,1,'the failed image request must not disappear without feedback');
  assert.match(sent[0],/图片.*未送入模型/);assert.match(sent[0],/没有生成新图/);
  assert.equal(store.deliveries(['sent'])[0].sourceId,message.id);
  const failure=store.list<any>('failure')[0];assert.equal(failure.stage,'attachments');assert.deepEqual(failure.sourceIds,[message.id]);
  const followup={...message,id:'followup',text:'调用失败了吗',attachments:[],timestamp:failure.at+1};
  const binding=store.binding(scope);const context=recentFailureContext(store,binding,[followup]);assert.match(context!,/未生成新图片/);assert.match(context!,/参考此图/);
  assert.equal(recentFailureContext(store,{...binding,sessionId:'different-session'},[followup]),undefined);
  assert.equal(recentFailureContext(store,{...binding,key:'different-scope'},[followup]),undefined);
  assert.equal(recentFailureContext(store,binding,[followup],failure.at+600001),undefined);
  await runtime.receive(message);await runtime.process(scopeKey(scope));assert.equal(sent.length,1,'duplicate platform event cannot duplicate failure feedback');
});

test('model provider failures preserve an actionable error code in the user-facing failure',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new Store(root);const sent:string[]=[];
  store.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};
  const message:InboundMessage={id:'model-failure',scope,text:'为什么没有回复',attachments:[],reply:{target:'alice'},timestamp:Date.now()};
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.from(''),send:async(_bot,_credential,delivery)=>{sent.push(delivery.output.text!);return'receipt';}};
  const harness:HarnessPort={run:async()=>{throw Error('INVALID_REQUEST: upstream model rejected the request');},cancel:()=>{},dispose:async()=>{},validateModel:async()=>{}};
  const assets=new Assets(store);const runtime=new BotRuntime(store,assets,new MediaService(store,assets),harness,{qq:adapter,weixin:adapter},{read:async()=>({accountId:'one'}),write:async()=>{},remove:async()=>{}},0);
  t.after(async()=>{await runtime.close();store.close();await rm(root,{recursive:true,force:true});});
  await runtime.receive(message);await runtime.process(scopeKey(scope));
  assert.equal(sent.length,1);assert.match(sent[0],/模型请求失败/);assert.match(sent[0],/INVALID_REQUEST/);assert.match(sent[0],/重置模型/);
  assert.equal(store.list<any>('failure')[0].code,'INVALID_REQUEST: upstream model rejected the request');
});

test('another bot credential failure cannot relabel a completed request or its accepted delivery',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new Store(root);const assets=new Assets(store);
  for(const id of ['good','bad'])store.saveBot(botSchema.parse({id,name:id,channel:'qq',accountId:id,enabled:true}));
  const scope:CallerScope={botId:'good',platform:'qq',accountId:'good',kind:'private',channelId:'alice',senderId:'alice'};
  const other=store.binding({...scope,botId:'bad',accountId:'bad'});store.enqueue(other,'other-request','other-turn',[{type:'text',text:'other reply'},{type:'text',text:'later chunk'}],{});
  const message:InboundMessage={id:'successful-request',scope,text:'answer this request',attachments:[],reply:{},timestamp:Date.now()};
  let acceptOwn!:()=>void;const ownAccepted=new Promise<void>(resolve=>acceptOwn=resolve);const sent:string[]=[];
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>{throw Error('unused');},send:async(bot)=>{sent.push(bot.id);acceptOwn();return'accepted-receipt';}};
  const harness:HarnessPort={run:async(binding,messages)=>({turnId:'successful-turn',outputs:[{type:'text',text:'accepted reply'}],snapshot:freezeTurn(store.effectiveConfig(binding),store.bot('good'),scope,messages.map(m=>m.id))}),cancel:()=>{},dispose:async()=>{},validateModel:async()=>{}};
  const runtime=new BotRuntime(store,assets,new MediaService(store,assets),harness,{qq:adapter,weixin:adapter},{read:async id=>{if(id==='bad'){await ownAccepted;await new Promise<void>(resolve=>setImmediate(resolve));throw Error('OTHER_BOT_CREDENTIAL_FAILURE');}return{accountId:id};},write:async()=>{},remove:async()=>{}},60000);
  t.after(async()=>{await runtime.close();store.close();await rm(root,{recursive:true,force:true});});
  await runtime.receive(message);await runtime.process(scopeKey(scope));
  assert.deepEqual(sent,['good']);assert.equal(store.deliveries(['sent'])[0].receipt,'accepted-receipt');
  assert.deepEqual(store.messages(scopeKey(scope),['complete']).map(m=>m.id),[message.id],'accepted result must retain its completed request');
  assert.equal(store.list<any>('failure').filter(f=>f.sessionId===store.binding(scope).sessionId).length,0);
  const rejected=store.deliveries().find(d=>d.botId==='bad')!;assert.equal(rejected.state,'failed');assert.equal(rejected.error,'OTHER_BOT_CREDENTIAL_FAILURE');
  assert.deepEqual(store.deliveries().filter(d=>d.botId==='bad').map(d=>d.state),['failed','failed'],'later chunks proceed after a failed delivery without relabelling the accepted request');
  assert.equal(recentFailureContext(store,store.binding(scope),[{...message,id:'followup',timestamp:Date.now()+1}]),undefined);
});

test('a queued followup sees failures recorded after its arrival and current request IDs are excluded',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new Store(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};const binding=store.binding(scope);const now=Date.now();
  const photo:InboundMessage={id:'photo',scope,text:'edit my photo',attachments:[],reply:{},timestamp:now-300};store.accept(photo);
  store.put('failure','photo-failure',{sessionId:binding.sessionId,scope:binding.key,state:'failed',stage:'attachments',sourceIds:[photo.id],at:now-100,code:'DOWNLOAD_FAILED'});
  const followup={...photo,id:'queued-followup',text:'was it generated?',timestamp:now-200};
  assert.match(recentFailureContext(store,binding,[followup],now)!,/edit my photo/);
  assert.equal(recentFailureContext(store,binding,[photo],now),undefined,'a current request cannot also be represented as a prior failed request');
  assert.equal(recentFailureContext(store,binding,[followup],now+600001),undefined);
});

test('historical delivery failure context yields to accepted outputs but not to a sent failure notice',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new Store(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};const binding=store.binding(scope);const now=Date.now();
  const source:InboundMessage={id:'original',scope,text:'original request',attachments:[],reply:{},timestamp:now-200};store.accept(source);
  const failure={sessionId:binding.sessionId,scope:binding.key,state:'failed',stage:'delivery',sourceIds:[source.id],at:now-100,code:'FLUSH_FAILED'};store.put('failure','historical',failure);
  const followup={...source,id:'followup',timestamp:now};
  store.enqueue(binding,source.id,'failure:original',[{type:'text',text:'could not process'}],{});store.deliveryState(store.deliveries()[0],'sent','failure-receipt');
  assert.match(recentFailureContext(store,binding,[followup],now)!,/发送状态未确认/);
  store.enqueue(binding,source.id,'model-turn',[{type:'text',text:'result'},{type:'text',text:'second chunk'}],{});const [output,second]=store.deliveries(['pending']);
  assert.match(recentFailureContext(store,binding,[followup],now)!,/发送状态未确认/);
  store.deliveryState(output,'sent','result-receipt');assert.match(recentFailureContext(store,binding,[followup],now)!,/发送状态未确认/,'a partial send cannot supersede a delivery failure');
  store.deliveryState(second,'sent','second-receipt');assert.equal(recentFailureContext(store,binding,[followup],now),undefined,'successful original output supersedes stale delivery failure');
});

test('unknown delivery state is visible to the next turn without triggering an automatic resend',async t=>{
  const root=await mkdtemp(path.resolve('.codex/process-failure-'));const store=new Store(root);
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  store.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true}));
  const scope:CallerScope={botId:'one',platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'};const binding=store.binding(scope);const now=Date.now();
  const source:InboundMessage={id:'unknown-image',scope,text:'生成一张图片',attachments:[],reply:{},timestamp:now-100};store.accept(source);
  store.enqueue(binding,source.id,'image-turn',[{type:'asset',assetId:'asset-one'}],{});const delivery=store.deliveries()[0];store.deliveryState(delivery,'unknown',undefined,'receipt lost');
  const followup={...source,id:'ask-status',text:'图片发来了吗',timestamp:now};const context=recentFailureContext(store,binding,[followup],Date.now()+1);
  assert.match(context!,/平台投递状态未知/);assert.match(context!,/asset-one/);assert.match(context!,/不要因状态未知自动重发/);
});
