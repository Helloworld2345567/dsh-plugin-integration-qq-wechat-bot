import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {MediaService} from '../src/core/media.js';
import {TransformSlots} from '../src/core/transform-slots.js';
import {validateMediaParameters} from '../src/core/limits.js';
import {mediaOperationRegistry} from '../src/core/media-operation-registry.js';
import {skillToolManifests,resolveSkillOperation} from '../src/core/skill-operations.js';
import {allowedNow,freezeTurn} from '../src/core/policy.js';
import {configSchema,botSchema} from '../src/core/types.js';
import type {WorkerPort,MediaWorkerJob} from '../src/core/worker-port.js';
import {ProcessWorker} from '../src/harness/process-worker.js';
import {MEDIA_WORKER_PROTOCOL,MEDIA_WORKER_PROTOCOL_VERSION} from '../src/core/worker-port.js';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function until(predicate:()=>boolean){for(let i=0;i<1000;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('operation did not reach expected state');}
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}
async function fixture(t:any,capacity=2){
  const home=await mkdtemp(path.resolve('.codex/transform-runtime-'));t.after(()=>rm(home,{recursive:true,force:true}));
  const jobs=new Map<string,any>();const saved:any[]=[];let calls:any[]=[];
  const store={home,patchJob:(id:string,v:any)=>jobs.set(id,{...jobs.get(id),...v}),consumeMediaQuota:()=>{throw Error('LOCAL_TRANSFORMS_MUST_NOT_CONSUME_QUOTA');}} as any;
  const assets={workspace:async()=>home,resolve:async(_scope:string,id:string)=>{if(id==='foreign')throw Error('ASSET_NOT_OWNED');return {id,path:'/fixture/input',name:'input.png',mime:'image/png',kind:'image'};},save:async(scope:string,file:any,bytes:Buffer)=>{const id=String(saved.length);saved.push({scope,file,bytes});return{id};}} as any;
  const worker:WorkerPort={run:async(job)=>{calls.push(job);await tick();return{text:'converted'};}};
  const media=new MediaService(store,assets,undefined,undefined,worker,mediaOperationRegistry,new TransformSlots(capacity));
  return{media,jobs,saved,worker,get calls(){return calls;}};
}

test('transform routes, delivery and permission are independent of analysis providers',()=>{
  const manifest=skillToolManifests.find(item=>item.tool.name==='media_transform')!;
  for(const operation of ['image_convert','image_resize','image_compress','convert_gif']){
    assert.equal(resolveSkillOperation(manifest,{operation}),operation);
    const entry=mediaOperationRegistry.get(operation);assert.equal(entry.localTransform,true);assert.equal(entry.deliver,true);assert.equal(entry.role,undefined);
  }
  const config=configSchema.parse({id:'test',name:'test',personaPrompt:'test',media:{asr:{enabled:false},video:{enabled:false}}});
  const bot=botSchema.parse({id:'test',name:'test',channel:'qq',enabled:true});
  const scope={botId:'test',platform:'qq',accountId:'test',kind:'private' as const,channelId:'test',senderId:'test'};
  const snapshot=freezeTurn(config,bot,scope,[]);
  assert.equal(allowedNow('media_transform',snapshot,config,bot,scope),true);
  assert.equal(allowedNow('media_analysis',snapshot,config,bot,scope),false);
  assert.equal(allowedNow('media_transform',snapshot,{...config,skills:[]},bot,scope),false);
});

test('transform validation rejects missing inputs and invalid parameters before enqueueing',()=>{
  for(const [inputs,args] of [[[],{}],[['a','b'],{}],[['a'],{quality:0}],[['a'],{maxWidth:1.5}],[['a'],{format:'tiff'}],[['a'],{url:'https://example.com/file'}]] as const){assert.throws(()=>validateMediaParameters('image_convert',[...inputs],args));}
  assert.throws(()=>validateMediaParameters('image_resize',['a'],{}),/IMAGE_SIZE_REQUIRED/);
  assert.throws(()=>validateMediaParameters('convert_gif',['a'],{fps:11}));
  assert.throws(()=>validateMediaParameters('convert_gif',['a'],{maxBytes:100}),/GIF_SIZE_LIMIT_FIXED/);
  assert.doesNotThrow(()=>validateMediaParameters('convert_gif',['a'],{}));
});

test('slots share segment and file budgets, keep FIFO order and remove cancelled waiters',async()=>{
  const slots=new TransformSlots(3),signal=new AbortController();
  const first=await slots.acquire(2,signal.signal);assert.equal(first.slots,2);
  const second=await slots.acquire(2,signal.signal);assert.equal(second.slots,1);
  const cancel=new AbortController();const aborted=assert.rejects(slots.acquire(1,cancel.signal),/cancel/);
  let acquired=false;const next=slots.acquire(2,signal.signal).then(lease=>{acquired=true;return lease;});
  cancel.abort(Error('cancel'));await aborted;await tick();assert.equal(acquired,false);
  first.release();const third=await next;assert.equal(third.slots,2);first.release();
  let pending=false;const last=slots.acquire(1,signal.signal).then(lease=>{pending=true;return lease;});await tick();assert.equal(pending,false);
  second.release();(await last).release();third.release();
});

