import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/infrastructure/sqlite/store.js';
import {DurableDeliveryWorker} from '../src/core/delivery-worker.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import type {ChannelAdapter} from '../src/core/types.js';
import {RemoteError} from '../src/core/network.js';

const adapter=(send:ChannelAdapter['send']):ChannelAdapter=>({beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.from(''),send});
async function fixture(t:any,send:ChannelAdapter['send']){const home=await mkdtemp(path.resolve('.codex/delivery-worker-'));const store=new Store(home);const channel=createChannelRegistry([{id:'qq',displayName:'QQ',adapter:adapter(send),capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}}]);store.saveBot({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true});t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});return{store,channel};}
test('worker preserves per-bot lane and drains rows appended during flush',async t=>{let count=0;const f=await fixture(t,async()=>{count++;return`r${count}`});const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});f.store.enqueue(binding,'one','turn',[{type:'text',text:'one'}],{target:'user'});const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}});await worker.flush();f.store.enqueue(binding,'two','turn2',[{type:'text',text:'two'}],{target:'user'});await worker.flush();assert.equal(count,2);assert.equal(worker.activity().activeLanes,0);});
test('worker cancellation before commit fails the attempt without automatically replaying it',async t=>{let aborted=false;const f=await fixture(t,async(_bot,_credential,_delivery,_asset,signal)=>{await new Promise<void>(resolve=>{signal.addEventListener('abort',()=>{aborted=true;resolve();},{once:true});});throw Error('cancelled');});const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});f.store.enqueue(binding,'one','turn',[{type:'text',text:'one'}],{target:'user'});const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}});const flushing=worker.flush();await new Promise(resolve=>setImmediate(resolve));worker.cancelScope(binding.key);await flushing;assert.equal(aborted,true);assert.equal(f.store.deliveries()[0].state,'failed');});
test('explicit retry preserves delivery identity and records a new attempt',async t=>{
  let calls=0;const f=await fixture(t,async(_bot,_credential,delivery)=>{calls++;delivery.attempt!.phase='commit';assert.equal(delivery.id,f.store.deliveries()[0].id);throw Error(`lost-${calls}`);});
  const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});f.store.enqueue(binding,'one','turn',[{type:'text',text:'one'}],{target:'user'});const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}});
  await worker.flush();const first=f.store.deliveries()[0];assert.equal(first.state,'unknown');assert.equal(first.attempt?.number,1);assert.equal(first.attempt?.lastError,'lost-1');const retried=f.store.retryDelivery(first.id);assert.equal(retried?.id,first.id);await worker.flush();const second=f.store.deliveries()[0];assert.equal(second.state,'unknown');assert.equal(second.id,first.id);assert.equal(second.attempt?.number,2);assert.equal(calls,2);
});
test('pre-commit network failures retain cause code and retry at most twice',async t=>{
  let calls=0;const f=await fixture(t,async()=>{calls++;const cause=Object.assign(new Error('connection refused'),{code:'ECONNREFUSED'});throw Object.assign(new TypeError('fetch failed'),{cause});});
  const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});f.store.enqueue(binding,'one','turn',[{type:'text',text:'one'}],{target:'user'});
  const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},async()=>{});await worker.flush();
  const delivery=f.store.deliveries()[0];assert.equal(delivery.state,'failed');assert.equal(calls,3);assert.equal(delivery.attempt?.autoRetryCount,2);assert.equal(delivery.attempt?.causeCode,'ECONNREFUSED');assert.match(delivery.attempt?.lastError??'',/cause\.code=ECONNREFUSED/);
});
test('commit-phase network failures remain unknown and are never auto-retried',async t=>{
  let calls=0;const f=await fixture(t,async(_bot,_credential,delivery)=>{calls++;delivery.attempt!.phase='commit';const cause=Object.assign(new Error('connection reset'),{code:'ECONNRESET'});throw Object.assign(new TypeError('fetch failed'),{cause});});
  const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});f.store.enqueue(binding,'one','turn',[{type:'text',text:'one'}],{target:'user'});
  const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},async()=>{});await worker.flush();
  const delivery=f.store.deliveries()[0];assert.equal(delivery.state,'unknown');assert.equal(calls,1);assert.equal(delivery.attempt?.autoRetryCount,undefined);assert.equal(delivery.attempt?.causeCode,'ECONNRESET');assert.match(delivery.error??'',/cause\.code=ECONNRESET/);
});
test('commit-phase connection refusal is confirmed undelivered and retries automatically',async t=>{
  let calls=0;const f=await fixture(t,async(_bot,_credential,delivery)=>{calls++;delivery.attempt!.phase='commit';if(calls<3){const cause=Object.assign(new Error('connection refused'),{code:'ECONNREFUSED'});throw Object.assign(new TypeError('fetch failed'),{cause});}return'receipt';});
  const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});f.store.enqueue(binding,'one','turn',[{type:'text',text:'one'}],{target:'user'});
  const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},async()=>{});await worker.flush();
  const delivery=f.store.deliveries()[0];assert.equal(delivery.state,'sent');assert.equal(calls,3);assert.equal(delivery.attempt?.autoRetryCount,2);assert.equal(delivery.attempt?.causeCode,'ECONNREFUSED');
});

