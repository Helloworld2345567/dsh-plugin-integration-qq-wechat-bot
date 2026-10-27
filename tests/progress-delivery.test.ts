import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/core/store.js';
import {DurableDeliveryWorker} from '../src/core/delivery-worker.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import type {ChannelAdapter} from '../src/core/types.js';
import {QQAdapter} from '../src/channels/qq.js';
import {WeixinAdapter} from '../src/channels/weixin.js';

const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function fixture(t:any,send:ChannelAdapter['send']=async()=> 'receipt'){
  const home=await mkdtemp(path.resolve('.codex/progress-delivery-'));const store=new Store(home);
  store.saveBot({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true});
  const binding=store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.from(''),send};
  const channels=createChannelRegistry([{id:'qq',displayName:'QQ',adapter,capabilities:{conversations:['private'],login:[],groupSupport:'unsupported'}}]);
  const credentials={read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}};
  const worker=new DurableDeliveryWorker(store,channels,credentials);worker.registerProgress('run',()=>true);
  t.after(async()=>{await worker.close();store.close();await rm(home,{recursive:true,force:true});});
  const reply={target:'user',kind:'private',msgId:'message'};
  const progress=(sequence:number,expiresAt=Date.now()+60000)=>store.enqueue(binding,'source',`progress:run:${sequence}`,[{type:'text',text:`progress ${sequence}`}],reply,undefined,{runId:'run',generation:binding.generation,expiresAt});
  const final=()=>store.enqueue(binding,'source','final',[{type:'text',text:'final'}],reply);
  return{home,store,binding,worker,credentials,reply,progress,final};
}

test('progress batches and final output are independent, idempotent and share persisted QQ reply numbering',async t=>{
  const f=await fixture(t);f.progress(1);f.progress(1);f.progress(2);f.final();f.final();
  // A synthetic source can still refer to the same QQ message.
  f.store.enqueue(f.binding,'synthetic','another',[{type:'text',text:'later'}],f.reply);
  assert.deepEqual(f.store.deliveries().map(d=>d.replySequence),[1,2,3,4]);assert.equal(new Set(f.store.deliveries().map(d=>d.id)).size,4);
  await f.worker.flush();assert.equal(f.store.deliveries(['sent']).length,4);
  const last=f.store.deliveries().at(-1)!;f.store.deliveryState(last,'unknown');const retried=f.store.retryDelivery(last.id)!;assert.equal(retried.replySequence,4);await f.worker.flush();assert.equal(f.store.deliveries().at(-1)!.id,last.id);
  const reopened=new Store(f.home);try{reopened.enqueue(f.binding,'new-source','new-turn',[{type:'text',text:'next'}],f.reply);assert.equal(reopened.deliveries().at(-1)!.replySequence,5);}finally{reopened.close();}
});

test('legacy QQ rows seed new reply sequences without rewriting their retry identity',async t=>{
  const f=await fixture(t);f.final();const old=f.store.deliveries()[0];delete old.replySequence;old.index=6;
  f.store.db.prepare('UPDATE deliveries SET json=?,output_index=? WHERE id=?').run(JSON.stringify(old),6,old.id);
  f.store.db.prepare("DELETE FROM records WHERE kind='reply-sequence'").run();
  f.progress(1);assert.equal(f.store.deliveries().at(-1)!.replySequence,8);assert.equal(f.store.deliveries()[0].replySequence,undefined);
});

test('interim messages preserve the final text and attachment and isolate reply identities',async t=>{
  const f=await fixture(t);f.progress(1);await f.worker.flush();f.progress(2);await f.worker.flush();
  f.store.saveAsset({id:'generated-file',scopeKey:f.binding.key,sessionId:f.binding.sessionId,name:'result.txt',mime:'text/plain',path:path.join(f.home,'result.txt'),size:0,kind:'file',createdAt:Date.now()});
  f.store.enqueue(f.binding,'source','result-with-file',[{type:'text',text:'result'},{type:'asset',assetId:'generated-file'}],f.reply);await f.worker.flush();
  assert.deepEqual(f.store.deliveries(['sent']).map(d=>d.output.type),['text','text','text','asset']);assert.deepEqual(f.store.deliveries().map(d=>d.replySequence),[1,2,3,4]);
  f.store.enqueue(f.binding,'new-message','new-result',[{type:'text',text:'next'}],{...f.reply,msgId:'another-message'});assert.equal(f.store.deliveries().at(-1)!.replySequence,1);
});

