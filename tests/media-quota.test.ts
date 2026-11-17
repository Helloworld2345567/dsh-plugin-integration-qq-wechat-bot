import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Assets,MediaService} from '../src/core/media.js';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {botSchema,type CallerScope} from '../src/core/types.js';
import type {MediaWorkerJob,WorkerPort} from '../src/core/worker-port.js';
import {readQuota,seedQuota} from './sqlite-fixtures.js';

async function fixture(t:TestContext,kind:'private'|'group'='private'){
  const base=process.env.BOT_TEST_TMP??path.resolve('.codex');await mkdir(base,{recursive:true});
  const home=await mkdtemp(path.join(base,'media-limits-')),store=new SqlitePersistence(home,path.join(home,'personas'));
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  store.bots.saveBot(botSchema.parse({id:'fixture',name:'Fixture',channel:'qq',accountId:'bot',enabled:true}));
  const scope:CallerScope={botId:'fixture',platform:'qq',accountId:'bot',kind,channelId:'conversation',senderId:'alice'};
  const binding=store.sessions.binding(scope),config=store.personas.config('default'),jobs:MediaWorkerJob[]=[];
  const worker:WorkerPort={run:async job=>{jobs.push(job);return{text:'fixture',assets:[]};}};
  const media=new MediaService(store.repositories(),new Assets(store.repositories()),'python',undefined,worker);
  const run=(authorize?:()=>void)=>media.run(binding.key,'image_download',config,[],{url:'https://example.invalid/image.png'},new AbortController().signal,authorize);
  return{store,binding,jobs,worker,run};
}
for(const kind of ['private','group'] as const)test(`${kind} media requests ignore exhausted legacy daily quotas`,async t=>{
  const f=await fixture(t,kind),key=`${new Date().toISOString().slice(0,10)}:${f.binding.key}:image_download`;
  seedQuota(f.store,key,10000);
  for(let i=0;i<5;i++)await f.run();
  assert.equal(f.jobs.length,5);assert.equal(readQuota(f.store,key),10000);
  assert.ok(f.jobs.every(job=>!('dailyQuotaExempt' in job)&&!('quotaUnits' in job)));
});
test('three media operations in the same scope run concurrently; fourth is rejected and failure releases capacity',async t=>{
  const f=await fixture(t);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  let entered!:()=>void;const ready=new Promise<void>(resolve=>{entered=resolve;});let calls=0,active=0,peak=0;
  f.worker.run=async()=>{calls++;active++;peak=Math.max(peak,active);if(calls===3)entered();await gate;active--;if(calls===3)throw Error('fixture failure');return{};};
  const pending=Promise.allSettled([f.run(),f.run(),f.run()]);await ready;
  await assert.rejects(f.run(),/MEDIA_CONCURRENCY_LIMIT/);release();await pending;
  assert.equal(peak,3);f.worker.run=async()=>({});await f.run();
});
test('removing quotas preserves execution authorization',async t=>{
  const f=await fixture(t);await assert.rejects(f.run(()=>{throw Error('REVOKED');}),/REVOKED/);assert.equal(f.jobs.length,0);
});
