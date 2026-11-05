import {testServiceProfiles} from './test-service-profiles.js';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {Assets,MediaService} from '../src/core/media.js';
import {botSchema,configSchema,type CallerScope} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';
import {executeMusicTool,type MusicContext} from '../src/harness/music-tool.js';
import {executeSingingTool} from '../src/harness/singing-tool.js';
import {musicCandidates,clearMusicState} from '../src/core/music-state.js';
import type {MediaWorkerJob} from '../src/core/worker-port.js';
import {NativeHarness} from '../src/harness/bridge.js';
import {runJsonProcess} from '../src/harness/json-process.js';
import {ServiceContractError} from '../src/core/service-errors.js';
import {seedAppliedConfig} from './sqlite-fixtures.js';

const track={source:'MiguMusicClient',id:'song-1',title:'晴天',artist:'周杰伦',format:'mp3',duration:269,size:100,locator:{privateDownloadUrl:'https://provider.invalid/private'}};
async function fixture(t:TestContext){
  await mkdir(path.resolve('.codex'),{recursive:true});const home=await mkdtemp(path.resolve('.codex/music-host-')),store=new SqlitePersistence(home,path.join(home,'personas'));
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  const config=configSchema.parse({schemaVersion:4,id:'music',name:'Music',personaPrompt:'Hello',skills:['music-download','singing-conversion'],tools:['bot_music','bot_sing'],media:{music:{enabled:true,profileRef:{serviceId:'music',profileId:'default'}},singing:{enabled:true,profileRef:{serviceId:'rvc',profileId:'default'}}}});seedAppliedConfig(store,config);
  const bot=store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',enabled:true,configId:config.id})),scope:CallerScope={botId:'bot',platform:'qq',accountId:'bot',kind:'private',channelId:'alice',senderId:'alice'},binding=store.sessions.binding(scope);
  const assets=new Assets(store.repositories());assets.workspace=async key=>path.join(home,'workspaces',key);
  const live:MusicContext&{singing:{attempted:boolean}}={binding,snapshot:freezeTurn(config,bot,scope,['request'],testServiceProfiles()),assets:[],singing:{attempted:false}};
  const calls:string[]=[],jobs:MediaWorkerJob[]=[];let format='mp3',hook:((job:MediaWorkerJob)=>Promise<void>)|undefined;
  const worker={run:async(job:MediaWorkerJob)=>{calls.push(job.operation);jobs.push(job);await hook?.(job);
    if(job.operation==='music_search')return {music:{candidates:[track,{...track,id:'song-2',title:'晴天（现场）'}],diagnostics:[{source:'MiguMusicClient',status:'success'}]}};
    const name=job.operation==='music_acquire'?`source.${format}`:'result.mp3',file=path.join(job.output,name);await writeFile(file,'audio');
    if(job.operation==='music_acquire'){const lyric=path.join(job.output,'song.lrc');await writeFile(lyric,'[00:00]歌词');return {assets:[{path:file,name,mime:format==='mp3'?'audio/mpeg':'audio/flac',kind:'audio' as const},{path:lyric,name:'song.lrc',mime:'text/plain',kind:'file' as const}],music:{track:{...track,format}}};}
    return {assets:[{path:file,name,mime:'audio/mpeg',kind:'audio' as const}]};
  }};
  const serviceRuntime={execute:async(request:any)=>{
    request.authorize?.();
    const operation=({'music.search':'music_search','music.acquire':'music_acquire','rvc.convert':'singing_convert'} as const)[request.operation as 'music.search'|'music.acquire'|'rvc.convert'];
    const result=await worker.run({protocol:'dsh.media-worker',protocolVersion:1,id:'fixture',scope:request.scopeKey,operation,handler:'skill',inputs:request.resolvedInputs,parameters:request.parameters,output:request.outputDirectory,usagePath:path.join(request.outputDirectory,'usage.json'),deadline:request.deadline,timeoutMs:240000,quotaUnits:1} as MediaWorkerJob);
    return {outputs:result.assets?.map(file=>({kind:file.kind,path:file.path,relativePath:file.name,mime:file.mime}))??[],observations:{music:result.music}};
  }};
  const media=new MediaService(store.repositories(),assets,undefined,undefined,worker,undefined,undefined,serviceRuntime as any),deps={repos:{bindings:store.sessions,music:store.musicState,singing:store.singingState,personas:store.personas,capabilities:store.capability,assets:store.assets},assets,media,current:()=>config,bot:()=>bot};
  const call=(args:Record<string,unknown>,signal=new AbortController().signal)=>executeMusicTool(live,args,signal,deps);
  return {home,store,assets,config,bot,binding,live,media,deps,call,calls,jobs,setFormat:(value:string)=>{format=value;},setHook:(value:typeof hook)=>{hook=value;}};
}