test('expired, inactive and recovered progress cannot be sent or explicitly retried',async t=>{
  let sends=0;const f=await fixture(t,async()=>{sends++;return 'r';});f.progress(1,Date.now()-1);await f.worker.flush();assert.equal(sends,0);assert.equal(f.store.deliveries()[0].state,'cancelled');
  f.progress(2);f.worker.cancelProgress('run');await f.worker.flush();assert.equal(sends,0);
  f.progress(3);f.progress(4);const inFlight=f.store.deliveries().at(-1)!;f.store.deliveryState(inFlight,'sending');f.final();
  const reopened=new Store(f.home);try{reopened.recover();assert.equal(reopened.deliveries().find(d=>d.turnId==='progress:run:3')?.state,'cancelled');assert.equal(reopened.deliveries().find(d=>d.id===inFlight.id)?.state,'unknown');assert.throws(()=>reopened.retryDelivery(inFlight.id),/PROGRESS_DELIVERY_EXPIRED/);assert.equal(reopened.deliveries(['pending']).length,1);}finally{reopened.close();}
});

test('cancelling progress during credential lookup releases the lane for the final answer',async t=>{
  const sent:string[]=[];const f=await fixture(t,async(_b,_c,d)=>{sent.push(d.output.text!);return 'r';});let reads=0;
  f.credentials.read=async()=>{if(reads++===0)return new Promise(()=>{});return{accountId:'account'};};
  f.progress(1);const flushing=f.worker.flush();await settle();f.worker.cancelProgress('run');f.final();await flushing;
  assert.deepEqual(sent,['final']);assert.equal(f.store.deliveries()[0].state,'cancelled');
});

test('a stalled progress send times out at ten seconds and does not block or retry before the final answer',async t=>{
  let attempts=0,aborted=false;const f=await fixture(t,async(_b,_c,d,_a,signal)=>{if(d.purpose==='progress'){attempts++;signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});}return 'final receipt';});
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});f.progress(1);const flushing=f.worker.flush();await settle();f.final();
  t.mock.timers.tick(9999);await settle();assert.equal(f.store.deliveries(['sent']).length,0);t.mock.timers.tick(1);await flushing;
  assert.ok(aborted);assert.equal(attempts,1);assert.equal(f.store.deliveries()[0].state,'unknown');assert.equal(f.store.deliveries(['sent'])[0].output.text,'final');
});

test('network errors in a progress send do not use normal result auto-retries',async t=>{
  let calls=0;const f=await fixture(t,async(_b,_c,d)=>{calls++;if(d.purpose==='progress')throw Object.assign(new Error('offline'),{cause:{code:'ECONNREFUSED'}});return 'receipt';});f.progress(1);f.final();await f.worker.flush();assert.equal(calls,2);assert.equal(f.store.deliveries()[0].attempt?.number,1);assert.equal(f.store.deliveries(['sent']).length,1);
});

test('QQ uses the allocated sequence and Weixin preserves each notification client identity across retries',async t=>{
  const f=await fixture(t);f.progress(1);f.progress(2);f.final();const deliveries=f.store.deliveries();const sequences:number[]=[];
  const qq=new QQAdapter((async(url:string,init:any)=>{if(url.includes('getAppAccessToken'))return{access_token:'fixture',expires_in:7200};sequences.push(JSON.parse(init.body).msg_seq);return{id:'receipt'};}) as any);
  for(const delivery of [...deliveries,deliveries[1]])await qq.send(f.store.bot('bot'),{accountId:'account',appSecret:'fixture'},delivery,undefined,new AbortController().signal);
  assert.deepEqual(sequences,[1,2,3,2]);
  const ids:string[]=[];const wx=new WeixinAdapter({read:()=>'',write:()=>{}},undefined,(async(_url:any,init:any)=>{ids.push(JSON.parse(init.body).msg.client_id);return new Response('{"ret":0}');}) as typeof fetch);
  for(const delivery of [...deliveries,deliveries[1]])await wx.send(f.store.bot('bot'),{accountId:'account'},{...delivery,reply:{target:'user',contextToken:'fixture'}},undefined,new AbortController().signal);
  assert.equal(new Set(ids.slice(0,3)).size,3);assert.equal(ids[3],ids[1]);
});
