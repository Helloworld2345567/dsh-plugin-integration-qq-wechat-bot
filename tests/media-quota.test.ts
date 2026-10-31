import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Assets,MediaService} from '../src/core/media.js';
import {Store} from '../src/core/store.js';
import {freezeTurn} from '../src/core/policy.js';
import {botSchema,type CallerScope,type TurnSnapshot} from '../src/core/types.js';
import {mediaOperationRegistry} from '../src/core/media-operation-registry.js';
import {validateMediaWorkerJob,MEDIA_WORKER_PROTOCOL,MEDIA_WORKER_PROTOCOL_VERSION,type MediaWorkerJob,type WorkerPort} from '../src/core/worker-port.js';
import type {AnalysisProvider,AnalysisConnection} from '../src/core/analysis.js';

async function fixture(t:TestContext,options:{trusted?:boolean;kind?:'private'|'group';provider?:AnalysisProvider}={}){
  const base=process.env.BOT_TEST_TMP??path.resolve('.codex/trusted-media-unlimited-20261031');await mkdir(base,{recursive:true});
  const home=await mkdtemp(path.join(base,'media-quota-'));const store=new Store(home,path.join(home,'personas'));
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  store.saveBot(botSchema.parse({id:'fixture',name:'Fixture',channel:'qq',accountId:'bot',enabled:true,trustedUsers:options.trusted?['alice']:[]}));
  const scope:CallerScope={botId:'fixture',platform:'qq',accountId:'bot',kind:options.kind??'private',channelId:'conversation',senderId:'alice'};
  const binding=store.binding(scope);const config=store.config('default');const snapshot=freezeTurn(config,store.bot('fixture'),scope,['source']);
  const jobs:MediaWorkerJob[]=[];const worker:WorkerPort={run:async job=>{jobs.push(structuredClone(job));return{text:'fixture',assets:[]};}};
  const media=new MediaService(store,new Assets(store),'python',options.provider,worker);
  const quotaKey=(operation='image_download')=>`${new Date().toISOString().slice(0,10)}:${binding.key}:${operation}`;
  const exhaust=(operation='image_download')=>store.put('media-quota',quotaKey(operation),mediaOperationRegistry.get(operation).quotaUnits);
  const run=(turn:TurnSnapshot|undefined=snapshot,parameters:Record<string,unknown>={url:'https://www.douyin.com/video/1'},operation='image_download')=>media.run(binding.key,operation,config,[],parameters,new AbortController().signal,undefined,turn);
  return{store,binding,config,snapshot,jobs,media,quotaKey,exhaust,run};
}

test('trusted private turns repeatedly bypass exhausted media quotas without changing historical counts',async t=>{
  const f=await fixture(t,{trusted:true});
  for(const operation of ['image_download','video_download','social_read']){
    f.exhaust(operation);const used=f.store.get<number>('media-quota',f.quotaKey(operation));
    for(let call=0;call<3;call++)await f.run(f.snapshot,{url:'https://www.douyin.com/video/1'},operation);
    assert.equal(f.store.get<number>('media-quota',f.quotaKey(operation)),used);
  }
  assert.equal(f.jobs.length,9);assert.ok(f.jobs.every(job=>job.dailyQuotaExempt===true));
});

for(const kind of ['private','group'] as const)test(`${kind} callers without trusted private authorization retain the daily limit`,async t=>{
  const f=await fixture(t,{trusted:kind==='group',kind});
  // The stored group identity must still win over an inconsistent host snapshot.
  const snapshot=kind==='group'?{...f.snapshot,trusted:true}:f.snapshot;
  await f.run(snapshot);await assert.rejects(f.run(snapshot),/MEDIA_DAILY_LIMIT/);
  assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].dailyQuotaExempt,false);
});

test('model-supplied exemption flags do not bypass daily limits',async t=>{
  const f=await fixture(t);const parameters={url:'https://example.com/original.png',trusted:true,dailyQuotaExempt:true};
  await f.run(f.snapshot,parameters);await assert.rejects(f.run(f.snapshot,parameters),/MEDIA_DAILY_LIMIT/);
  assert.equal(f.jobs[0].parameters.dailyQuotaExempt,true);assert.equal(f.jobs[0].dailyQuotaExempt,false);
});