test('music search exposes scoped choices without provider URLs or identifiers',async t=>{
  const f=await fixture(t),result=JSON.parse(await f.call({action:'search',song:'晴天',artist:'周杰伦'}));
  assert.equal(result.candidates.length,2);assert.equal(result.candidates[0].number,1);assert.equal(result.candidates[0].artist,'周杰伦');
  assert.doesNotMatch(JSON.stringify(result),/private|locator|song-1/);assert.equal(f.live.assets.length,0);
  assert.ok(musicCandidates({bindings:f.store.sessions,music:f.store.musicState},f.binding)?.candidates[0].locator);
  const replaced=JSON.parse(await f.call({action:'search',song:'晴天'}));assert.notEqual(result.candidateSet,replaced.candidateSet);
  await assert.rejects(f.call({action:'download',candidateSet:result.candidateSet,candidate:1}),/MUSIC_CANDIDATES_STALE/);
  f.store.sessions.reset(f.binding.scope);await assert.rejects(f.call({action:'download',candidateSet:replaced.candidateSet,candidate:1}),/MUSIC_SESSION_CHANGED/);
});
test('small native MP3 is downloaded once and directly registered without another asset or encoding',async t=>{
  const f=await fixture(t),args={action:'download',song:'晴天',artist:'周杰伦'};
  const first=JSON.parse(await f.call(args));assert.equal(first.track.title,'晴天');assert.deepEqual(first.files,['source.mp3']);assert.equal(f.live.assets.length,1);
  const source=f.store.musicState.acquisition(f.binding.key);assert.deepEqual(source!.deliveryAssetIds,[source!.sourceAssetId]);
  const again=JSON.parse(await f.call({...args,includeLyrics:true}));assert.equal(again.reused,true);assert.equal(f.live.assets.length,1,'tool arguments cannot override the frozen includeLyrics=false preference');assert.deepEqual(f.calls,['music_acquire']);
  assert.equal(f.store.jobs.jobs().length,1);assert.equal((f.store.capability.statuses().find((row:any)=>row.role==='music') as any)?.status,'PASS');
  assert.doesNotMatch(JSON.stringify(again),/assetId|locator|provider.invalid|sourceAsset/);
});
test('non-MP3 is acquired once and encoded once, with frozen lyrics disabled',async t=>{
  const f=await fixture(t);f.setFormat('flac');const args={action:'download',song:'晴天'};
  const response=JSON.parse(await f.call(args));await f.call(args);assert.deepEqual(f.calls,['music_acquire','music_delivery']);assert.equal(f.live.assets.length,1);
  assert.equal(response.track.format,'flac');assert.equal(response.delivery.format,'mp3');assert.equal(response.delivery.transcoded,true);
  assert.deepEqual(f.jobs[1].inputs.map(file=>file.name),['source.flac']);
});
test('failed acquisition and failed delivery are not automatically repeated in one request',async t=>{
  const f=await fixture(t);f.setHook(async()=>{throw Error('private-path-secret');});
  await assert.rejects(f.call({action:'download',song:'晴天'}),/^Error: MUSIC_OPERATION_FAILED$/);await assert.rejects(f.call({action:'download',song:'晴天'}),/MUSIC_OPERATION_FAILED/);assert.deepEqual(f.calls,['music_acquire']);
  f.live.snapshot=freezeTurn(f.config,f.bot,f.binding.scope,['new-request'],testServiceProfiles());f.setFormat('flac');f.setHook(async job=>{if(job.operation==='music_delivery')throw Error('bad encode');});
  await assert.rejects(f.call({action:'download',song:'晴天'}),/MUSIC_OPERATION_FAILED/);await assert.rejects(f.call({action:'download',song:'晴天'}),/MUSIC_OPERATION_FAILED/);
  assert.deepEqual(f.calls,['music_acquire','music_acquire','music_delivery']);assert.equal(f.live.assets.length,0);
});

