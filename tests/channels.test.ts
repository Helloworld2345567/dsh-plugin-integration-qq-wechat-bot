import {test} from 'node:test';import assert from 'node:assert/strict';import {randomBytes,createCipheriv} from 'node:crypto';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';
import {decryptBinding,qqInbound,qqGroupObservation,QQAdapter,qqChannel} from '../src/channels/qq.js';import {decodeMediaKey,weixinInbound,WeixinAdapter} from '../src/channels/weixin.js';import {botSchema} from '../src/core/types.js';
import {EventEmitter} from 'node:events';
const qq=botSchema.parse({id:'qq',name:'QQ',channel:'qq',accountId:'app'});const wx=botSchema.parse({id:'wx',name:'WX',channel:'weixin',accountId:'bot'});
test('QQ active automation delivery uses a durable sequence without an expired reply message ID',async()=>{
  const payloads:any[]=[];
  const adapter=new QQAdapter((async(url:string,init:any)=>{if(url.includes('getAppAccessToken'))return{access_token:'fixture',expires_in:3600};payloads.push(JSON.parse(init.body));return{id:'active-receipt'};}) as any);
  const reply=qqChannel(adapter).normalizeReply!({target:'owner',kind:'private'}).payload;
  const delivery:any={reply,index:0,output:{type:'text',text:'晚安'},replySequence:17};
  assert.equal(await adapter.send(qq,{accountId:'app',appSecret:'fixture'},delivery,undefined,new AbortController().signal),'active-receipt');
  assert.equal(payloads[0].msg_id,undefined);assert.equal(payloads[0].msg_seq,17);
  await adapter.send(qq,{accountId:'app',appSecret:'fixture'},delivery,undefined,new AbortController().signal);assert.deepEqual(payloads[1],payloads[0]);
});
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

test('QQ sends audio assets through the file upload path',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.codex','channel-audio-'));const path=join(dir,'voice.mp3');await writeFile(path,Buffer.from('ID3fixture'));
 const calls:any[]=[];const request:any=async(url:string,init:any)=>{calls.push({url,init});if(url.endsWith('getAppAccessToken'))return{access_token:'token',expires_in:7200};if(url.endsWith('/files'))return{file_info:'uploaded-audio'};if(url.endsWith('/messages'))return{id:'qq-receipt'};throw new Error(`unexpected ${url}`);};
 const delivery:any={id:'delivery-audio',output:{text:''},reply:{target:'alice',kind:'private',msgId:'inbound'},index:0,attempt:{number:1,phase:'prepare',assetId:'asset'}};const asset:any={id:'asset',scopeKey:'scope',name:'voice.mp3',mime:'audio/mpeg',path,size:9,kind:'audio',createdAt:Date.now()};
 try{const adapter=new QQAdapter(request);const receipt=await adapter.send(qq,{accountId:'app',appSecret:'secret'},delivery,asset,AbortSignal.timeout(1000));assert.equal(receipt,'qq-receipt');await adapter.send(qq,{accountId:'app',appSecret:'secret'},delivery,asset,AbortSignal.timeout(1000));const uploads=calls.filter(call=>call.url.endsWith('/files'));assert.equal(uploads.length,1);assert.equal(JSON.parse(uploads[0].init.body).file_type,3);const messages=calls.filter(call=>call.url.endsWith('/messages'));assert.equal(JSON.parse(messages[0].init.body).media.file_info,'uploaded-audio');assert.equal(JSON.parse(messages[1].init.body).media.file_info,'uploaded-audio');}finally{await rm(dir,{recursive:true,force:true});}
});

test('QQ recovery keeps the original message identity and sequence',async()=>{
 const calls:any[]=[];const request:any=async(url:string,init:any)=>{calls.push({url,init});if(url.endsWith('getAppAccessToken'))return{access_token:'token',expires_in:7200};if(url.endsWith('/messages'))return{id:'qq-receipt'};throw new Error(`unexpected ${url}`);};
 const delivery:any={id:'stable-delivery',output:{type:'text',text:'retry me'},reply:{target:'alice',kind:'private',msgId:'inbound-message'},index:4};
 const adapter=new QQAdapter(request);await adapter.send(qq,{accountId:'app',appSecret:'secret'},delivery,undefined,AbortSignal.timeout(1000));await adapter.send(qq,{accountId:'app',appSecret:'secret'},delivery,undefined,AbortSignal.timeout(1000));
 const payloads=calls.filter(call=>call.url.endsWith('/messages')).map(call=>JSON.parse(call.init.body));assert.equal(payloads.length,2);assert.deepEqual(payloads.map((payload:any)=>({msg_id:payload.msg_id,msg_seq:payload.msg_seq})),[{msg_id:'inbound-message',msg_seq:5},{msg_id:'inbound-message',msg_seq:5}]);
});