test('direct media callers without a host snapshot retain the daily limit',async t=>{
  const f=await fixture(t,{trusted:true});const run=()=>f.media.run(f.binding.key,'image_download',f.config,[],{url:'https://example.com/original.png'},new AbortController().signal);
  await run();await assert.rejects(run(),/MEDIA_DAILY_LIMIT/);assert.equal(f.jobs[0].dailyQuotaExempt,false);
});

test('new trust starts with the next turn and snapshots cannot cross bot or scope ownership',async t=>{
  const f=await fixture(t);f.exhaust();
  f.store.saveBot({...f.store.bot('fixture'),trustedUsers:['alice']});
  await assert.rejects(f.run(f.snapshot),/MEDIA_DAILY_LIMIT/);
  const trustedSnapshot=freezeTurn(f.config,f.store.bot('fixture'),f.binding.scope,[]);
  await assert.rejects(f.run({...trustedSnapshot,botId:'another-bot'}),/MEDIA_DAILY_LIMIT/);
  f.store.put('binding',f.binding.key,{...f.binding,scope:{...f.binding.scope,senderId:'another-user'}});
  await assert.rejects(f.run(trustedSnapshot),/MEDIA_DAILY_LIMIT/);
  assert.equal(f.jobs.length,0);
});

test('revocation while the provider is resolving removes the exemption before worker dispatch',async t=>{
  let entered!:()=>void;let release!:(connection:AnalysisConnection)=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  const resolved=new Promise<AnalysisConnection>(resolve=>{release=resolve;});
  const provider:AnalysisProvider={resolve:async()=>{entered();return resolved;}};
  const f=await fixture(t,{trusted:true,provider});
  const run=f.run(f.snapshot,{url:'https://www.douyin.com/video/1'},'video_analyze');await ready;
  f.store.saveBot({...f.store.bot('fixture'),trustedUsers:[]});
  release({provider:'fixture',apiKey:'fixture-key',endpoint:{baseUrl:'https://example.invalid/v1',model:'fixture',keyEnv:'FIXTURE_KEY',protocol:'chat_completions'}});
  await run;assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].dailyQuotaExempt,false);
  assert.equal(f.store.get<number>('media-quota',f.quotaKey('video_analyze')),1);
});

test('a final authorization revocation cannot dispatch an exempt job',async t=>{
  const f=await fixture(t,{trusted:true});f.exhaust();
  await assert.rejects(f.media.run(f.binding.key,'image_download',f.config,[],{url:'https://example.com/original.png'},new AbortController().signal,()=>{f.store.saveBot({...f.store.bot('fixture'),trustedUsers:[]});},f.snapshot),/MEDIA_DAILY_LIMIT/);
  assert.equal(f.jobs.length,0);
});

test('local transforms do not consume a daily quota',async t=>{
  const f=await fixture(t);const asset=await f.media.assets.save(f.binding.key,{kind:'image',name:'fixture.png',mime:'image/png'},Buffer.from('worker fixture'));
  f.exhaust('image_convert');await f.media.run(f.binding.key,'image_convert',f.config,[asset.id],{format:'png'},new AbortController().signal,undefined,f.snapshot);
  assert.equal(f.jobs.length,1);assert.equal(f.store.get<number>('media-quota',f.quotaKey('image_convert')),1);
});

test('worker job protocol accepts optional boolean daily exemptions and rejects other types',()=>{
  const job:MediaWorkerJob={protocol:MEDIA_WORKER_PROTOCOL,protocolVersion:MEDIA_WORKER_PROTOCOL_VERSION,id:'job',scope:'scope',operation:'image_download',handler:'skill',inputs:[],parameters:{},output:'C:/job',usagePath:'C:/job/usage.json',deadline:0,timeoutMs:0,quotaUnits:1};
  for(const dailyQuotaExempt of [undefined,false,true])assert.doesNotThrow(()=>validateMediaWorkerJob({...job,dailyQuotaExempt}));
  for(const dailyQuotaExempt of [null,1,'true'])assert.throws(()=>validateMediaWorkerJob({...job,dailyQuotaExempt} as unknown as MediaWorkerJob),/MEDIA_WORKER_QUOTA_INVALID/);
});
