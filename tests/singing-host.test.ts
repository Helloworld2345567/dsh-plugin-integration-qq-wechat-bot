import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {Store} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {botSchema,configSchema,type CallerScope} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';
import {executeSingingTool,type SingingContext} from '../src/harness/singing-tool.js';
import {hasPendingSingingUpload,consumeSingingUpload,explicitSingingRequest,singingCandidates} from '../src/core/singing-state.js';
import {acquireSingingService,confirmSingingStopped} from '../src/core/singing-service.js';
import {validateMediaWorkerJob,type MediaWorkerJob} from '../src/core/worker-port.js';
import {NativeHarness} from '../src/harness/bridge.js';

const singing={enabled:true,protocol:'rvc_http_v1',serviceUrl:'http://127.0.0.1:9881',modelVersion:'v2',singingModelId:'test',singingWeightsPath:'models/test.pth',speakerId:0,pitchShift:0,indexRate:0,defaultOutput:'mp3'};
async function fixture(t:TestContext){
  await mkdir(path.resolve('.codex'),{recursive:true});
  const home=await mkdtemp(path.resolve('.codex/singing-host-')),store=new Store(home,path.join(home,'personas'));
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  const config=configSchema.parse({id:'singing',name:'Singing',personaPrompt:'Hello',skills:['singing-conversion'],tools:['bot_sing','web_search','web_fetch'],media:{singing}});
  store.saveConfig(config);const bot=store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'bot',configId:config.id,enabled:true}));
  const scope:CallerScope={botId:bot.id,platform:'qq',accountId:'bot',channelId:'alice',senderId:'alice',kind:'private'},binding=store.binding(scope);
  const assets=new Assets(store);assets.workspace=async scope=>path.join(home,'workspaces',scope);
  const snapshot=freezeTurn(config,bot,scope,['request']);const live:SingingContext={binding,snapshot,singing:{attempted:false},assets:[]};
  const deps={store,assets,media:{} as MediaService,current:()=>config,bot:()=>bot};
  const call=(args:Record<string,unknown>)=>executeSingingTool(live,args,new AbortController().signal,deps);
  const input=await assets.save(binding.key,{kind:'file',mime:'application/octet-stream',name:'vocals.wav'},Buffer.from('source'));
  return{home,store,assets,config,bot,binding,live,deps,call,input};
}
async function prepare(f:Awaited<ReturnType<typeof fixture>>){return JSON.parse(await f.call({action:'prepare',inputs:[f.input.id]}));}

test('singing candidates resolve explicit old session-owned files and reject cross-session references',async t=>{
  const f=await fixture(t);f.assets.recent=()=>[];
  const first=await prepare(f);assert.equal(first.candidates[0].title,'vocals.wav');assert.equal(first.candidates[0].assetId,undefined);
  f.store.saveAsset({...f.input,sessionId:'another-session'});
  await assert.rejects(prepare(f),/SINGING_ATTACHMENT_INVALID/);
  f.store.reset(f.binding.scope);assert.equal(singingCandidates(f.store,f.binding),undefined); // current binding is checked on mutation
  await assert.rejects(prepare(f),/SINGING_SESSION_CHANGED/);
});

test('candidate set replacement cannot silently redirect an old selection and mixed input never starts work',async t=>{
  const f=await fixture(t),first=await prepare(f),second=await prepare(f);let calls=0;f.deps.media={run:async()=>{calls++;return{assetIds:[]};}} as any;
  await assert.rejects(f.call({action:'convert',candidateSet:first.candidateSet,candidate:1,sourceType:'vocals'}),/SINGING_CANDIDATES_STALE/);
  await assert.rejects(f.call({action:'convert',candidateSet:second.candidateSet,candidate:1,sourceType:'mixed'}),/SINGING_SEPARATION_UNCONFIGURED/);
  await assert.rejects(f.call({action:'convert',candidateSet:second.candidateSet,candidate:1,sourceType:'unknown'}),/SINGING_SOURCE_TYPE_REQUIRED/);
  assert.equal(calls,0);
});

