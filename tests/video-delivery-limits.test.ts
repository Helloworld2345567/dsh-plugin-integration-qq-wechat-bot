import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createCipheriv} from 'node:crypto';
import {QQAdapter} from '../src/channels/qq.js';
import {WeixinAdapter} from '../src/channels/weixin.js';
import {botSchema,type Asset,type Delivery,type MediaInput} from '../src/core/types.js';

const MiB=1024*1024;
const bot=botSchema.parse({id:'fixture',name:'Fixture',channel:'qq',accountId:'app'});
const asset=(size:number,file:string,kind:Asset['kind']='video'):Asset=>({id:'video',scopeKey:'scope',name:'clip.mp4',mime:'video/mp4',path:file,size,kind,createdAt:0});
const delivery=():Delivery=>({id:'delivery-video',scopeKey:'scope',botId:bot.id,sessionId:'session',sourceId:'inbound',turnId:'turn',index:0,output:{type:'asset',assetId:'video'},reply:{target:'owner',kind:'private',msgId:'inbound',contextToken:'context'},state:'pending'});
async function fixture(run:(file:string,folder:string)=>Promise<void>):Promise<void>{
  const base=process.env.BOT_TEST_TMP??path.resolve('.codex');await mkdir(base,{recursive:true});
  const folder=await mkdtemp(path.join(base,'video-delivery-'));const file=path.join(folder,'clip.mp4');
  try{await writeFile(file,'small-video-fixture');await run(file,folder);}finally{await rm(folder,{recursive:true,force:true});}
}

test('QQ uploads videos up to 200 MiB metadata and retains 20 MiB for other attachments',async()=>{
  await fixture(async file=>{
    const uploads:any[]=[];const messages:any[]=[];
    const request:any=async(url:string,init:any)=>{
      if(url.endsWith('getAppAccessToken'))return{access_token:'fixture',expires_in:3600};
      if(url.endsWith('/files')){uploads.push(JSON.parse(init.body));return{file_info:'uploaded-video'};}
      if(url.endsWith('/messages')){messages.push(JSON.parse(init.body));return{id:'video-receipt'};}
      throw Error(`Unexpected request: ${url}`);
    };
    const adapter=new QQAdapter(request);const signal=new AbortController().signal;
    for(const size of [20*MiB+1,200*MiB])assert.equal(await adapter.send(bot,{accountId:'app',appSecret:'fixture'},delivery(),asset(size,file),signal),'video-receipt');
    assert.equal(uploads.length,2);assert.ok(uploads.every(item=>item.file_type===2));
    assert.ok(messages.every(item=>item.msg_type===7&&item.media.file_info==='uploaded-video'));
    await assert.rejects(adapter.send(bot,{accountId:'app',appSecret:'fixture'},delivery(),asset(200*MiB+1,'missing-video.mp4'),signal),/QQ_OUTPUT_TOO_LARGE/);
    for(const kind of ['image','audio','file'] as const)await assert.rejects(adapter.send(bot,{accountId:'app',appSecret:'fixture'},delivery(),asset(20*MiB+1,file,kind),signal),/QQ_OUTPUT_TOO_LARGE/);
    assert.equal(uploads.length,2);assert.equal(messages.length,2);
  });
});

test('WeChat uploads videos up to 200 MiB metadata and retains 20 MiB for other attachments',async()=>{
  await fixture(async file=>{
    const uploads:any[]=[];const messages:any[]=[];let cdnUploads=0;
    const fetcher:any=async(url:string,init:any)=>{
      if(url.includes('getuploadurl')){uploads.push(JSON.parse(init.body));return Response.json({upload_full_url:'https://novac2c.cdn.weixin.qq.com/upload?fixture=1'});}
      if(url.includes('/upload')){cdnUploads++;return new Response('',{headers:{'x-encrypted-param':'uploaded-video'}});}
      if(url.includes('/sendmessage')){messages.push(JSON.parse(init.body));return Response.json({ret:0,message_id:'video-receipt'});}
      throw Error(`Unexpected request: ${url}`);
    };
    const adapter=new WeixinAdapter({read:()=>undefined,write:()=>{}},undefined,fetcher);const signal=new AbortController().signal;
    for(const size of [20*MiB+1,200*MiB])assert.equal(await adapter.send(bot,{accountId:'app',token:'fixture'},delivery(),asset(size,file),signal),'video-receipt');
    assert.equal(uploads.length,2);assert.ok(uploads.every(item=>item.media_type===2));assert.equal(cdnUploads,2);
    assert.ok(messages.every(item=>item.msg.item_list[0].type===5&&item.msg.item_list[0].video_item.media.encrypt_query_param==='uploaded-video'));
    await assert.rejects(adapter.send(bot,{accountId:'app',token:'fixture'},delivery(),asset(200*MiB+1,'missing-video.mp4'),signal),/ILINK_OUTPUT_TOO_LARGE/);
    for(const kind of ['image','audio','file'] as const)await assert.rejects(adapter.send(bot,{accountId:'app',token:'fixture'},delivery(),asset(20*MiB+1,file,kind),signal),/ILINK_OUTPUT_TOO_LARGE/);
    assert.equal(uploads.length,2);assert.equal(messages.length,2);assert.equal(cdnUploads,2);
  });
});

