import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import type {Context} from '@deepseek-ai/cordis';
import {Assets,MediaService} from '../src/core/media.js';
import {Store} from '../src/infrastructure/sqlite/store.js';
import {configSchema} from '../src/core/types.js';
import {HarnessMediaProvider} from '../src/harness/media-provider.js';
import {VoiceServiceQueue} from '../src/core/voice-service-queue.js';
import {type MediaWorkerJob,type WorkerPort} from '../src/core/worker-port.js';

const config=(id='a',voice:Record<string,unknown>={})=>configSchema.parse({id,name:id,personaPrompt:'Hello',media:{voice:{enabled:true,protocol:'edge_tts',...voice}}});
const resolver=new HarnessMediaProvider({} as Context);

async function fixture(t:TestContext,worker:WorkerPort){
  const home=await mkdtemp(path.resolve('.codex/gpt-media-'));const store=new Store(home,path.join(home,'personas'));
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  const assets=new Assets(store.repositories());assets.workspace=async scope=>path.join(home,'workspaces',scope);return{store,media:new MediaService(store.repositories(),assets,'python',resolver,worker)};
}

test('Edge TTS persona defaults reach the worker without credentials',async t=>{
  let captured:MediaWorkerJob|undefined;
  const f=await fixture(t,{run:async(job,_signal,credentials)=>{captured=job;assert.deepEqual(credentials,{});return{};}});
  const edge=new MediaService(f.store.repositories(),f.media.assets,'python',{resolve:async()=>({provider:'edge_tts',endpoint:{protocol:'edge_tts',voice:'en-US-AriaNeural'}})},f.media.worker);
  await edge.run('edge','voice_speak',config('native',{protocol:'edge_tts',voice:'en-US-AriaNeural',format:'mp3'}),[],{text:'Hello'},new AbortController().signal);
  assert.equal(captured?.parameters.voice,'en-US-AriaNeural');assert.equal(captured?.parameters.format,'mp3');
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
