import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {Assets,MediaService} from '../src/core/media.js';
import {Store} from '../src/core/store.js';
import {INPUT_LIMITS,validateBatch,validateInboundMessage} from '../src/core/limits.js';
import {botSchema,type CallerScope,type InboundMessage,type MediaInput} from '../src/core/types.js';
import type {WorkerPort} from '../src/core/worker-port.js';

const MiB=1024*1024;
const scope:CallerScope={botId:'video-test',platform:'qq',accountId:'owner',kind:'private',channelId:'owner',senderId:'owner'};
const video=(handle='video'):MediaInput=>({kind:'video',name:'clip.mp4',mime:'video/mp4',handle});
const message=(overrides:Partial<InboundMessage>={}):InboundMessage=>({id:'message',scope,text:'analyze',attachments:[],reply:{target:'owner'},timestamp:Date.now(),...overrides});
async function fixture(t:any){
  const base=process.env.BOT_TEST_TMP??path.resolve('.codex');await mkdir(base,{recursive:true});
  const folder=await mkdtemp(path.join(base,'video-core-'));const store=new Store(folder);store.saveBot(botSchema.parse({id:scope.botId,name:scope.botId,channel:scope.platform}));
  t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});
  return{store,assets:new Assets(store)};
}

test('asset registration accepts video bytes through 500 MiB and preserves other media at 50 MiB',async t=>{
  const {store,assets}=await fixture(t);const originalWrite=fs.writeFile;let writes=0;
  // Exercise the real guards and database with logical sizes while writing only a tiny fixture.
  const writing=t.mock.method(fs,'writeFile',(async(file:any,_data:any,options:any)=>{writes++;await originalWrite(file,'fixture',options);}) as typeof fs.writeFile);
  syncBuiltinESMExports();
  const bytes=(size:number)=>Object.defineProperty(Buffer.from('fixture'),'length',{value:size});
  try{
    for(const size of [50*MiB+1,500*MiB]){
      const binding=store.binding({...scope,channelId:String(size),senderId:String(size)});
      const asset=await assets.save(binding.key,video(),bytes(size));
      assert.equal(asset.size,size);assert.equal(store.asset(binding.key,asset.id).size,size);
    }
    await assert.rejects(assets.save(store.binding(scope).key,video(),bytes(500*MiB+1)),/MEDIA_TOO_LARGE/);
    for(const kind of ['image','audio','file'] as const){
      await assert.rejects(assets.save(store.binding(scope).key,{kind,name:'fixture',mime:'application/octet-stream'},bytes(50*MiB+1)),/MEDIA_TOO_LARGE/);
    }
    assert.equal(writes,2,'oversized inputs must fail before filesystem writes');
  }finally{writing.mock.restore();syncBuiltinESMExports();}
});

test('worker video output reaches registration at 500 MiB and rejects larger output before reading it',async t=>{
  const {store,assets}=await fixture(t);const binding=store.binding(scope);let outputSize=500*MiB;let kind:MediaInput['kind']='video';let target='';
  t.mock.method(store,'consumeMediaQuota',()=>{});
  const worker:WorkerPort={run:async job=>{target=path.join(job.output,'clip.mp4');await writeFile(target,'fixture');return{assets:[{path:target,name:'clip.mp4',kind,mime:'video/mp4'}]};}};
  const media=new MediaService(store,assets,undefined,undefined,worker);const originalStat=fs.stat;
  const stated=t.mock.method(fs,'stat',(async(file:any,options:any)=>{const result=await originalStat(file,options);return file===target?Object.assign(result,{size:outputSize}):result;}) as typeof fs.stat);
  syncBuiltinESMExports();
  const run=()=>media.run(binding.key,'video_download',store.config('default'),[],{url:'https://www.douyin.com/video/1'},new AbortController().signal);
  try{
    const accepted=await run();assert.equal(accepted.assetIds.length,1);assert.equal(store.asset(binding.key,accepted.assetIds[0]).kind,'video');
    outputSize=500*MiB+1;await assert.rejects(run(),/OUTPUT_TOO_LARGE/);
    kind='file';outputSize=20*MiB+1;await assert.rejects(run(),/OUTPUT_TOO_LARGE/);
    assert.equal(store.recentAssets(binding.key,binding.sessionId,undefined,10).length,1);
  }finally{stated.mock.restore();syncBuiltinESMExports();}
});

test('inbound video byte budgets include quoted videos while preserving other media budgets',t=>{
  const encoded=Buffer.from('fixture').toString('base64');let size=500*MiB;const originalFrom=Buffer.from;
  const logical=Object.defineProperties(originalFrom('fixture'),{length:{get:()=>size},toString:{value:()=>encoded}});
  t.mock.method(Buffer,'from',((value:any,encoding:any)=>value===encoded&&encoding==='base64'?logical:originalFrom(value,encoding)) as typeof Buffer.from);
  const input={...video(),handle:undefined,bytes:encoded};
  assert.equal(validateInboundMessage(message({attachments:[input]})),undefined);
  size=500*MiB+1;assert.equal(validateInboundMessage(message({attachments:[input]})),'MEDIA_TOO_LARGE');
  size=250*MiB;assert.equal(validateInboundMessage(message({attachments:[input],quoted:{attachments:[input]}})),undefined);
  size=250*MiB+1;assert.equal(validateInboundMessage(message({attachments:[input],quoted:{attachments:[input]}})),'ATTACHMENT_BYTES_LIMIT');
  size=50*MiB+1;assert.equal(validateInboundMessage(message({attachments:[{...input,kind:'file'}]})),'MEDIA_TOO_LARGE');
});

test('materialized and quoted videos use the 1000 MiB batch budget instead of the text budget',()=>{
  const current=message({attachments:[video('current')]});const quoted=message({attachments:[],quoted:{text:'quoted video',attachments:[video('quoted')]}});
  assert.doesNotThrow(()=>validateBatch([current],()=>500*MiB));
  assert.doesNotThrow(()=>validateBatch([quoted],()=>500*MiB));
  assert.doesNotThrow(()=>validateBatch([current,quoted],()=>500*MiB));
  assert.throws(()=>validateBatch([current,quoted],id=>500*MiB+(id==='quoted'?1:0)),/BATCH_ATTACHMENT_BYTES_LIMIT/);
});

test('video batches retain original text and non-video attachment budgets',()=>{
  const input=video();
  assert.doesNotThrow(()=>validateBatch([message({text:'x'.repeat(INPUT_LIMITS.batchInputBytes),attachments:[input]})],()=>500*MiB));
  assert.throws(()=>validateBatch([message({text:'x'.repeat(INPUT_LIMITS.batchInputBytes+1),attachments:[input]})],()=>500*MiB),/BATCH_INPUT_TOO_LARGE/);
  const withFile=message({attachments:[input,{kind:'file',name:'file',mime:'application/octet-stream',handle:'file'}]});
  assert.throws(()=>validateBatch([withFile],id=>id==='file'?INPUT_LIMITS.batchAttachmentBytes+1:500*MiB),/BATCH_ATTACHMENT_BYTES_LIMIT/);
  assert.throws(()=>validateBatch([withFile],id=>id==='file'?INPUT_LIMITS.batchInputBytes:500*MiB),/BATCH_INPUT_TOO_LARGE/);
});
