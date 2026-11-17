import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Assets,MediaService} from '../src/core/media.js';
import {jobHasLiveProcess,trackJobProcess} from '../src/core/job-process.js';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {runJsonProcess} from '../src/harness/json-process.js';
import {NodeControlledProcessPort} from '../src/harness/controlled-process.js';
import {BotRuntime} from '../src/core/runtime.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';

async function fixture(t:TestContext){
  const base=process.env.BOT_TEST_TMP??path.resolve('.codex');await mkdir(base,{recursive:true});
  const workspace=await mkdtemp(path.join(base,'media-cleanup-')),store=new SqlitePersistence(path.join(workspace,'data'));
  const media=new MediaService(store.repositories(),new Assets(store.repositories()));
  t.after(async()=>{store.close();await rm(workspace,{recursive:true,force:true});});
  const seed=async(id:string,state='complete',extra:Record<string,unknown>={})=>{
    const directory=path.join(workspace,'.bot','jobs',id);await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'partial.bin'),'fixture');
    store.jobs.saveJob(id,{id,scope:'scope',state,workspace,directory,...extra});return directory;
  };
  return{workspace,store,media,seed};
}

test('startup interrupts old work and removes only completed or interrupted job directories',async t=>{
  const f=await fixture(t),running=await f.seed('running','running'),queued=await f.seed('queued','queued'),finished=await f.seed('finished','complete',{cleanupError:'previous file lock'});
  const unrelated=path.join(f.workspace,'outputs');await mkdir(unrelated);await writeFile(path.join(unrelated,'keep.txt'),'keep');
  const runtime=new BotRuntime(f.store.repositories(),f.media.assets,f.media,{dispose:async()=>{}} as any,createChannelRegistry([]),{} as any);
  try{
    await runtime.initialize({autoStart:false});
    for(const directory of [running,queued,finished])await assert.rejects(stat(directory),{code:'ENOENT'});
    for(const id of ['running','queued'])assert.equal(f.store.jobs.findJob(id)?.state,'interrupted');
    assert.equal(f.store.jobs.findJob('finished')?.cleanupError,undefined);
    assert.equal(typeof f.store.jobs.findJob('finished')?.cleanedAt,'number');
    assert.equal(await readFile(path.join(unrelated,'keep.txt'),'utf8'),'keep');
  }finally{await runtime.close();}
});

test('cleanup retains active jobs, live process directories and paths outside the exact job',async t=>{
  const f=await fixture(t),active=await f.seed('active'),running=await f.seed('running','running'),live=await f.seed('live','interrupted'),invalid=await f.seed('invalid','failed');
  f.media.active.set('active',{scope:'scope',controller:new AbortController()});
  f.store.jobs.patchJob('invalid',{directory:f.workspace});
  const release=trackJobProcess(live,process.pid);
  await f.media.cleanupStaleJobs();
  for(const directory of [active,running,live,invalid])assert.equal((await stat(directory)).isDirectory(),true);
  assert.equal(f.store.jobs.findJob('live')?.cleanupError,'JOB_PROCESS_ACTIVE');
  assert.equal(f.store.jobs.findJob('invalid')?.cleanupError,'JOB_CLEANUP_PATH_INVALID');
  release();await f.media.cleanupStaleJobs();
  await assert.rejects(stat(live),{code:'ENOENT'});assert.equal(f.store.jobs.findJob('live')?.cleanupError,undefined);
});

test('JSON media process writes a live marker and removes it after exit',async t=>{
  const f=await fixture(t),directory=await f.seed('json','interrupted');
  const pending=runJsonProcess(process.execPath,['-e','process.stdin.resume();process.stdin.on("end",()=>setTimeout(()=>process.stdout.write(JSON.stringify({pid:process.pid})),300));'],{},
    {cwd:directory,signal:new AbortController().signal,timeoutMs:5000,trackProcess:true});
  assert.equal(await jobHasLiveProcess(directory),true);
  await f.media.cleanupStaleJobs();assert.equal(f.store.jobs.findJob('json')?.cleanupError,'JOB_PROCESS_ACTIVE');
  const result=await pending;assert.equal(typeof result.pid,'number');assert.equal(await jobHasLiveProcess(directory),false);
  assert.deepEqual((await readdir(directory)).filter(name=>name.startsWith('.worker-process-')),[]);
  trackJobProcess(directory,result.pid);assert.equal(await jobHasLiveProcess(directory),false,'a crashed host can leave a marker for an exited worker');
  await f.media.cleanupStaleJobs();await assert.rejects(stat(directory),{code:'ENOENT'});
});

test('controlled service processes protect their job directory until they exit',async t=>{
  const f=await fixture(t),directory=await f.seed('controlled','interrupted'),port=new NodeControlledProcessPort();
  const pending=port.run({jobId:'controlled',command:process.execPath,args:['-e','setTimeout(()=>process.stdout.write("done"),300)'],cwd:directory,signal:new AbortController().signal,deadline:Date.now()+5000});
  assert.equal(await jobHasLiveProcess(directory),true);
  await f.media.cleanupStaleJobs();assert.equal((await stat(directory)).isDirectory(),true);
  assert.equal((await pending).stdout.toString(),'done');assert.equal(await jobHasLiveProcess(directory),false);
  await f.media.cleanupStaleJobs();await assert.rejects(stat(directory),{code:'ENOENT'});
});
