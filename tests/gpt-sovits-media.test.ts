import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import type {Context} from '@deepseek-ai/cordis';
import {Assets,MediaService} from '../src/core/media.js';
import {Store} from '../src/core/store.js';
import {configSchema} from '../src/core/types.js';
import {HarnessMediaProvider} from '../src/harness/media-provider.js';
import {VoiceServiceQueue} from '../src/core/voice-service-queue.js';
import {validateMediaWorkerJob,type MediaWorkerJob,type WorkerPort} from '../src/core/worker-port.js';

const reference={baseUrl:'http://localhost:9880/',modelVersion:'v4',gptWeightsPath:'models/a.ckpt',sovitsWeightsPath:'models/a.pth',refAudioPath:'references/a.wav',promptText:'参考文本',promptLang:'all_zh',textLang:'all_zh'};
const config=(id='a',voice:Record<string,unknown>={})=>configSchema.parse({id,name:id,personaPrompt:'Hello',media:{voice:{enabled:true,protocol:'gpt_sovits',gptSovits:reference,...voice}}});
const resolver=new HarnessMediaProvider({} as Context);
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};};

async function fixture(t:TestContext,worker:WorkerPort){
  const home=await mkdtemp(path.resolve('.codex/gpt-media-'));const store=new Store(home,path.join(home,'personas'));
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  return{store,media:new MediaService(store,new Assets(store),'python',resolver,worker)};
}

test('GPT endpoint is independent from chat providers and never requires a placeholder credential',async()=>{
  const c=config();const connection=await resolver.resolve(c,'tts');
  assert.equal(connection.endpoint.protocol,'gpt_sovits');assert.equal(connection.endpoint.baseUrl,'http://localhost:9880');
  assert.equal(connection.endpoint.voice,'a');assert.equal(connection.apiKey,undefined);assert.equal(connection.endpoint.model,undefined);assert.equal(connection.endpoint.keyEnv,undefined);
  const status=await new MediaService({} as Store,{} as Assets,'python',resolver).analysisStatus(c,'tts');
  assert.equal(status.configured,true);assert.equal(status.keyConfigured,false);assert.equal(status.model,'v4');
  assert.doesNotMatch(JSON.stringify(status),/references|weights|localhost/);
  await assert.rejects(resolver.resolve({...c,skills:[]},'tts'),/VOICE_OUTPUT_DISABLED/);
});

test('media inherits frozen persona defaults and explicit tool parameters win without changing the endpoint',async t=>{
  const jobs:MediaWorkerJob[]=[];
  const f=await fixture(t,{run:async(job,_signal,credentials)=>{assert.deepEqual(credentials,{});jobs.push(job);validateMediaWorkerJob(job);return{assets:[]};}});
  const frozen=config('a',{voice:'persona-a'});
  await f.media.run('scope-a','voice_speak',frozen,[],{text:'你好'},new AbortController().signal);
  await f.media.run('scope-b','voice_speak',frozen,[],{text:'你好',voice:'explicit',format:'mp3',baseUrl:'http://untrusted.invalid'},new AbortController().signal);
  assert.deepEqual(jobs[0].parameters,{text:'你好',voice:'persona-a',format:'wav'});
  assert.equal(jobs[1].parameters.voice,'explicit');assert.equal(jobs[1].parameters.format,'mp3');
  assert.equal(jobs[1].endpoint?.baseUrl,'http://localhost:9880');assert.equal(jobs[1].endpoint?.voice,'persona-a');
  assert.throws(()=>validateMediaWorkerJob({...jobs[0],operation:'video_analyze'}),/MEDIA_WORKER_ENDPOINT_INVALID/);
  assert.throws(()=>validateMediaWorkerJob({...jobs[0],endpoint:{...jobs[0].endpoint,refAudioPath:''}}),/MEDIA_WORKER_ENDPOINT_INVALID/);
});

