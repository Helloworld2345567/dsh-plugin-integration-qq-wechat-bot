import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,open,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {QQAdapter} from '../src/channels/qq.js';
import {QQ_MEDIA_LIMITS} from '../src/channels/qq-limits.js';
import {botSchema,type Asset,type Delivery} from '../src/core/types.js';

const bot=botSchema.parse({id:'qq-upload',name:'QQ upload',channel:'qq',accountId:'app'});
const credential={accountId:'app',appSecret:'fixture'};
const hash=(algorithm:string,bytes:Buffer)=>createHash(algorithm).update(bytes).digest('hex');
const asset=(file:string,size:number,kind:Asset['kind']='audio'):Asset=>({id:'asset',scopeKey:'scope',name:path.basename(file),mime:'audio/wav',path:file,size,kind,createdAt:0});
const delivery=(kind='private'):Delivery=>({id:'delivery',scopeKey:'scope',botId:bot.id,sessionId:'session',sourceId:'inbound',turnId:'turn',index:2,replySequence:7,output:{type:'asset',assetId:'asset'},reply:{target:'owner/id',kind,msgId:'inbound'},state:'sending',attempt:{number:1,phase:'prepare',assetId:'asset'}});
async function fixture(run:(file:string)=>Promise<void>):Promise<void>{
  const base=process.env.BOT_TEST_TMP??path.resolve('.codex');await mkdir(base,{recursive:true});
  const folder=await mkdtemp(path.join(base,'qq-upload-'));
  try{await run(path.join(folder,'voice.wav'));}finally{await rm(folder,{recursive:true,force:true});}
}

function fakeUpload(size:number,blockSize=5*1024*1024){
  const calls:{url:string;body:any}[]=[];const uploaded:{url:string;bytes:Buffer;headers:Headers}[]=[];
  const request:any=async(url:string,init:RequestInit)=>{
    const body=JSON.parse(String(init.body));calls.push({url,body});
    if(url.endsWith('getAppAccessToken'))return{access_token:'fixture-token',expires_in:3600};
    if(url.endsWith('/upload_prepare'))return{upload_id:'upload-1',block_size:String(blockSize),parts:Array.from({length:Math.ceil(size/blockSize)},(_,index)=>({index,presigned_url:`https://cos.example.com/part/${index}?signature=fixture`,block_size:String(Math.min(blockSize,size-index*blockSize))})),upload_config:{concurrency:1,retry_timeout:300,retry_delay:1}};
    if(url.endsWith('/upload_part_finish'))return{};
    if(url.endsWith('/files'))return{file_info:'uploaded-file',ttl:300};
    if(url.endsWith('/messages'))return{id:'receipt'};
    throw new Error('UNEXPECTED_REQUEST');
  };
  const fetcher:typeof fetch=async(url,init)=>{
    uploaded.push({url:String(url),bytes:Buffer.from(init?.body as Uint8Array),headers:new Headers(init?.headers)});
    assert.equal(init?.method,'PUT');assert.equal(init?.redirect,'error');
    return new Response(null,{status:200});
  };
  return{calls,uploaded,request,fetcher};
}

test('QQ direct upload includes filename and applies its threshold to actual bytes',async()=>{
  await fixture(async file=>{
    const bytes=Buffer.alloc(QQ_MEDIA_LIMITS.directUploadBytes,0x67);await writeFile(file,bytes);
    const mock=fakeUpload(bytes.length);const adapter=new QQAdapter(mock.request,undefined,undefined,mock.fetcher);
    assert.equal(await adapter.send(bot,credential,delivery(),asset(file,1),new AbortController().signal),'receipt');
    const upload=mock.calls.find(call=>call.url.endsWith('/files'))!.body;
    assert.equal(upload.file_name,'voice.wav');assert.equal(upload.file_type,3);assert.equal(upload.srv_send_msg,false);
    assert.deepEqual(Buffer.from(upload.file_data,'base64'),bytes);assert.equal(mock.uploaded.length,0);
    assert.equal(mock.calls.some(call=>call.url.endsWith('/upload_prepare')),false);
  });
});