test('QQ upload HTTP 400 stays failed across recovery with safe provider diagnostics',async t=>{
  let calls=0;const f=await fixture(t,async(_bot,_credential,delivery)=>{calls++;delivery.attempt!.phase='upload';throw new RemoteError('REMOTE_REQUEST_FAILED',400,undefined,undefined,{platformCode:400100,platformMessage:'file too large https://signed.example/private?token=secret',platformTraceId:'trace-400'});});
  const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});f.store.enqueue(binding,'one','turn',[{type:'text',text:'one'}],{target:'user'});
  const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},async()=>{});await worker.flush();
  const delivery=f.store.deliveries()[0];assert.equal(calls,1);assert.equal(delivery.state,'failed');assert.equal(delivery.attempt?.httpStatus,400);assert.equal(delivery.attempt?.platformCode,'400100');assert.equal(delivery.attempt?.platformTraceId,'trace-400');assert.match(delivery.attempt?.platformMessage??'',/file too large/);assert.doesNotMatch(JSON.stringify(delivery),/signed\.example|token=secret/);
  const recovered=new Store(f.store.home);try{recovered.recover();assert.equal(recovered.deliveries()[0].state,'failed');}finally{recovered.close();}
  await worker.flush();assert.equal(calls,1);
});

test('explicit commit rejection fails while timeout conflict and server errors stay unknown',async t=>{
  for(const [status,expected] of [[400,'failed'],[403,'failed'],[429,'failed'],[408,'unknown'],[409,'unknown'],[503,'unknown']] as const){
    let calls=0;const f=await fixture(t,async(_bot,_credential,delivery)=>{calls++;delivery.attempt!.phase='commit';throw new RemoteError('REMOTE_REQUEST_FAILED',status);});
    const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});f.store.enqueue(binding,'one','turn',[{type:'text',text:'one'}],{target:'user'});
    const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},async()=>{});await worker.flush();assert.equal(f.store.deliveries()[0].state,expected,String(status));assert.equal(calls,1);
  }
});

test('manual recovery preserves identity and refreshes the bounded safe transport retry budget',async t=>{
  let calls=0;const f=await fixture(t,async(_bot,_credential,delivery)=>{calls++;delivery.attempt!.phase='upload';if(calls<5)throw new RemoteError('REMOTE_NETWORK_FAILED',undefined,'ECONNREFUSED');return'receipt';});
  const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});f.store.enqueue(binding,'one','turn',[{type:'text',text:'one'}],{target:'user'});
  const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},async()=>{});await worker.flush();const failed=f.store.deliveries()[0];assert.equal(failed.state,'failed');assert.equal(calls,3);
  await worker.retry(failed.id);const delivered=f.store.deliveries()[0];assert.equal(delivered.id,failed.id);assert.equal(delivered.state,'sent');assert.equal(delivered.attempt?.number,5);assert.equal(delivered.attempt?.autoRetryCount,1);assert.equal(calls,5);
});

test('QQ business rejections can fail with HTTP 200 while provider timeouts remain unknown',async t=>{
  for(const [status,code,expected] of [[200,'850031','failed'],[200,'850019','failed'],[200,'850027','unknown'],[400,'850027','unknown'],[200,'undocumented','unknown']] as const){
    const f=await fixture(t,async(_bot,_credential,delivery)=>{delivery.attempt!.phase='commit';throw new RemoteError('QQ_API_REJECTED',status,undefined,undefined,{platformCode:code});});
    const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});f.store.enqueue(binding,'one','turn',[{type:'text',text:'one'}],{target:'user'});
    const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},async()=>{});await worker.flush();assert.equal(f.store.deliveries()[0].state,expected,`${status}/${code}`);
  }
});

test('cancellation during a safe retry delay does not leave the delivery sending or resend it',async t=>{
  let calls=0;const f=await fixture(t,async(_bot,_credential,delivery)=>{calls++;delivery.attempt!.phase='upload';throw new RemoteError('REMOTE_REQUEST_FAILED',503);});
  const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});f.store.enqueue(binding,'one','turn',[{type:'text',text:'one'}],{target:'user'});
  const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},async()=>{throw Error('cancelled');});await worker.flush();assert.equal(f.store.deliveries()[0].state,'failed');assert.equal(calls,1);
});

test('multipart media can finish after 90 seconds while retaining cancellation and a bounded deadline',async t=>{
  const timeouts:{due:number;controller:AbortController}[]=[];
  t.mock.method(AbortSignal,'timeout',(milliseconds:number)=>{const controller=new AbortController();timeouts.push({due:milliseconds,controller});return controller.signal;});
  const f=await fixture(t,async(_bot,_credential,delivery,_asset,signal)=>{
    delivery.attempt!.phase='upload';
    for(const timer of timeouts)if(timer.due<=120_000)timer.controller.abort();
    signal.throwIfAborted();
    assert.ok(timeouts.some(timer=>timer.due>120_000&&timer.due<=15*60_000));
    delivery.attempt!.phase='commit';return 'large-file-receipt';
  });
  const binding=f.store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});
  f.store.saveAsset({id:'long-wav',scopeKey:binding.key,sessionId:binding.sessionId,name:'voice.wav',kind:'audio',mime:'audio/wav',path:'fixture.wav',size:15_160_364,createdAt:0});
  f.store.enqueue(binding,'long-voice','turn',[{type:'asset',assetId:'long-wav'}],{target:'user'});
  const worker=new DurableDeliveryWorker(f.store.repositories(),f.channel,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}});
  await worker.flush();assert.equal(f.store.deliveries()[0].state,'sent');assert.equal(f.store.deliveries()[0].receipt,'large-file-receipt');
});