test('speech persona defaults also reach the worker and retain secret injection',async t=>{
  let captured:MediaWorkerJob|undefined;
  const f=await fixture(t,{run:async(job,_signal,credentials)=>{captured=job;assert.deepEqual(credentials,{VOICE_KEY:'fixture'});return{};}});
  const native=new MediaService(f.store,f.media.assets,'python',{resolve:async()=>({provider:'speech',apiKey:'fixture',endpoint:{baseUrl:'https://example.invalid/v1',model:'tts',keyEnv:'VOICE_KEY',protocol:'speech'}})},f.media.worker);
  await native.run('speech','voice_speak',config('native',{protocol:'speech',voice:'nova',format:'wav'}),[],{text:'Hello'},new AbortController().signal);
  assert.equal(captured?.parameters.voice,'nova');assert.equal(captured?.parameters.format,'wav');
});

test('service queue normalizes addresses, cancels waiting callers, and releases failed leases',async()=>{
  const queue=new VoiceServiceQueue(),signal=new AbortController().signal;
  const release=await queue.acquire('http://LOCALHOST:9880/',signal);
  const cancelled=new AbortController();const waiting=queue.acquire('http://localhost:9880',cancelled.signal);
  const rejected=assert.rejects(waiting,/cancel waiting/);cancelled.abort(new Error('cancel waiting'));await rejected;
  let acquired=false;const next=queue.acquire('http://localhost:9880/',signal).then(done=>{acquired=true;return done;});
  await Promise.resolve();assert.equal(acquired,false);
  const other=await queue.acquire('http://localhost:9881',signal);other();
  release();release();const done=await next;done();
  (await queue.acquire('http://localhost:9880',signal))();
});

test('shared service requests serialize whole workers and reauthorize after waiting',async t=>{
  const entered=deferred(),finish=deferred();const order:string[]=[];let active=0;
  const f=await fixture(t,{run:async job=>{assert.equal(active++,0);order.push(String(job.parameters.text));if(job.parameters.text==='first'){entered.resolve();await finish.promise;}active--;return{};}});
  const first=f.media.run('first','voice_speak',config('a'),[],{text:'first'},new AbortController().signal);await entered.promise;
  let allowed=true;const second=f.media.run('second','voice_speak',config('b'),[],{text:'second'},new AbortController().signal,()=>{if(!allowed)throw new Error('REVOKED');});
  const rejected=assert.rejects(second,/REVOKED/);allowed=false;finish.resolve();await first;await rejected;
  assert.deepEqual(order,['first']);
  await f.media.run('third','voice_speak',config('b'),[],{text:'third'},new AbortController().signal);
  assert.deepEqual(order,['first','third']);
});

test('worker failure releases the service for a fresh complete task',async t=>{
  let calls=0;const f=await fixture(t,{run:async()=>{if(++calls===1)throw new Error('GPT_SOVITS_HTTP_400');return{};}});
  const run=(scope:string)=>f.media.run(scope,'voice_speak',config(),[],{text:'Hello'},new AbortController().signal);
  await assert.rejects(run('first'),/GPT_SOVITS_HTTP_400/);await run('next');assert.equal(calls,2);
});

test('two successful personas never interleave model/reference/inference work on one service',async t=>{
  const entered=deferred(),finish=deferred(),queued=deferred();const order:string[]=[];
  const f=await fixture(t,{run:async job=>{
    const voice=String(job.endpoint?.voice);order.push(`${voice}:weights`);
    if(voice==='a'){entered.resolve();await finish.promise;}
    order.push(`${voice}:reference`,`${voice}:tts`);return{};
  }});
  const first=f.media.run('a','voice_speak',config('a'),[],{text:'A'},new AbortController().signal);await entered.promise;
  const patch=f.store.patchJob.bind(f.store);f.store.patchJob=(id,value)=>{const result=patch(id,value);if(value.state==='queued')queued.resolve();return result;};
  const second=f.media.run('b','voice_speak',config('b'),[],{text:'B'},new AbortController().signal);
  await queued.promise;assert.deepEqual(order,['a:weights']);finish.resolve();await Promise.all([first,second]);
  assert.deepEqual(order,['a:weights','a:reference','a:tts','b:weights','b:reference','b:tts']);
});