test('WeChat sends audio assets as playable file items with media_type 3',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.codex','channel-audio-'));const path=join(dir,'voice.mp3');await writeFile(path,Buffer.from('ID3fixture'));
 const calls:any[]=[];const fetcher:any=async(url:string,init:any)=>{if(url.includes('/upload')){calls.push({url,body:undefined});return new Response('',{status:200,headers:{'x-encrypted-param':'uploaded-audio'}});}const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({url,body});if(url.includes('getuploadurl'))return new Response(JSON.stringify({upload_full_url:'https://novac2c.cdn.weixin.qq.com/upload?fixture=1'}),{status:200});if(url.includes('/sendmessage'))return new Response(JSON.stringify({ret:0,message_id:'wx-receipt'}),{status:200});throw new Error(`unexpected ${url}`);};
 const delivery:any={id:'delivery-audio',output:{text:''},reply:{target:'alice',contextToken:'ctx'},index:0,attempt:{number:1,phase:'prepare',assetId:'asset'}};const asset:any={id:'asset',scopeKey:'scope',name:'voice.mp3',mime:'audio/mpeg',path,size:10,kind:'audio',createdAt:Date.now()};
 try{const adapter=new WeixinAdapter({read:()=>undefined,write:()=>{}},undefined,fetcher);const receipt=await adapter.send(wx,{accountId:'bot',token:'token'},delivery,asset,AbortSignal.timeout(1000));assert.equal(receipt,'wx-receipt');await adapter.send(wx,{accountId:'bot',token:'token'},delivery,asset,AbortSignal.timeout(1000));const uploads=calls.filter(call=>call.url.includes('getuploadurl'));assert.equal(uploads.length,1);assert.equal(uploads[0].body.media_type,3);const messages=calls.filter(call=>call.url.includes('/sendmessage'));assert.equal(messages.length,2);const item=messages[0].body.msg.item_list[0];assert.equal(item.type,4);assert.equal(item.file_item.file_name,'voice.mp3');assert.equal(item.file_item.len,String(asset.size));assert.deepEqual(messages.map(message=>message.body.msg.client_id),['delivery-audio','delivery-audio']);}finally{await rm(dir,{recursive:true,force:true});}
});

test('QQ group membership distinguishes observed messages, joins and removals',()=>{
  assert.equal(qqGroupObservation(qq,{t:'GROUP_ADD_ROBOT',d:{group_openid:'room',group_name:'Room',timestamp:'2026-10-22T08:00:00+08:00'}})?.type,'group.joined');
  assert.equal(qqGroupObservation(qq,{t:'GROUP_DEL_ROBOT',d:{group_openid:'room'}})?.type,'group.left');
  assert.equal(qqGroupObservation(qq,{t:'GROUP_AT_MESSAGE_CREATE',d:{group_openid:'room'}})?.type,'group.observed');
  assert.equal(qqGroupObservation(qq,{t:'GROUP_ADD_ROBOT',d:{user_openid:'user'}}),undefined);
});
test('iLink remains connecting until a successful poll and stops after cancellation',async()=>{
  const states:string[]=[];let resolve!:(response:Response)=>void;const controller=new AbortController();
  const request=(async()=>new Promise<Response>(r=>{resolve=r;})) as typeof fetch;
  const adapter=new WeixinAdapter({read:()=>'',write:()=>{controller.abort();}},undefined,request);
  const running=adapter.connect(wx,{accountId:'wx'},async()=>{},controller.signal,state=>states.push(state));
  assert.deepEqual(states,['connecting']);resolve(new Response('{"ret":0,"get_updates_buf":"cursor"}'));await running;
  assert.deepEqual(states,['connecting','connected','stopped']);
});
test('QQ clears connected immediately on socket close before reconnect backoff',async()=>{
  const states:string[]=[];const controller=new AbortController();const socket=new EventEmitter() as any;socket.readyState=1;socket.send=()=>{};socket.terminate=()=>socket.emit('close');socket.close=()=>socket.emit('close');
  const adapter=new QQAdapter((async(url:string)=>url.includes('getAppAccessToken')?{access_token:'fixture',expires_in:7200}:{url:'wss://fixture.invalid'}) as any,undefined,()=>{queueMicrotask(()=>{socket.emit('message',JSON.stringify({t:'READY',d:{session_id:'fixture'}}));socket.emit('close');});return socket;});
  await adapter.connect(qq,{accountId:'qq',appSecret:'fixture'},async()=>{},controller.signal,state=>{states.push(state);if(state==='reconnecting')controller.abort();});
  assert.deepEqual(states,['connecting','connected','reconnecting','stopped']);
});
test('QQ missed heartbeat ack invalidates an online connection',async()=>{
  const states:string[]=[];const controller=new AbortController();const socket=new EventEmitter() as any;socket.readyState=1;socket.send=()=>{};socket.terminate=()=>socket.emit('close');socket.close=()=>socket.emit('close');
  const adapter=new QQAdapter((async(url:string)=>url.includes('getAppAccessToken')?{access_token:'fixture',expires_in:7200}:{url:'wss://fixture.invalid'}) as any,undefined,()=>{queueMicrotask(()=>{socket.emit('message',JSON.stringify({op:10,d:{heartbeat_interval:5}}));socket.emit('message',JSON.stringify({t:'READY',d:{session_id:'fixture'}}));});return socket;});
  await adapter.connect(qq,{accountId:'qq',appSecret:'fixture'},async()=>{},controller.signal,state=>{states.push(state);if(state==='reconnecting')controller.abort();});
  assert.ok(states.includes('connected'));assert.equal(states.at(-2),'reconnecting');assert.equal(states.at(-1),'stopped');
});
