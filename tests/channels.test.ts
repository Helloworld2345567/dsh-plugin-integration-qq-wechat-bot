import {test} from 'node:test';import assert from 'node:assert/strict';import {randomBytes,createCipheriv} from 'node:crypto';
import {decryptBinding,qqInbound,QQAdapter} from '../src/channels/qq.js';import {decodeMediaKey,weixinInbound,WeixinAdapter} from '../src/channels/weixin.js';import {botSchema} from '../src/core/types.js';
const qq=botSchema.parse({id:'qq',name:'QQ',channel:'qq',accountId:'app'});const wx=botSchema.parse({id:'wx',name:'WX',channel:'weixin',accountId:'bot'});
test('QQ QR secret requires authentic AES-GCM and never returns key to UI',async()=>{
 let key:Buffer;const request:any=async(url:string,init:any)=>{if(url.endsWith('create_bind_task')){key=Buffer.from(JSON.parse(init.body).key,'base64');return{data:{task_id:'ticket'}};}const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return{data:{status:2,bot_appid:'app',bot_encrypt_secret:Buffer.concat([iv,cipher.update('fixture-secret'),cipher.final(),cipher.getAuthTag()]).toString('base64')}};};
 const adapter=new QQAdapter(request);const begin=await adapter.beginLogin();assert.equal(begin.credential,undefined);assert.ok(begin.qr?.includes('ticket'));const result=await adapter.pollLogin(begin.ticket!);assert.equal(result.credential?.appSecret,'fixture-secret');assert.equal((await adapter.pollLogin(begin.ticket!)).status,'expired');assert.throws(()=>decryptBinding(randomBytes(40).toString('base64'),randomBytes(32).toString('base64')));
});
test('QQ group @ and private identities normalize without combining senders',()=>{
 const a=qqInbound(qq,{t:'GROUP_AT_MESSAGE_CREATE',d:{id:'m',content:'<@123> hello',group_openid:'room',author:{member_openid:'alice'},attachments:[{filename:'a.jpg',content_type:'image/jpeg',url:'//cdn.example/a'}]}})!;
 assert.equal(a.scope.kind,'group');assert.equal(a.scope.channelId,'room');assert.equal(a.scope.senderId,'alice');assert.equal(a.text,'hello');assert.equal(a.attachments[0].url,'https://cdn.example/a');assert.equal(qqInbound(qq,{t:'MESSAGE_CREATE',d:{}}),undefined);
});
test('QQ QR poll errors cannot confirm an account and platform expiry is explicit',async()=>{
  let response:any={retcode:1,data:{status:2,bot_appid:'spoofed'}};
  const adapter=new QQAdapter((async(url:string)=>url.endsWith('create_bind_task')?{data:{task_id:'ticket'}}:response) as any);
  await adapter.beginLogin();await assert.rejects(adapter.pollLogin('ticket'),/QQ_BINDING_REJECTED/);
  response={retcode:0,data:{status:3}};assert.equal((await adapter.pollLogin('ticket')).status,'expired');
  assert.equal((await adapter.pollLogin('ticket')).status,'expired');
});
test('iLink private media keys accept both official key encodings and retain transcript',()=>{
 const key=randomBytes(16);assert.deepEqual(decodeMediaKey(key.toString('base64')),key);assert.deepEqual(decodeMediaKey(Buffer.from(key.toString('hex')).toString('base64')),key);assert.throws(()=>decodeMediaKey('bad'));
 const data={message_type:1,message_id:'9223372036854775807',from_user_id:'alice',context_token:'ctx',item_list:[{type:1,text_item:{text:'hi'}},{type:3,voice_item:{text:'known transcript',media:{aes_key:key.toString('base64'),encrypt_query_param:'query'}}}]};const input=weixinInbound(wx,data)!;assert.equal(input.id,data.message_id);assert.equal(input.attachments[0].transcript,'known transcript');assert.equal(weixinInbound(wx,{...data,group_id:'group'}),undefined);
});
test('iLink QR states validate the returned official host before saving a credential',async()=>{
 const adapter=new WeixinAdapter({} as any,(async()=>({status:'confirmed',bot_token:'token',ilink_bot_id:'id',baseurl:'https://attacker.example'})) as any);await assert.rejects(adapter.pollLogin('ticket'),/INVALID_ILINK_HOST/);
 const denied=new WeixinAdapter({} as any,(async()=>({status:'denied'})) as any);assert.equal((await denied.pollLogin('ticket')).status,'denied');
});
test('iLink preserves uint64 receipt and recognizes explicit accepted ack without claiming a read receipt',async()=>{
 const delivery:any={id:'unique',output:{type:'text',text:'fixture'},reply:{contextToken:'ctx',target:'alice'}};
 const fake=(body:string)=>(async(_url:any,init:any)=>{assert.equal(init.headers['iLink-App-Id'],'bot');assert.equal(JSON.parse(init.body).msg.client_id,'unique');return new Response(body,{status:200});}) as typeof fetch;
 const a=new WeixinAdapter({} as any,undefined,fake('{"ret":0,"message_id":9223372036854775807}'));
 assert.equal(await a.send(wx,{accountId:'bot',token:'fixture'},delivery,undefined,AbortSignal.timeout(1000)),'9223372036854775807');
 const b=new WeixinAdapter({} as any,undefined,fake('{"ret":0}'));assert.equal(await b.send(wx,{accountId:'bot'},delivery,undefined,AbortSignal.timeout(1000)),'ilink-accepted:unique');
 const c=new WeixinAdapter({} as any,undefined,fake('{}'));await assert.rejects(c.send(wx,{accountId:'bot'},delivery,undefined,AbortSignal.timeout(1000)),/RECEIPT_MISSING/);
 for(const body of ['{"ret":-14,"errcode":0}','{"ret":0,"errcode":-14}']){const expired=new WeixinAdapter({} as any,undefined,fake(body));await assert.rejects(expired.send(wx,{accountId:'bot'},delivery,undefined,AbortSignal.timeout(1000)),/ILINK_AUTH_EXPIRED/);}
});