test('download and named singing preserve safe music provider codes from service errors',async t=>{
  for(const action of ['download','sing'])await t.test(action,async t=>{
    const f=await fixture(t);f.setHook(async()=>{throw new ServiceContractError({category:'PROVIDER_ERROR',providerCode:'MUSIC_NO_RESULTS',safeDiagnostic:'Private provider detail',retryable:false,blocksService:false},Error('https://provider.invalid/private token=secret'));});
    const call=()=>action==='download'?f.call({action,song:'晴天'}):executeSingingTool(f.live,{action,song:'晴天'},new AbortController().signal,f.deps);
    await assert.rejects(call(),/^Error: MUSIC_NO_RESULTS$/);await assert.rejects(call(),/^Error: MUSIC_NO_RESULTS$/);
    assert.equal(f.store.musicState.acquisition(f.binding.key)?.code,'MUSIC_NO_RESULTS');assert.deepEqual(f.calls,['music_acquire']);assert.equal(f.live.assets.length,0);
  });
});

test('service diagnostics and non-music provider codes remain private',async t=>{
  for(const providerCode of [undefined,'PROVIDER_CONNECT_FAILED','MUSIC_TIMEOUT:private-token'])await t.test(providerCode??'no provider code',async t=>{
    const f=await fixture(t);f.setHook(async()=>{throw new ServiceContractError({category:'PROVIDER_ERROR',providerCode,safeDiagnostic:'MUSIC_PRIVATE_DIAGNOSTIC',retryable:false,blocksService:false},Error('https://provider.invalid/private token=secret'));});
    await assert.rejects(f.call({action:'download',song:'晴天'}),/^Error: MUSIC_OPERATION_FAILED$/);
    assert.equal(f.store.musicState.acquisition(f.binding.key)?.code,'MUSIC_OPERATION_FAILED');
  });
});
test('revocation or session reset after worker execution prevents assets and delivery',async t=>{
  const f=await fixture(t);f.setHook(async()=>{f.deps.current=()=>({...f.config,media:{...f.config.media,music:{enabled:false,includeLyrics:false}}});});
  await assert.rejects(f.call({action:'download',song:'晴天'}),/MUSIC_DISABLED/);assert.equal(f.store.assets.allAssets().length,0);assert.equal(f.live.assets.length,0);
  f.deps.current=()=>f.config;f.live.snapshot=freezeTurn(f.config,f.bot,f.binding.scope,['request-2'],testServiceProfiles());f.setHook(async()=>{f.store.sessions.reset(f.binding.scope);});
  await assert.rejects(f.call({action:'download',song:'晴天'}),/MUSIC_SESSION_CHANGED/);assert.equal(f.store.assets.allAssets().length,0);
});
test('an explicit new request retries failed encoding using the already acquired source',async t=>{
  const f=await fixture(t);f.setFormat('flac');f.setHook(async job=>{if(job.operation==='music_delivery')throw Error('temporary encode failure');});
  await assert.rejects(f.call({action:'download',song:'晴天'}),/MUSIC_OPERATION_FAILED/);
  f.live.snapshot=freezeTurn(f.config,f.bot,f.binding.scope,['explicit-retry'],testServiceProfiles());f.setHook(undefined);
  const result=JSON.parse(await f.call({action:'download',song:'晴天'}));assert.equal(result.status,'succeeded');
  assert.deepEqual(f.calls,['music_acquire','music_delivery','music_delivery']);assert.equal(f.live.assets.length,1);
});
test('asset ownership is rechecked after asynchronous writes and generation changes',async t=>{
  const f=await fixture(t);let calls=0;const original=f.assets.workspace.bind(f.assets);
  f.assets.workspace=async scope=>{if(++calls===2)f.store.sessions.reset(f.binding.scope);return original(scope);};
  await assert.rejects(f.call({action:'download',song:'晴天'}),/MUSIC_SESSION_CHANGED/);assert.equal(f.store.assets.allAssets().length,0);assert.equal(f.live.assets.length,0);
});
test('a new request can retry failed acquisition, while a successful current-session source is reused',async t=>{
  const f=await fixture(t);await f.call({action:'download',song:'晴天'});f.live.snapshot=freezeTurn(f.config,f.bot,f.binding.scope,['request-2'],testServiceProfiles());await f.call({action:'download',song:'晴天'});assert.deepEqual(f.calls,['music_acquire']);
  clearMusicState(f.store.musicState,f.binding.key);assert.equal(f.store.musicState.acquisition(f.binding.key),null);
});
test('named singing reuses the downloaded original and never makes a delivery MP3 before RVC',async t=>{
  const f=await fixture(t);f.setFormat('flac');await f.call({action:'download',song:'晴天'});const acquired=f.store.musicState.acquisition(f.binding.key);assert.ok(acquired?.sourceAssetId);
  f.live.snapshot=freezeTurn(f.config,f.bot,f.binding.scope,['sing-request'],testServiceProfiles());f.live.assets=[];
  const args={action:'sing',song:'晴天'};const result=JSON.parse(await executeSingingTool(f.live,args,new AbortController().signal,f.deps));
  assert.equal(result.track.title,'晴天');assert.deepEqual(f.calls,['music_acquire','music_delivery','singing_convert']);assert.equal(f.live.assets.length,1);
  assert.equal(f.jobs[2].inputs[0].path,f.store.assets.asset(f.binding.key,acquired.sourceAssetId).path);assert.deepEqual(f.jobs[2].parameters,{sourceType:'mixed',format:'mp3'});
  await executeSingingTool(f.live,args,new AbortController().signal,f.deps);assert.equal(f.calls.filter(value=>value==='singing_convert').length,1);
});
test('selected candidate is preserved when directly singing and original audio is not sent',async t=>{
  const f=await fixture(t),prepared=JSON.parse(await f.call({action:'search',song:'晴天'}));
  await executeSingingTool(f.live,{action:'sing',candidateSet:prepared.candidateSet,candidate:2},new AbortController().signal,f.deps);
  assert.equal((f.jobs.find(job=>job.operation==='music_acquire')!.parameters.selection as any).id,'song-2');assert.deepEqual(f.calls,['music_search','music_acquire','singing_convert']);assert.equal(f.live.assets.length,1);
});
test('an existing attachment conversion attempt blocks a second named-song acquisition',async t=>{
  const f=await fixture(t),input=await f.assets.save(f.binding.key,{kind:'audio',name:'vocals.wav',mime:'audio/wav'},Buffer.from('source'));
  const prepared=JSON.parse(await executeSingingTool(f.live,{action:'prepare',inputs:[input.id]},new AbortController().signal,f.deps));
  await executeSingingTool(f.live,{action:'convert',candidateSet:prepared.candidateSet,candidate:1,sourceType:'vocals'},new AbortController().signal,f.deps);
  await assert.rejects(executeSingingTool(f.live,{action:'sing',song:'晴天'},new AbortController().signal,f.deps),/SINGING_ALREADY_ATTEMPTED/);assert.deepEqual(f.calls,['singing_convert']);
});
test('music cannot bypass the dedicated tool through bot_media',async()=>{
  for(const operation of ['music_search','music_acquire','music_delivery'])await assert.rejects((NativeHarness.prototype as any).mediaTool.call({},{} as any,undefined,operation,[],{},new AbortController().signal),/MUSIC_USE_BOT_MUSIC/);
});
test('JSON process drains diagnostics, handles UTF-8 and is cancellable',async t=>{
  const directory=await mkdtemp(path.resolve('.codex/music-process-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const response=await runJsonProcess(process.execPath,['-e',`process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write('diagnostics');process.stdout.write(JSON.stringify({title:'晴天'}));});`],{}, {cwd:directory,signal:new AbortController().signal});assert.equal(response.title,'晴天');
  const controller=new AbortController(),pending=runJsonProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{}, {cwd:directory,signal:controller.signal});setTimeout(()=>controller.abort(),100);
  await assert.rejects(pending,/MEDIA_CANCELLED_OR_TIMEOUT/);assert.deepEqual(await readdir(directory),[]);
});
test('JSON process cancellation terminates descendants before job cleanup',async t=>{
  const directory=await mkdtemp(path.resolve('.codex/music-tree-'));t.after(()=>rm(directory,{recursive:true,force:true}));const marker=path.join(directory,'late.txt'),ready=path.join(directory,'ready.txt');
  const child=`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'late'),1000);`;
  const parent=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`;
  const controller=new AbortController(),pending=runJsonProcess(process.execPath,['-e',parent],{}, {cwd:directory,signal:controller.signal});
  for(let count=0;count<50;count++){if((await readdir(directory)).includes('ready.txt'))break;await new Promise(done=>setTimeout(done,20));}
  assert.ok((await readdir(directory)).includes('ready.txt'));controller.abort();await assert.rejects(pending,/MEDIA_CANCELLED_OR_TIMEOUT/);
  await new Promise(done=>setTimeout(done,1100));assert.equal((await readdir(directory)).includes('late.txt'),false);
});
