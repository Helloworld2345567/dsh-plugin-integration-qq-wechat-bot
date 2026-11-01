import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {encode} from 'silk-wasm';
import {Assets,MediaService} from '../src/core/media.js';
import {Store} from '../src/core/store.js';
import {botSchema} from '../src/core/types.js';
import type {MediaWorkerJob,WorkerPort} from '../src/core/worker-port.js';

function pcm(){
  const bytes=Buffer.alloc(9600);
  for(let i=0;i<bytes.length/2;i++)bytes.writeInt16LE(Math.round(5000*Math.sin(i*2*Math.PI*440/24000)),i*2);
  return bytes;
}
function wav(){
  const data=pcm(),header=Buffer.alloc(44);
  header.write('RIFF');header.writeUInt32LE(36+data.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);
  header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);
  header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);
  return Buffer.concat([header,data]);
}
async function fixture(t:TestContext){
  const home=await mkdtemp(path.resolve('.codex/audio-decoding-')),store=new Store(home,path.join(home,'personas')),assets=new Assets(store);
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true}));
  const binding=store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'});
  let captured:{job:MediaWorkerJob;bytes:Buffer}|undefined;
  const worker:WorkerPort={run:async job=>{captured={job,bytes:await readFile(job.inputs[0].path)};return{text:'{"transcript":"fixture"}'};}};
  const media=new MediaService(store,assets,'python',{resolve:async()=>({provider:'fixture',apiKey:'fixture-key',endpoint:{baseUrl:'https://example.invalid/v1',model:'fixture',keyEnv:'FIXTURE_KEY',protocol:'chat_completions'}})},worker);
  const transcribe=async(bytes:Buffer,name:string,mime:string)=>{
    const asset=await assets.save(binding.key,{kind:'audio',name,mime},bytes);
    await media.run(binding.key,'transcribe',store.config('default'),[asset.id],{},new AbortController().signal);
    assert.deepEqual(await assets.read(binding.key,asset.id),bytes,'decoding must preserve the received attachment');
    assert.ok(captured);return{...captured,asset};
  };
  return{transcribe};
}

for(const wrapper of [false,true])test(`SILK mislabeled as AMR is decoded to WAV${wrapper?' after its AMR wrapper is removed':''}`,async t=>{
  const f=await fixture(t),silk=Buffer.from((await encode(pcm(),24000)).data);
  const source=wrapper?Buffer.concat([Buffer.from('#!AMR\n'),silk]):silk;
  const {job,bytes,asset}=await f.transcribe(source,'voice.amr','audio/amr');
  assert.equal(job.inputs[0].mime,'audio/wav');assert.equal(job.inputs[0].name,'decoded.wav');assert.notEqual(job.inputs[0].path,asset.path);
  assert.equal(bytes.subarray(0,4).toString(),'RIFF');assert.equal(bytes.subarray(8,12).toString(),'WAVE');
  assert.equal(bytes.readUInt32LE(24),24000);assert.equal(bytes.readUInt16LE(22),1);assert.equal(bytes.readUInt32LE(40),pcm().length);
  assert.ok(bytes.subarray(44).some(byte=>byte!==0),'the SILK decoder must return actual PCM samples');
});

test('WAV audio with an incorrect SILK MIME remains unchanged for the audio worker',async t=>{
  const f=await fixture(t),source=wav();
  const {job,bytes,asset}=await f.transcribe(source,'voice.wav','audio/silk');
  assert.equal(job.inputs[0].path,asset.path);assert.deepEqual(bytes,source);
});

test('AMR audio without a SILK header is passed to the audio worker unchanged',async t=>{
  // AMR-NB no-data frames have no payload and use frame type 15 with Q=1.
  const f=await fixture(t),source=Buffer.concat([Buffer.from('#!AMR\n'),Buffer.alloc(10,0x7c)]);
  const {job,bytes,asset}=await f.transcribe(source,'voice.amr','audio/amr');
  assert.equal(job.inputs[0].path,asset.path);assert.equal(job.inputs[0].mime,'audio/amr');assert.deepEqual(bytes,source);
});
