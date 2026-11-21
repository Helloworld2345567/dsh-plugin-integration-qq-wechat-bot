import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../../../src/infrastructure/sqlite/persistence.js';
import {QQAdapter,qqChannel} from '../../../src/channels/qq.js';
import {WeixinAdapter,weixinChannel} from '../../../src/channels/weixin.js';
import {botSchema,type Delivery} from '../../../src/core/types.js';

test('channel reply codecs accept legacy payloads, version envelopes and reject cross-channel data',()=>{
  const qq=qqChannel(new QQAdapter()),wx=weixinChannel(new WeixinAdapter({read:()=>'',write:()=>{}}));const legacy={target:'user',kind:'private',msgId:'message'};const envelope=qq.normalizeReply!(legacy);assert.deepEqual(envelope,{channelId:'qq',version:1,payload:legacy});assert.deepEqual(qq.normalizeReply!(envelope),envelope);assert.throws(()=>wx.normalizeReply!(envelope));assert.throws(()=>qq.normalizeReply!({channelId:'qq',version:2,payload:legacy}));
});
test('channel credential codecs preserve legacy JSON shape and validate account ownership',()=>{
  const qq=qqChannel(new QQAdapter()),wx=weixinChannel(new WeixinAdapter({read:()=>'',write:()=>{}}));assert.deepEqual(qq.normalizeCredential!({accountId:'app',appSecret:'secret'}),{accountId:'app',credential:{accountId:'app',appSecret:'secret'}});assert.equal(wx.normalizeCredential!({accountId:'bot',token:'token'}).accountId,'bot');assert.throws(()=>qq.normalizeCredential!({accountId:'app',token:'wrong'}));assert.throws(()=>wx.normalizeCredential!({accountId:'bot',token:'token',baseUrl:'https://attacker.invalid'}));
});
test('channel cursors persist independently for each channel and bot',async t=>{
  const home=await mkdtemp(path.resolve('.codex/channel-cursors-'));let store=new SqlitePersistence(home);
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  store.cursors.write('weixin','one','next');store.close();store=new SqlitePersistence(home);
  assert.equal(store.cursors.read('weixin','one'),'next');assert.equal(store.cursors.read('weixin','two'),undefined);assert.equal(store.cursors.read('qq','one'),undefined);
});
test('reply envelope survives durable delivery while legacy reply remains readable',async _t=>{
  const home=await mkdtemp(path.resolve('.codex/reply-envelope-'));let store=new SqlitePersistence(home);const scope={botId:'bot',platform:'qq',accountId:'app',kind:'private' as const,channelId:'user',senderId:'user'};store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'app'}));const binding=store.sessions.binding(scope);const legacy={target:'user',kind:'private',msgId:'source'};const envelope=qqChannel(new QQAdapter()).normalizeReply!(legacy);store.deliveries.enqueue(binding,'source','turn',[{type:'text',text:'hello'}],legacy,envelope);store.close();store=new SqlitePersistence(home);try{const delivery=store.deliveries.deliveries()[0] as Delivery;assert.deepEqual(delivery.reply,legacy);assert.deepEqual(delivery.replyEnvelope,envelope);}finally{store.close();await rm(home,{recursive:true,force:true});}
});
