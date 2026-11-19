import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {crc32} from 'node:zlib';
import {Assets,MediaService} from '../src/core/media.js';
import {safeWorkerErrorCode} from '../src/harness/process-worker.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {scopeKey} from '../src/core/identity.js';
import {imageServiceSettingsSchema} from '../src/core/image-service-config.js';
import type {CallerScope,ChannelAdapter,InboundMessage,MediaInput} from '../src/core/types.js';
import type {MediaWorkerJob,WorkerPort} from '../src/core/worker-port.js';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {fixtureChannels} from './test-channel.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==','base64');
const attachment=(name:string):MediaInput=>({kind:'image',name,mime:'image/png',bytes:png.toString('base64')});
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}

async function fixture(t:TestContext,platform:'qq'|'weixin'='qq',locale:'zh'|'en'='zh'){
  await mkdir(path.resolve('.codex'),{recursive:true});
  const root=await mkdtemp(path.resolve('.codex/image-fast-path-'));
  const store=new SqlitePersistence(root),repos=store.repositories(),assets=new Assets(repos);
  const scope:CallerScope={botId:'bot',platform,accountId:'account',channelId:'viewer',senderId:'viewer',kind:'private'};
  const key=scopeKey(scope),bot=store.bots.saveBot({id:scope.botId,name:'Images',accountId:scope.accountId,channel:platform,enabled:true});
  store.bots.saveBot({...bot,settings:{...bot.settings,model:null,skills:['image-generation'],tools:['bot_media'],imageStyle:'silk print',media:{image:{enabled:true}},progressReply:{enabled:true,intervalSeconds:10}}});
  const workflow=path.join(root,'fixture-workflow.json');await writeFile(workflow,'{}');
  const imageSettings=imageServiceSettingsSchema.parse({imageProtocol:'comfyui',comfyUiWorkflowPath:workflow});
  const jobs:MediaWorkerJob[]=[],chat:InboundMessage[][]=[],events:string[]=[];
  let beforeOutput:((signal:AbortSignal)=>Promise<void>)|undefined,progressModelCalls=0;
  const worker:WorkerPort={run:async(job,signal)=>{
    jobs.push(job);events.push(job.operation);await beforeOutput?.(signal);
    const file=path.join(job.output,'result.png');await writeFile(file,png);
    return {assets:[{kind:'image',mime:'image/png',name:'result.png',path:file}]};
  }};
  const media=new MediaService(repos,assets,undefined,undefined,worker,undefined,undefined,undefined,()=>imageSettings);
  const harness:HarnessPort={
    run:async(_binding,messages,_signal,options)=>{
      chat.push(messages);events.push('chat');
      return {turnId:`chat-${chat.length}`,outputs:[{type:'text',text:'chat reply'}],snapshot:options!.snapshot!};
    },
    formatProgress:async()=>{progressModelCalls++;return 'model progress';},
    cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{},
  };
  const adapter:ChannelAdapter={
    beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},
    materialize:async()=>{throw Error('fixture only admits embedded input files');},
    send:async(_bot,_credential,d)=>`platform-receipt-${d.sourceId}`,
  };
  const runtime=new BotRuntime(repos,assets,media,harness,fixtureChannels(adapter),{read:async()=>({accountId:scope.accountId}),write:async()=>{},remove:async()=>{}},60000,0,undefined,()=>locale);
  t.after(async()=>{await runtime.close();store.close();await rm(root,{recursive:true,force:true});});
  const input=(id:string,text:string,attachments:MediaInput[]=[],quoted?:InboundMessage['quoted']):InboundMessage=>({
    id,text,scope,attachments,quoted,timestamp:Date.now(),reply:platform==='qq'?{target:scope.channelId,kind:'private',msgId:id}:{target:scope.channelId,contextToken:'fixture'},
  });
  const run=async(message:InboundMessage)=>{await runtime.receive(message);await runtime.process(key);};
  const sent=(id:string)=>store.deliveries.deliveries(['sent']).filter(d=>d.sourceId===id&&d.purpose!=='progress');
  const disableImages=()=>{const current=store.bots.bot(scope.botId);runtime.saveBot({...current,settings:{...current.settings,skills:[]}});};
  const rememberPhoto=async(id:string,name:string,owner=scope)=>{
    const binding=store.sessions.binding(owner);
    const asset=await assets.save(binding.key,{kind:'image',name,mime:'image/png'},png);
    store.inbox.accept({...input(id,'',[{kind:'image',name,mime:'image/png',handle:asset.id}]),scope:owner});
    store.inbox.mark(binding.key,[id],'complete');return asset;
  };
  return {runtime,store,scope,key,jobs,chat,events,input,run,sent,disableImages,rememberPhoto,
    onWorker:(hook:(signal:AbortSignal)=>Promise<void>)=>{beforeOutput=hook;},progressCalls:()=>progressModelCalls};
}