test('QQ private and group large WAVs use exact official hashes and complete ordered parts before commit',async()=>{
  await fixture(async file=>{
    const bytes=Buffer.alloc(15_160_364);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
    await writeFile(file,bytes);
    for(const kind of ['private','group']){
      const mock=fakeUpload(bytes.length);const intent=delivery(kind);const adapter=new QQAdapter(mock.request,undefined,undefined,mock.fetcher);
      assert.equal(await adapter.send(bot,credential,intent,asset(file,1),new AbortController().signal),'receipt');
      const base=`/v2/${kind==='group'?'groups':'users'}/owner%2Fid`;
      const prepared=mock.calls.find(call=>call.url.endsWith('/upload_prepare'))!;
      assert.ok(prepared.url.endsWith(`${base}/upload_prepare`));
      assert.deepEqual(prepared.body,{file_type:3,file_name:'voice.wav',file_size:String(bytes.length),md5:hash('md5',bytes),sha1:hash('sha1',bytes),md5_10m:hash('md5',bytes.subarray(0,10_002_432))});
      assert.deepEqual(Buffer.concat(mock.uploaded.map(item=>item.bytes)),bytes);
      const finished=mock.calls.filter(call=>call.url.endsWith('/upload_part_finish'));
      assert.equal(finished.length,mock.uploaded.length);
      for(const [index,part] of mock.uploaded.entries()){
        assert.equal(part.headers.get('authorization'),null);assert.equal(part.headers.get('content-length'),String(part.bytes.length));
        assert.deepEqual(finished[index].body,{upload_id:'upload-1',part_index:index,block_size:String(part.bytes.length),md5:hash('md5',part.bytes)});
        assert.ok(finished[index].url.endsWith(`${base}/upload_part_finish`));
      }
      const merged=mock.calls.find(call=>call.url.endsWith('/files'))!;
      assert.deepEqual(merged.body,{file_type:3,file_name:'voice.wav',upload_id:'upload-1',srv_send_msg:false});
      const committed=mock.calls.at(-1)!;assert.ok(committed.url.endsWith(`${base}/messages`));
      assert.equal(committed.body.media.file_info,'uploaded-file');assert.equal(committed.body.msg_id,'inbound');assert.equal(committed.body.msg_seq,7);
      assert.equal(intent.attempt?.phase,'commit');assert.equal(intent.attempt?.fileInfo,'uploaded-file');
      const priorCount=mock.calls.length;
      // A retry with confirmed file_info no longer needs the original local file.
      await adapter.send(bot,credential,intent,asset(`${file}.missing`,bytes.length),new AbortController().signal);
      assert.equal(mock.calls.length,priorCount+1);assert.ok(mock.calls.at(-1)!.url.endsWith('/messages'));
    }
  });
});

test('QQ streams an actual 200 MiB audio file above the soft limit without lowering file_type or truncating',async()=>{
  await fixture(async file=>{
    const size=QQ_MEDIA_LIMITS.audio.hardBytes;const handle=await open(file,'w');
    try{await handle.truncate(size);await handle.write(Buffer.from('END'),0,3,size-3);}finally{await handle.close();}
    const mock=fakeUpload(size);let total=0,parts=0;let lastBytes:Buffer|undefined;
    const fetcher:typeof fetch=async(_url,init)=>{
      const bytes=init?.body as Buffer;total+=bytes.length;parts++;lastBytes=Buffer.from(bytes.subarray(-3));
      return new Response(null,{status:200});
    };
    const adapter=new QQAdapter(mock.request,undefined,undefined,fetcher);
    assert.equal(await adapter.send(bot,credential,delivery('group'),asset(file,size),new AbortController().signal),'receipt');
    assert.equal(total,size);assert.equal(parts,40);assert.equal(lastBytes?.toString(),'END');
    assert.equal(mock.calls.find(call=>call.url.endsWith('/upload_prepare'))!.body.file_type,3);
    assert.equal(mock.calls.find(call=>call.url.endsWith('/files'))!.body.file_type,3);
    assert.equal(mock.calls.filter(call=>call.url.endsWith('/upload_part_finish')).length,parts);
  });
});

