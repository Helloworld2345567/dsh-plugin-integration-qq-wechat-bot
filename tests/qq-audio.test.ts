import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {decode,encode,getDuration,isSilk} from 'silk-wasm';
import {createQQAudioPreparer} from '../src/channels/qq-audio.js';
import {Assets} from '../src/core/media.js';
import {Store} from '../src/core/store.js';
import {botSchema,type Asset,type ChannelOutboundContext} from '../src/core/types.js';
import {TransformSlots} from '../src/core/transform-slots.js';
import {NodeControlledProcessPort,type ControlledProcessPort} from '../src/harness/controlled-process.js';

function pcm(samples:number){const bytes=Buffer.alloc(samples*2);for(let sample=0;sample<samples;sample++)bytes.writeInt16LE(Math.round(5000*Math.sin(sample*2*Math.PI*440/24000)),sample*2);return bytes;}
function wav(data:Buffer){const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(data.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(data.length,40);return Buffer.concat([header,data]);}
async function fixture(t:TestContext){
  await mkdir(path.resolve('.codex'),{recursive:true});const home=await mkdtemp(path.resolve('.codex/qq-audio-')),store=new Store(home,path.join(home,'personas')),assets=new Assets(store);assets.workspace=async()=>path.join(home,'workspace');
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});store.saveBot(botSchema.parse({id:'qq-audio',name:'QQ audio',channel:'qq',accountId:'account',enabled:true}));
  const binding=store.binding({botId:'qq-audio',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'}),controller=new AbortController();let allowed=true;
  const context=(source:Asset):ChannelOutboundContext=>({binding,outputs:[{type:'asset',assetId:source.id}],signal:controller.signal,authorize:()=>{if(!allowed)throw Error('REVOKED');}});
  const source=(bytes:Buffer,name='source.wav',mime='audio/wav')=>assets.save(binding.key,{kind:'audio',name,mime},bytes,'source-job','generated',binding.sessionId,binding.generation,undefined,{serviceId:'rvc',profileId:'voice',profileRevision:1,profileContentHash:'a'.repeat(64)});
  const temporaryFiles=async()=>{try{return await readdir(path.join(home,'workspace','.bot','tmp'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return[];throw error;}};
  return{home,store,assets,binding,controller,context,source,temporaryFiles,revoke:()=>{allowed=false;}};
}

test('QQ short WAV becomes real SILK with a complete final frame, inherited ownership and reusable cache',async t=>{
  const f=await fixture(t),original=wav(pcm(5161)),source=await f.source(original),processes=new NodeControlledProcessPort();let calls=0;
  const port:ControlledProcessPort={run:request=>{calls++;return processes.run(request);},cancel:id=>processes.cancel(id)},prepare=createQQAudioPreparer(f.store,f.assets,{processes:port,slots:new TransformSlots(1)}),context=f.context(source);context.outputs.unshift({type:'text',text:'AI voice'});
  const outputs=await prepare(context);assert.equal(outputs.length,2);assert.equal(outputs[0].text,'AI voice');const voice=await f.assets.resolve(f.binding.key,outputs[1].assetId!),bytes=await readFile(voice.path),decoded=await decode(bytes,24000);
  assert.ok(isSilk(bytes));assert.equal(getDuration(bytes),220);assert.equal(decoded.data.length,5280*2);assert.ok(decoded.data.some(byte=>byte!==0));assert.equal(voice.mime,'audio/silk');assert.equal(voice.sessionId,f.binding.sessionId);assert.deepEqual(voice.serviceSnapshot,source.serviceSnapshot);assert.equal(outputs[1].asFile,undefined);
  assert.deepEqual(await f.assets.read(f.binding.key,source.id),original);assert.deepEqual(await prepare(context),outputs);assert.equal(calls,1);assert.deepEqual(await f.temporaryFiles(),[]);
  const resend=await prepare({...context,outputs:[{type:'asset',assetId:source.id,resend:true}]});assert.equal(resend[0].assetId,voice.id);assert.equal(resend[0].resend,true);assert.equal(calls,1);
});

test('QQ long WAV covers every sample in 300-second SILK parts and retains a complete MP3',async t=>{
  const f=await fixture(t),samples=24000*300+241,original=wav(pcm(samples)),source=await f.source(original),processes=new NodeControlledProcessPort();let calls=0;
  const port:ControlledProcessPort={run:request=>{calls++;return processes.run(request);},cancel:id=>processes.cancel(id)},prepare=createQQAudioPreparer(f.store,f.assets,{processes:port}),outputs=await prepare(f.context(source));
  assert.equal(outputs.length,3);const parts=await Promise.all(outputs.slice(0,2).map(output=>f.assets.resolve(f.binding.key,output.assetId!))),silks=await Promise.all(parts.map(part=>readFile(part.path)));
  const durations=silks.map(bytes=>getDuration(bytes));assert.deepEqual(durations,[300000,20]);const framedSamples=durations.reduce((total,duration)=>total+duration*24,0);assert.equal(framedSamples,Math.ceil(samples/480)*480);assert.ok(framedSamples>=samples&&framedSamples-samples<480);
  const decoded=await Promise.all(silks.map(bytes=>decode(bytes,24000)));for(const [index,value] of decoded.entries()){assert.ok(value.data.length>=durations[index]*48&&value.data.length<=durations[index]*48+960,'the real decoder retains the full framed audio, with at most its final decoder frame');assert.ok(value.data.some(byte=>byte!==0));}
  for(const part of parts){assert.equal(part.jobId,`qq-voice:${source.id}:300s:v1`);assert.deepEqual(part.serviceSnapshot,source.serviceSnapshot);}
  const full=await f.assets.resolve(f.binding.key,outputs[2].assetId!);assert.equal(outputs[2].asFile,true);assert.equal(full.mime,'audio/mpeg');assert.ok((await readFile(full.path)).length>0);assert.equal(calls,2);assert.deepEqual(await prepare(f.context(source)),outputs);assert.equal(calls,2);assert.deepEqual(await f.assets.read(f.binding.key,source.id),original);assert.deepEqual(await f.temporaryFiles(),[]);
  const mp3Bytes=await readFile(full.path),mp3Outputs=await prepare(f.context(full));assert.equal(mp3Outputs.at(-1)!.assetId,full.id);assert.equal(mp3Outputs.at(-1)!.asFile,true);assert.deepEqual(await readFile(full.path),mp3Bytes);assert.equal(calls,3,'an existing MP3 is not encoded again for file delivery');
});

test('QQ existing short SILK and explicitly requested files require no FFmpeg',async t=>{
  const f=await fixture(t),bytes=Buffer.from((await encode(pcm(4800),24000)).data),source=await f.source(bytes,'voice.silk','audio/silk');let calls=0;
  const prepare=createQQAudioPreparer(f.store,f.assets,{processes:{run:async()=>{calls++;throw Error('unexpected process');},cancel:async()=> 'cancelled'}});
  assert.deepEqual(await prepare(f.context(source)),f.context(source).outputs);assert.deepEqual(await prepare({...f.context(source),outputs:[{type:'asset',assetId:source.id,asFile:true}]}),[{type:'asset',assetId:source.id,asFile:true}]);assert.equal(calls,0);
});

test('QQ rejects unavailable FFmpeg without registering partial derived assets',async t=>{
  const f=await fixture(t),source=await f.source(wav(pcm(4800))),prepare=createQQAudioPreparer(f.store,f.assets,{ffmpeg:path.join(f.home,'missing-ffmpeg.exe')});
  await assert.rejects(prepare(f.context(source)),/QQ_AUDIO_FFMPEG_UNAVAILABLE/);assert.deepEqual(f.store.list<Asset>('asset').map(asset=>asset.id),[source.id]);assert.deepEqual(await f.temporaryFiles(),[]);
});

test('QQ cancels preparation while queued and rechecks revocation after FFmpeg',async t=>{
  for(const mode of ['cancel','revoke'])await t.test(mode,async t=>{
    const f=await fixture(t),source=await f.source(wav(pcm(4800))),slots=new TransformSlots(1),held=mode==='cancel'?await slots.acquire(1,new AbortController().signal):undefined,real=new NodeControlledProcessPort();let calls=0;
    const prepare=createQQAudioPreparer(f.store,f.assets,{slots,processes:{run:async request=>{calls++;const result=await real.run(request);f.revoke();return result;},cancel:id=>real.cancel(id)}}),pending=prepare(f.context(source));
    if(mode==='cancel')f.controller.abort(Error('CANCELLED'));
    await assert.rejects(pending,mode==='cancel'?/CANCELLED/:/REVOKED/);held?.release();assert.equal(calls,mode==='cancel'?0:1);assert.deepEqual(f.store.list<Asset>('asset').map(asset=>asset.id),[source.id]);assert.deepEqual(await f.temporaryFiles(),[]);
  });
});

test('QQ rolls back newly registered derivatives when a later asset save is revoked',async t=>{
  const f=await fixture(t),first=await f.source(wav(pcm(4800)),'first.wav'),second=await f.source(wav(pcm(4801)),'second.wav'),save=f.assets.save.bind(f.assets);let derivativeSaves=0;
  f.assets.save=async(...args:Parameters<Assets['save']>)=>{if(args[3]?.startsWith('qq-voice:')&&++derivativeSaves===2)f.revoke();return save(...args);};
  await assert.rejects(createQQAudioPreparer(f.store,f.assets)({...f.context(first),outputs:[{type:'asset',assetId:first.id},{type:'asset',assetId:second.id}]}),/REVOKED/);
  assert.deepEqual(new Set(f.store.list<Asset>('asset').map(asset=>asset.id)),new Set([first.id,second.id]));assert.deepEqual(await f.temporaryFiles(),[]);
});