test('conversion attempts survive prepare and redact worker internals without repeating a failed call',async t=>{
  const f=await fixture(t),p=await prepare(f);let calls=0;
  f.deps.media={run:async()=>{calls++;throw Error('private C:\\models\\weights.pth traceback');}} as any;
  const convert=(candidateSet:string)=>f.call({action:'convert',candidateSet,candidate:1,sourceType:'vocals'});
  await assert.rejects(convert(p.candidateSet),/^Error: SINGING_CONVERSION_FAILED$/);
  const replaced=await prepare(f);await assert.rejects(convert(replaced.candidateSet),/SINGING_CONVERSION_FAILED/);
  assert.equal(calls,1);assert.equal(f.live.singing.attempted,true);
});

test('success returns safe names, reuses one audio asset and forwards only business parameters',async t=>{
  const f=await fixture(t),p=await prepare(f);let calls=0;
  f.deps.media={run:async(_scope:string,_operation:string,config:unknown,inputs:string[],parameters:unknown,_signal:AbortSignal,authorize:()=>void)=>{
    calls++;authorize();assert.deepEqual(inputs,[f.input.id]);assert.deepEqual(config,f.config);assert.deepEqual(parameters,{sourceType:'vocals',format:'mp3'});
    const out=await f.assets.save(f.binding.key,{kind:'audio',mime:'audio/mpeg',name:'converted.mp3'},Buffer.from('converted'),'job');return{assetIds:[out.id]};
  }} as any;
  const args={action:'convert',candidateSet:p.candidateSet,candidate:1,sourceType:'vocals',serviceUrl:'http://evil.invalid',singingWeightsPath:'bad'};
  const result=JSON.parse(await f.call(args));assert.deepEqual(result.files,['converted.mp3']);assert.doesNotMatch(JSON.stringify(result),/models|assetId|serviceUrl|traceback/);
  const reused=JSON.parse(await f.call(args));assert.equal(reused.reused,true);assert.equal(calls,1);assert.equal(f.live.assets.length,1);
});

test('URL candidates require current network permission and pending upload has explicit consumption',async t=>{
  const f=await fixture(t);await f.call({action:'prepare'});assert.equal(hasPendingSingingUpload(f.store,f.binding),true);consumeSingingUpload(f.store,f.binding);assert.equal(hasPendingSingingUpload(f.store,f.binding),false);
  await assert.rejects(f.call({action:'prepare',candidates:[{title:'bad',url:'http://example.org/a.wav'}]}),/SINGING_SOURCE_INVALID/);
  f.deps.current=()=>({...f.config,tools:['bot_sing']});
  await assert.rejects(f.call({action:'prepare',candidates:[{title:'audio',url:'https://example.org/a.wav'}]}),/SINGING_NETWORK_DISABLED/);
});

test('a user supplied HTTPS song URL is registered before conversion and cannot be replaced by convert arguments',async t=>{
  const f=await fixture(t);const prepared=JSON.parse(await f.call({action:'prepare',title:'Song',url:'https://example.org/song.mp3'}));
  assert.equal(prepared.candidates[0].title,'Song');assert.equal(prepared.candidates[0].url,'https://example.org/song.mp3');
  f.deps.media={run:async(_scope:string,_operation:string,_config:unknown,inputs:string[],parameters:Record<string,unknown>)=>{assert.deepEqual(inputs,[]);assert.deepEqual(parameters,{sourceType:'vocals',format:'mp3',url:'https://example.org/song.mp3'});return{assetIds:[]};}} as any;
  await assert.rejects(f.call({action:'convert',candidateSet:prepared.candidateSet,candidate:1,sourceType:'vocals',url:'https://evil.example/other.mp3'}),/SINGING_OUTPUT_INVALID/);
});