test('explicit draw bypasses the chat model and durably delivers one result despite repeated inbound events',async t=>{
  const f=await fixture(t);const message=f.input('draw','/draw --size 512x512 --n 1 A red fox');
  await f.run(message);await f.run(message);
  assert.deepEqual(f.events,['image_generate']);
  const job=f.jobs[0];assert.deepEqual(job.inputs,[]);assert.equal(job.endpoint?.protocol,'comfyui');
  assert.deepEqual([job.parameters.width,job.parameters.height,job.parameters.n],[512,512,1]);
  assert.match(String(job.parameters.prompt),/A red fox/);assert.match(String(job.parameters.prompt),/silk print/);
  assert.doesNotMatch(String(job.parameters.prompt),/--size|--n /);
  const deliveries=f.sent('draw');assert.equal(deliveries.filter(d=>d.output.type==='asset').length,1);
  assert.equal(deliveries.at(-1)?.receipt,'platform-receipt-draw');
  assert.equal(f.store.inbox.stateOf(f.key,'draw'),'complete');
  const metric=f.store.turnMetrics.findTurnMetric(`inbox:${f.key}:draw`)!;
  assert.equal(metric.modelStartedAt,undefined);assert.ok(metric.firstSentAt);
});

test('explicit WeChat edits use attached and quoted images once each, scoped to the sender',async t=>{
  const f=await fixture(t,'weixin');
  const quoted=await f.rememberPhoto('photo','own.png');
  await f.rememberPhoto('photo','other.png',{...f.scope,senderId:'other',channelId:'other'});
  const duplicate:MediaInput={kind:'image',name:quoted.name,mime:'image/png',handle:quoted.id};
  await f.run(f.input('edit','/edit Blue background',[attachment('new.png'),duplicate],{id:'photo'}));
  assert.deepEqual(f.events,['image_edit']);assert.deepEqual(f.jobs[0].inputs.map(v=>v.name).sort(),['new.png','own.png']);
  assert.match(String(f.jobs[0].parameters.prompt),/Blue background/);
  assert.equal(f.sent('edit').filter(d=>d.output.type==='asset').length,1);
  await f.run(f.input('quoted-only','/edit Change the lighting',[],{id:'photo'}));
  assert.deepEqual(f.jobs[1].inputs.map(v=>v.name),['own.png']);
});

test('an edit without a current reference and a draw with an attached image return guidance',async t=>{
  const f=await fixture(t,'qq','en');await f.rememberPhoto('old','old.png');
  await f.rememberPhoto('foreign','foreign.png',{...f.scope,senderId:'other',channelId:'other'});
  for(const message of [f.input('no-image','/edit remake this'),f.input('foreign-quote','/edit remake this',[],{id:'foreign'}),f.input('draw-with-image','/draw modify this',[attachment('unexpected.png')]),f.input('no-prompt','/draw'),f.input('invalid-size','/draw --size nonsense foo')]){
    await f.run(message);
    const guidance=f.sent(message.id).map(d=>d.output.text??'').join(' ');
    assert.match(guidance,/image|reference|prompt|size|\/edit|\/draw/i,message.id);
    assert.doesNotMatch(guidance,/unknown command|未知|[\u4e00-\u9fff]/i,message.id);
    assert.equal(f.sent(message.id).some(d=>d.output.type==='asset'),false);
  }
  assert.deepEqual(f.events,[]);
});
test('quoting a previously delivered bot image edits that specific asset',async t=>{
  const f=await fixture(t);
  await f.run(f.input('first','/draw red apple'));await f.run(f.input('newer','/draw pear'));
  const image=f.sent('first').find(d=>d.output.type==='asset');assert.ok(image?.receipt);
  await f.run(f.input('edit-bot-image','/edit turn green',[],{id:image.receipt}));
  assert.deepEqual(f.events,['image_generate','image_generate','image_edit']);
  const asset=f.store.assets.asset(f.key,image.output.assetId!);
  assert.deepEqual(f.jobs[2].inputs.map(i=>i.path),[asset.path]);
  assert.equal(f.sent('edit-bot-image').filter(d=>d.output.type==='asset').length,1);
});

test('direct edit accepts an image larger than the native chat input budget',async t=>{
  const f=await fixture(t);
  // Add a valid PNG text chunk before IEND to control size without a large fixture file.
  const chunk=Buffer.concat([Buffer.from('tEXtDescription\0'),Buffer.alloc(400*1024,'p')]);
  const length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(chunk.length-4);checksum.writeUInt32BE(crc32(chunk));
  const large=Buffer.concat([png.subarray(0,-12),length,chunk,checksum,png.subarray(-12)]);
  await f.run(f.input('large','/edit soften the shadows',[{...attachment('large.png'),bytes:large.toString('base64')}]));
  assert.deepEqual(f.events,['image_edit']);
  assert.equal((await stat(f.jobs[0].inputs[0].path)).size,large.length);
  assert.equal(f.sent('large').filter(d=>d.output.type==='asset').length,1);
});

