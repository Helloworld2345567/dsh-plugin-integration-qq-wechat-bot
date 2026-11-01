import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {qqInbound} from '../src/channels/qq.js';
import {weixinInbound} from '../src/channels/weixin.js';
import {Store,scopeKey} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {botSchema,type ChannelAdapter,type InboundMessage,type Delivery} from '../src/core/types.js';
import {fixtureChannels} from './test-channel.js';

async function fixture(t:any,channel:'qq'|'weixin'){
  const directory=await mkdtemp(path.resolve('.codex/inbound-voice-')),store=new Store(directory),assets=new Assets(store);
  const bot=store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel,accountId:'account',configId:'sakura',enabled:true}));
  const seen:InboundMessage[]=[],transcribed:string[]=[],materialized:InboundMessage['attachments'][number][]=[],sent:Delivery[]=[];
  const bytes=Buffer.from('received voice fixture');
  const harness:HarnessPort={run:async(_binding,messages,_signal,options)=>{seen.push(...messages);return{turnId:'reply',outputs:[{type:'text',text:'听到了'}],snapshot:options!.snapshot!};},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async input=>{materialized.push(input);return bytes;},send:async(_bot,_credential,delivery)=>{sent.push(delivery);return'receipt';}};
  const media=new MediaService(store,assets);media.run=async(key,operation,_config,inputs,_parameters,_signal,authorize)=>{
    assert.equal(operation,'transcribe');assert.equal(inputs.length,1);authorize?.();
    const asset=await assets.resolve(key,inputs[0]);assert.equal(asset.kind,'audio');assert.deepEqual(await assets.read(key,asset.id),bytes);
    transcribed.push(asset.id);return{text:JSON.stringify({transcript:'你好，请问现在几点？'}),assetIds:[]};
  };
  const runtime=new BotRuntime(store,assets,media,harness,fixtureChannels(adapter),{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},60000);
  t.after(async()=>{await runtime.close();store.close();await rm(directory,{recursive:true,force:true});});
  const receive=async(message:InboundMessage)=>{await runtime.receive(message);assert.equal(store.messages(scopeKey(message.scope)).length,1,'voice-only messages must be queued for immediate processing');await runtime.process(scopeKey(message.scope));};
  return{store,bot,seen,transcribed,materialized,sent,receive};
}

test('QQ voice-only messages reach automatic ASR and pass their transcript to the chat model',async t=>{
  const f=await fixture(t,'qq');
  const message=qqInbound(f.bot,{t:'C2C_MESSAGE_CREATE',d:{id:'voice',content:'',author:{user_openid:'owner'},attachments:[{filename:'voice.amr',content_type:'voice',url:'https://multimedia.nt.qq.com.cn/voice.amr'}]}})!;
  await f.receive(message);
  assert.equal(f.materialized.length,1);assert.equal(f.transcribed.length,1);assert.equal(f.seen.length,1);
  assert.equal(f.seen[0].text,'');assert.equal(f.seen[0].attachments[0].transcript,'你好，请问现在几点？');
  assert.equal(f.seen[0].attachments[0].handle,f.transcribed[0]);assert.equal(f.store.source(scopeKey(message.scope),message.id)?.attachments[0].handle,f.transcribed[0]);
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].output.text,'听到了');
});

test('WeChat voice-only messages use an existing platform transcript without another ASR call',async t=>{
  const f=await fixture(t,'weixin');
  const message=weixinInbound(f.bot,{message_type:1,message_id:'voice',from_user_id:'owner',context_token:'context',item_list:[{type:3,voice_item:{text:'这是平台已经识别出的原话。',media:{encrypt_query_param:'fixture'}}}]})!;
  await f.receive(message);
  assert.equal(f.materialized.length,1);assert.deepEqual(f.transcribed,[]);assert.equal(f.seen.length,1);
  assert.equal(f.seen[0].attachments[0].transcript,'这是平台已经识别出的原话。');assert.ok(f.seen[0].attachments[0].handle);
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].output.text,'听到了');
});