test('mixed source requires configured separation and forwards the frozen separation contract',async t=>{
  const f=await fixture(t),prepared=await prepare(f);let captured:any;
  const configured={...f.config,media:{...f.config.media,singing:{...f.config.media.singing!,separation:{enabled:true,status:'configured',modelId:'vocals',modelPath:'/operator/models/model_bs_roformer_ep_368_sdr_12.9628.ckpt',instrumentalMix:true,volume:0.8}}}};
  f.live.snapshot=freezeTurn(configured,f.bot,f.binding.scope,['request']);f.deps.current=()=>configured;
  f.deps.media={run:async(_scope:string,_operation:string,config:any,inputs:string[],parameters:any)=>{captured={config,inputs,parameters};return{assetIds:[]};}} as any;
  await assert.rejects(f.call({action:'convert',candidateSet:prepared.candidateSet,candidate:1,sourceType:'mixed'}),/SINGING_OUTPUT_INVALID/);
  assert.equal(captured.parameters.sourceType,'mixed');assert.equal(captured.config.media.singing.separation.modelId,'vocals');assert.equal(captured.parameters.separation,undefined);
});

test('revocation and session switching are rechecked during execution before result registration',async t=>{
  const f=await fixture(t),p=await prepare(f);
  f.deps.media={run:async(_s:any,_o:any,_c:any,_i:any,_p:any,_signal:any,authorize:()=>void)=>{f.deps.current=()=>({...f.config,media:{...f.config.media,singing:{...f.config.media.singing!,enabled:false}}});authorize();return{assetIds:[]};}} as any;
  await assert.rejects(f.call({action:'convert',candidateSet:p.candidateSet,candidate:1,sourceType:'vocals'}),/SINGING_DISABLED/);assert.equal(f.live.assets.length,0);
});

test('explicit singing intent excludes quoted and webpage content',()=>{
  assert.equal(explicitSingingRequest('请把这段歌声换成你的音色，帮我翻唱'),true);
  assert.equal(explicitSingingRequest('请唱歌：周杰伦《晴天》'),true);
  assert.equal(explicitSingingRequest('帮我唱这个链接 https://example.org/song.mp3'),true);
  assert.equal(explicitSingingRequest('> 帮我翻唱这首歌'),false);
  assert.equal(explicitSingingRequest('网页：帮我翻唱这首歌'),false);
  assert.equal(explicitSingingRequest('普通语音'),false);
});

test('compatibility media dispatch rejects singing before provider or identity lookups',async()=>{
  await assert.rejects((NativeHarness.prototype as any).mediaTool.call({},{} as any,undefined,'singing_convert',[],{},new AbortController().signal),/SINGING_USE_BOT_SING/);
});

test('media worker receives an independent frozen RVC endpoint and current-session audio output',async t=>{
  const f=await fixture(t);let captured:MediaWorkerJob|undefined;
  const media=new MediaService(f.store,f.assets,'python',undefined,{run:async(job,_signal,credentials)=>{captured=job;assert.deepEqual(credentials,{});validateMediaWorkerJob(job);const file=path.join(job.output,'converted.wav');await writeFile(file,'wav');return{assets:[{path:file,name:'converted.wav',mime:'audio/wav',kind:'audio'}]};}});
  const result=await media.run(f.binding.key,'singing_convert',f.config,[f.input.id],{sourceType:'vocals',format:'wav',serviceUrl:'http://untrusted.invalid',speakerId:25},new AbortController().signal);
  assert.equal(captured?.endpoint?.baseUrl,singing.serviceUrl);assert.equal(captured?.endpoint?.speakerId,0);assert.equal(captured?.endpoint?.jobId,captured?.id);assert.deepEqual(captured?.parameters,{sourceType:'vocals',format:'wav'});
  assert.equal(f.store.asset(f.binding.key,result.assetIds[0]).sessionId,f.binding.sessionId);
  assert.throws(()=>validateMediaWorkerJob({...captured!,operation:'voice_speak'}),/MEDIA_WORKER_ENDPOINT_INVALID/);
});