test('Chinese image commands keep FIFO boundaries and escaped or multi-intent chat remains native',async t=>{
  const f=await fixture(t);
  const messages=[f.input('one','Describe the image, then explain how to redraw it',[attachment('ordinary.png')]),f.input('two','生图：水彩小鸟'),
    f.input('three','//draw stays literal'),f.input('four','请比较两张图，然后帮我画一张海报'),f.input('five','修图：背景改为白色',[attachment('edit.png')])];
  for(const message of messages)await f.runtime.receive(message);
  for(let i=0;i<messages.length;i++)await f.runtime.process(f.key);
  assert.deepEqual(f.events.filter(e=>e!=='chat'),['image_generate','image_edit']);
  assert.deepEqual(f.chat.flatMap(batch=>batch.map(m=>m.text)),[messages[0].text,'/draw stays literal',messages[3].text]);
  assert.equal(f.events[0],'chat');assert.equal(f.events.at(-1),'image_edit');assert.equal(f.events[1],'image_generate');
  assert.deepEqual(f.jobs[0].inputs,[]);assert.deepEqual(f.jobs[1].inputs.map(i=>i.name),['edit.png']);
  assert.match(String(f.jobs[0].parameters.prompt),/水彩小鸟/);assert.match(String(f.jobs[1].parameters.prompt),/背景改为白色/);
  for(const id of ['two','five'])assert.equal(f.sent(id).filter(d=>d.output.type==='asset').length,1);
});

test('an explicitly deferred reference joins the following edit and stays bound to its reply',async t=>{
  const f=await fixture(t);
  await f.runtime.receive(f.input('hold','先别分析，等我指令',[attachment('deferred.png')]));
  await f.run(f.input('edit-held','/edit 改成水彩'));
  assert.deepEqual(f.events,['image_edit']);assert.deepEqual(f.jobs[0].inputs.map(i=>i.name),['deferred.png']);
  assert.equal(f.sent('hold').length,0);assert.equal(f.sent('edit-held').filter(d=>d.output.type==='asset').length,1);
});

test('a failed direct image worker and a disabled capability produce text without falling back',async t=>{
  const f=await fixture(t);
  f.onWorker(async()=>{throw Error('IMAGE_PROVIDER_FAILED');});
  await f.run(f.input('failure','/draw apple'));
  f.onWorker(async()=>{throw Error(safeWorkerErrorCode('COMFYUI_REFERENCE_SLOT_UNAVAILABLE'));});
  await f.run(f.input('workflow','/edit change the background',[attachment('input.png')]));
  assert.match(f.sent('workflow')[0]?.output.text??'',/LoadImage/);
  f.disableImages();await f.run(f.input('disabled','/draw banana'));
  assert.deepEqual(f.events,['image_generate','image_edit']);
  for(const id of ['failure','workflow','disabled']){
    const deliveries=f.sent(id);assert.ok(deliveries.some(d=>d.output.type==='text'&&d.output.text?.trim()));
    assert.equal(deliveries.some(d=>d.output.type==='asset'),false);
  }
});

for(const change of ['stop','revoke'] as const)test(`direct image work cannot publish after ${change}`,async t=>{
  const f=await fixture(t),started=gate(),release=gate();
  let workerSignal:AbortSignal|undefined;
  f.onWorker(async signal=>{workerSignal=signal;started.resolve();await release.promise;});
  await f.runtime.receive(f.input('in-flight','/draw an orange'));
  const work=f.runtime.process(f.key);
  try{
    await Promise.race([started.promise,work.then(()=>{throw Error('direct image worker was never started');})]);
    if(change==='revoke')f.disableImages();
    const stopped=change==='stop'?f.runtime.receive(f.input('control','/stop')):undefined;
    release.resolve();await stopped;await work;
    assert.ok(workerSignal?.aborted);assert.deepEqual(f.events,['image_generate']);assert.equal(f.sent('in-flight').some(d=>d.output.type==='asset'),false);
  }finally{release.resolve();await work;}
});

test('long-running direct images send local progress without an auxiliary model request',async t=>{
  const f=await fixture(t),started=gate(),release=gate();
  t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now:Date.now()});
  f.onWorker(async()=>{started.resolve();await release.promise;});
  await f.runtime.receive(f.input('slow','/draw a tree'));const work=f.runtime.process(f.key);
  try{
    await Promise.race([started.promise,work.then(()=>{throw Error('direct image worker was never started');})]);
    t.mock.timers.tick(10000);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.progressCalls(),0);assert.ok(f.store.deliveries.deliveries(['sent']).some(d=>d.sourceId==='slow'&&d.purpose==='progress'));
  }finally{release.resolve();await work;}
});