test('same-scope transforms execute concurrently and queued failures release all slots',async t=>{
  const f=await fixture(t);const waiting=gate();let active=0,peak=0;
  f.worker.run=async(job:any)=>{f.calls.push(job);active++;peak=Math.max(peak,active);await waiting.promise;active--;return{text:'ok'};};
  const run=()=>f.media.run('same','image_convert',{} as any,['image'],{},new AbortController().signal);
  const first=run(),second=run();await until(()=>active===2);
  const cancelled=new AbortController();const third=assert.rejects(f.media.run('same','image_convert',{} as any,['image'],{},cancelled.signal),/cancelled/);
  cancelled.abort(Error('cancelled'));await third;
  let permitted=true;
  const revoked=assert.rejects(f.media.run('same','image_convert',{} as any,['image'],{},new AbortController().signal,()=>{if(!permitted)throw Error('REVOKED');}),/REVOKED/);
  permitted=false;waiting.release();await Promise.all([first,second,revoked]);assert.equal(peak,2);assert.equal(f.calls.length,2);
  f.worker.run=async()=>{throw Error('FAILED');};await assert.rejects(run(),/FAILED/);
  f.worker.run=async()=>({text:'ok'});assert.equal((await run()).text,'ok');assert.equal(f.media.active.size,0);
  assert.deepEqual(await readdir(path.join(f.media.store.home,'.bot','jobs','same')),[]);
});

test('local transforms preserve ownership, isolate outputs and save attachments before cleanup',async t=>{
  const f=await fixture(t);f.worker.run=async(job:any)=>{f.calls.push(job);const file=path.join(job.output,'result.png');await writeFile(file,job.id);return{assets:[{path:file,name:'result.png',mime:'image/png',kind:'image'}]};};
  const run=(input='image')=>f.media.run('same','image_convert',{} as any,[input],{processingSlots:100},new AbortController().signal);
  const result=await Promise.all([run(),run()]);assert.equal(result.length,2);assert.equal(f.saved.length,2);
  assert.notEqual(f.calls[0].output,f.calls[1].output);assert.ok(f.calls.every(job=>job.processingSlots===1));
  assert.equal(f.saved[0].scope,'same');assert.notEqual(f.saved[0].bytes.toString(),f.saved[1].bytes.toString());
  await assert.rejects(run('foreign'),/ASSET_NOT_OWNED/);assert.equal(f.saved.length,2);
  assert.deepEqual(await readdir(path.join(f.media.store.home,'.bot','jobs','same')),[]);
});

test('cancelScope cancels running and queued transforms before delivering assets',async t=>{
  const f=await fixture(t,1);let started=0;
  f.worker.run=async(_job:any,signal:AbortSignal)=>{started++;await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));return{};};
  const run=()=>assert.rejects(f.media.run('same','image_convert',{} as any,['image'],{},new AbortController().signal),/取消/);
  const first=run();await until(()=>started===1);const second=run();await tick();f.media.cancelScope('same');await Promise.all([first,second]);
  assert.equal(started,1);assert.equal(f.media.active.size,0);assert.equal(f.saved.length,0);
});

test('ProcessWorker cancellation terminates encoder descendants before cleanup',async t=>{
  const root=await mkdtemp(path.resolve('.codex/transform-process-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const script=path.join(root,'fixture.py');
  await writeFile(script,`import json, pathlib, subprocess, sys\njob=json.load(sys.stdin)\nchild=subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\npathlib.Path(job['output'], 'child.pid').write_text(str(child.pid))\nchild.wait()\n`);
  const controller=new AbortController();
  const worker=new ProcessWorker(process.env.BOT_PYTHON||'python',script);
  const job:MediaWorkerJob={protocol:MEDIA_WORKER_PROTOCOL,protocolVersion:MEDIA_WORKER_PROTOCOL_VERSION,id:'fixture',scope:'fixture',operation:'convert_gif',handler:'skill',inputs:[],parameters:{},output:root,usagePath:path.join(root,'usage.json'),deadline:0,timeoutMs:0,quotaUnits:1,processingSlots:2};
  const running=assert.rejects(worker.run(job,controller.signal),/MEDIA_CANCELLED_OR_TIMEOUT/);
  let childPid=0;
  for(let i=0;i<1000&&!childPid;i++){try{childPid=Number(await readFile(path.join(root,'child.pid'),'utf8'));}catch{await new Promise(resolve=>setTimeout(resolve,5));}}
  t.after(()=>{if(childPid){try{process.kill(childPid);}catch{}}});
  assert.ok(childPid,'fixture child must be running before cancellation');
  controller.abort(Error('cancelled'));await running;
  await until(()=>{try{process.kill(childPid,0);return false;}catch{return true;}});
});