test('unknown remote cancellation blocks the service until a verified idle health response',async t=>{
  const f=await fixture(t);let idle=false,failCancel=true;
  const server=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.method==='DELETE'){res.statusCode=failCancel?500:200;res.end(JSON.stringify({jobId:'job',status:'cancelled'}));}else res.end(JSON.stringify({protocol:'rvc_http_v1',status:'ready',activeJobId:idle?null:'job',queued:0}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const address=server.address() as {port:number},baseUrl=`http://127.0.0.1:${address.port}`;
  await assert.rejects(confirmSingingStopped(f.store,baseUrl,'job'),/SINGING_SERVICE_STATE_UNKNOWN/);
  await assert.rejects(acquireSingingService(f.store,baseUrl,new AbortController().signal),/SINGING_SERVICE_STATE_UNKNOWN/);
  idle=true;(await acquireSingingService(f.store,baseUrl,new AbortController().signal))();
  assert.equal(f.store.get('singing-service-unknown',baseUrl),null);
  failCancel=false;await confirmSingingStopped(f.store,baseUrl,'job');
});

test('host cancellation holds the shared service slot until remote termination is confirmed',async t=>{
  const f=await fixture(t);let confirm!:()=>void,requested!:()=>void,entered!:()=>void;
  const confirmation=new Promise<void>(r=>confirm=r),cancelRequested=new Promise<void>(r=>requested=r),firstEntered=new Promise<void>(r=>entered=r);
  const server=createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.method==='DELETE'){requested();await confirmation;res.end(JSON.stringify({jobId:req.url!.split('/').at(-1),status:'cancelled'}));}else res.end(JSON.stringify({protocol:'rvc_http_v1',status:'ready',activeJobId:null,queued:0}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  const serviceUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}`,config=configSchema.parse({...f.config,media:{singing:{...singing,serviceUrl}}});
  const other=f.store.binding({...f.binding.scope,senderId:'bob',channelId:'bob'}),order:string[]=[];
  const media=new MediaService(f.store,f.assets,'python',undefined,{run:async(job,signal)=>{
    order.push(job.scope);
    if(job.scope===f.binding.key){entered();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}
    const file=path.join(job.output,'converted.mp3');await writeFile(file,'audio');return{assets:[{path:file,name:'converted.mp3',mime:'audio/mpeg',kind:'audio'}]};
  }});
  const controller=new AbortController(),first=media.run(f.binding.key,'singing_convert',config,[f.input.id],{sourceType:'vocals'},controller.signal);
  const rejected=assert.rejects(first,/cancel first/);await firstEntered;
  const second=media.run(other.key,'singing_convert',config,[],{sourceType:'vocals',url:'https://example.org/a.wav'},new AbortController().signal);
  controller.abort(Error('cancel first'));await cancelRequested;assert.deepEqual(order,[f.binding.key]);
  confirm();await rejected;await second;assert.deepEqual(order,[f.binding.key,other.key]);
});

test('queued conversions reauthorize permission without starting the next worker',async t=>{
  const f=await fixture(t);let proceed!:()=>void,entered!:()=>void;
  const done=new Promise<void>(r=>proceed=r),started=new Promise<void>(r=>entered=r),other=f.store.binding({...f.binding.scope,senderId:'bob',channelId:'bob'});let calls=0,allowed=true;
  const media=new MediaService(f.store,f.assets,'python',undefined,{run:async job=>{calls++;entered();await done;const file=path.join(job.output,'converted.mp3');await writeFile(file,'audio');return{assets:[{path:file,name:'converted.mp3',mime:'audio/mpeg',kind:'audio'}]};}});
  const first=media.run(f.binding.key,'singing_convert',f.config,[f.input.id],{sourceType:'vocals'},new AbortController().signal);await started;
  const second=media.run(other.key,'singing_convert',f.config,[],{sourceType:'vocals',url:'https://example.org/a.wav'},new AbortController().signal,()=>{if(!allowed)throw Error('SINGING_DISABLED');});
  const rejected=assert.rejects(second,/SINGING_DISABLED/);allowed=false;proceed();await first;await rejected;assert.equal(calls,1);
});