test('WeChat accepts actual video bytes above 20 MiB while rejecting those bytes as a file',async()=>{
  await fixture(async(file)=>{
    const size=20*MiB+1;await writeFile(file,Buffer.alloc(size));let uploadedBytes=0;let messages=0;
    const fetcher:any=async(url:string,init:any)=>{
      if(url.includes('getuploadurl')){assert.equal(JSON.parse(init.body).rawsize,size);return Response.json({upload_full_url:'https://novac2c.cdn.weixin.qq.com/upload?fixture=1'});}
      if(url.includes('/upload')){uploadedBytes=init.body.length;return new Response('',{headers:{'x-encrypted-param':'uploaded-video'}});}
      if(url.includes('/sendmessage')){messages++;return Response.json({ret:0,message_id:'video-receipt'});}
      throw Error(`Unexpected request: ${url}`);
    };
    const adapter=new WeixinAdapter({read:()=>undefined,write:()=>{}},undefined,fetcher);const signal=new AbortController().signal;
    assert.equal(await adapter.send(bot,{accountId:'app',token:'fixture'},delivery(),asset(size,file),signal),'video-receipt');
    assert.ok(uploadedBytes>size);assert.equal(messages,1);
    // Check the actual byte guard as well as the stored asset-size guard.
    await assert.rejects(adapter.send(bot,{accountId:'app',token:'fixture'},delivery(),asset(1,file,'file'),signal),/ILINK_OUTPUT_TOO_LARGE/);
    assert.equal(messages,1);
  });
});

test('platform downloads allow 500 MiB video metadata and retain 50 MiB for other attachments',async t=>{
  let declaredSize=50*MiB+1;
  const lookup=mock.method(dns,'lookup',(async()=>[{address:'1.1.1.1',family:4}]) as any);syncBuiltinESMExports();
  const get=mock.method(https,'get',((_url:URL,_options:any,receive:(response:any)=>void)=>{
    const request=new EventEmitter();queueMicrotask(()=>{
      const response=new PassThrough() as any;response.statusCode=200;response.headers={'content-length':declaredSize};
      receive(response);response.end(Buffer.from('video-fixture'));
    });return request;
  }) as any);
  t.after(()=>{get.mock.restore();lookup.mock.restore();syncBuiltinESMExports();});
  const fixtures=[
    {adapter:new QQAdapter(),input:{name:'clip.mp4',mime:'video/mp4',kind:'video',url:'https://multimedia.nt.qq.com.cn/fixture'} as MediaInput},
    {adapter:new WeixinAdapter({read:()=>undefined,write:()=>{}}),input:{name:'clip.mp4',mime:'video/mp4',kind:'video',remote:{fullUrl:'https://novac2c.cdn.weixin.qq.com/fixture'}} as MediaInput},
  ];
  for(const {adapter,input} of fixtures){
    const signal=new AbortController().signal;
    for(const size of [50*MiB+1,500*MiB]){declaredSize=size;assert.equal((await adapter.materialize(input,signal)).toString(),'video-fixture');}
    declaredSize=500*MiB+1;await assert.rejects(adapter.materialize(input,signal),/MEDIA_TOO_LARGE/);
    declaredSize=50*MiB+1;
    for(const kind of ['image','audio','file'] as const)await assert.rejects(adapter.materialize({...input,kind},signal),/MEDIA_TOO_LARGE/);
  }
});

test('WeChat encrypted video allows AES padding overhead and bounds decrypted video bytes',async t=>{
  const key=Buffer.alloc(16,7),plaintext=Buffer.from('video-fixture');const cipher=createCipheriv('aes-128-ecb',key,null);
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);let declaredSize=500*MiB+16,oversizedPlaintext=false;
  const concat=Buffer.concat;
  const concatMock=mock.method(Buffer,'concat',((chunks:readonly Uint8Array[],totalLength?:number)=>{
    const bytes=concat(chunks,totalLength);
    // Model an oversized decoded buffer without allocating a 500 MiB fixture.
    if(oversizedPlaintext&&bytes.equals(plaintext))Object.defineProperty(bytes,'length',{value:500*MiB+1});
    return bytes;
  }) as typeof Buffer.concat);
  const lookup=mock.method(dns,'lookup',(async()=>[{address:'1.1.1.1',family:4}]) as any);syncBuiltinESMExports();
  const get=mock.method(https,'get',((_url:URL,_options:any,receive:(response:any)=>void)=>{
    const request=new EventEmitter();queueMicrotask(()=>{
      const response=new PassThrough() as any;response.statusCode=200;response.headers={'content-length':declaredSize};
      receive(response);response.end(ciphertext);
    });return request;
  }) as any);
  t.after(()=>{get.mock.restore();lookup.mock.restore();syncBuiltinESMExports();concatMock.mock.restore();});
  const adapter=new WeixinAdapter({read:()=>undefined,write:()=>{}}),signal=new AbortController().signal;
  const input:MediaInput={name:'clip.mp4',mime:'video/mp4',kind:'video',remote:{fullUrl:'https://novac2c.cdn.weixin.qq.com/fixture',key:key.toString('base64')}};
  assert.deepEqual(await adapter.materialize(input,signal),plaintext);
  declaredSize=500*MiB+17;await assert.rejects(adapter.materialize(input,signal),/MEDIA_TOO_LARGE/);
  declaredSize=500*MiB+16;await assert.rejects(adapter.materialize({...input,remote:{fullUrl:input.remote!.fullUrl}},signal),/MEDIA_TOO_LARGE/);
  declaredSize=50*MiB+16;await assert.rejects(adapter.materialize({...input,kind:'image'},signal),/MEDIA_TOO_LARGE/);
  declaredSize=500*MiB+16;oversizedPlaintext=true;await assert.rejects(adapter.materialize(input,signal),/MEDIA_TOO_LARGE/);
});