test('QQ rejects every media kind over the hard limit before auth and verifies actual file size too',async()=>{
  await fixture(async file=>{
    const size=QQ_MEDIA_LIMITS.audio.hardBytes+1;const handle=await open(file,'w');
    try{await handle.truncate(size);}finally{await handle.close();}
    const mock=fakeUpload(size);const adapter=new QQAdapter(mock.request,undefined,undefined,mock.fetcher);const signal=new AbortController().signal;
    for(const kind of ['image','audio','video','file'] as const){
      assert.equal(QQ_MEDIA_LIMITS[kind].hardBytes,200*1024*1024);
      await assert.rejects(adapter.send(bot,credential,delivery(),asset(`${file}.missing`,size,kind),signal),/QQ_OUTPUT_TOO_LARGE/);
    }
    assert.equal(mock.calls.length,0);
    await assert.rejects(adapter.send(bot,credential,delivery(),asset(file,1),signal),/QQ_OUTPUT_TOO_LARGE/);
    assert.equal(mock.calls.length,1);assert.ok(mock.calls[0].url.endsWith('getAppAccessToken'));assert.equal(mock.uploaded.length,0);
  });
});

test('QQ does not finish, merge or commit a failed or cancelled part',async()=>{
  await fixture(async file=>{
    const size=QQ_MEDIA_LIMITS.directUploadBytes+1;await writeFile(file,Buffer.alloc(size));
    for(const mode of ['failed','cancelled'] as const){
      const mock=fakeUpload(size);const controller=new AbortController();const intent=delivery();
      const fetcher:typeof fetch=async()=>{if(mode==='cancelled')controller.abort();return new Response(null,{status:mode==='failed'?503:200});};
      const adapter=new QQAdapter(mock.request,undefined,undefined,fetcher);
      await assert.rejects(adapter.send(bot,credential,intent,asset(file,size),controller.signal),mode==='failed'?/QQ_UPLOAD_PART_FAILED/:/abort/i);
      assert.equal(intent.attempt?.phase,'upload');assert.equal(intent.attempt?.fileInfo,undefined);
      assert.equal(mock.calls.some(call=>/\/(?:upload_part_finish|files|messages)$/.test(call.url)),false);
    }
  });
});

test('QQ rejects invalid part descriptions and 200 business errors without uploading or committing',async()=>{
  await fixture(async file=>{
    const size=QQ_MEDIA_LIMITS.directUploadBytes+1;await writeFile(file,Buffer.alloc(size));
    for(const response of [
      {upload_id:'bad',block_size:'5000000',parts:[{index:0,block_size:'5000000',presigned_url:'https://cos.example/0'}]},
      {upload_id:'bad',block_size:String(size),parts:[{index:1,block_size:String(size),presigned_url:'https://cos.example/0'}]},
      {upload_id:'bad',block_size:String(size),parts:[{index:0,block_size:String(size),presigned_url:'http://cos.example/0'}]},
      {code:850031,message:'file too large'},
    ]){
      const mock=fakeUpload(size);const request:any=async(url:string,init:RequestInit)=>url.endsWith('/upload_prepare')?response:mock.request(url,init);
      const adapter=new QQAdapter(request,undefined,undefined,mock.fetcher);
      await assert.rejects(adapter.send(bot,credential,delivery(),asset(file,size),new AbortController().signal),/QQ_UPLOAD_PARTS_INVALID|UNSAFE_MEDIA_URL|QQ_API_REJECTED/);
      assert.equal(mock.uploaded.length,0);assert.equal(mock.calls.some(call=>urlIsCommit(call.url)),false);
    }
  });
});
function urlIsCommit(url:string):boolean{return /\/(?:files|messages)$/.test(url);}

test('QQ retries reuse live upload receipts and reupload expired or legacy receipts',async()=>{
  await fixture(async file=>{
    await writeFile(file,Buffer.from('audio fixture'));const size=13;
    for(const expiry of [0,Date.now()+60_000,Date.now()-1,undefined]){
      const mock=fakeUpload(size),intent=delivery();
      intent.attempt!.fileInfo='previous-file';intent.attempt!.fileInfoExpiresAt=expiry;
      const adapter=new QQAdapter(mock.request,undefined,undefined,mock.fetcher);
      await adapter.send(bot,credential,intent,asset(file,size),new AbortController().signal);
      const shouldUpload=expiry!==0&&(expiry===undefined||expiry<Date.now());
      assert.equal(mock.calls.filter(call=>call.url.endsWith('/files')).length,shouldUpload?1:0);
      const commit=mock.calls.find(call=>call.url.endsWith('/messages'))!;
      assert.equal(commit.body.media.file_info,shouldUpload?'uploaded-file':'previous-file');
      if(shouldUpload)assert.ok(intent.attempt!.fileInfoExpiresAt!>Date.now());
    }
  });
});
