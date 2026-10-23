import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {CapabilityRegistry} from '../src/core/capability-registry.js';
import {MediaOperationRegistry} from '../src/core/media-operation-registry.js';
import {MediaService} from '../src/core/media.js';
import {Store} from '../src/core/store.js';
import {validateMediaWorkerJob,MEDIA_WORKER_PROTOCOL,MEDIA_WORKER_PROTOCOL_VERSION,type MediaWorkerJob} from '../src/core/worker-port.js';
import {lifecycleAvailable,lifecycleRuntime,markLifecycleAvailable,registerLifecycleRuntime} from '../src/lifecycle/protocol.js';
import {EvolutionService} from '../src/core/evolution.js';

test('capability registry applies authorization and scope concurrency',async()=>{
  const registry=new CapabilityRegistry();let active=0;let peak=0;
  registry.register({name:'fixture',concurrency:'scope',authorize:args=>args==='allowed',execute:async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return 'ok';}});
  await assert.rejects(registry.execute('fixture','denied',{signal:AbortSignal.timeout(100),scopeKey:'one'}),/CAPABILITY_NOT_AUTHORIZED/);
  const signal=AbortSignal.timeout(100);const values=await Promise.all([registry.execute('fixture','allowed',{signal,scopeKey:'one'}),registry.execute('fixture','allowed',{signal,scopeKey:'one'})]);
  assert.deepEqual(values,['ok','ok']);assert.equal(peak,1);
});

test('media operation registry accepts one fixture descriptor without a switch',async()=>{
  const registry=new MediaOperationRegistry([{id:'fixture',handler:'fixture',timeoutMs:1000,quotaUnits:1,execute:async()=>({text:'fixture'})}]);
  assert.equal(registry.get('fixture').handler,'fixture');assert.deepEqual(registry.ids(),['fixture']);assert.deepEqual(await registry.dispatch('fixture',{}),{text:'fixture'});
  assert.throws(()=>registry.register({id:'fixture',handler:'other',timeoutMs:1000,quotaUnits:1}),/ALREADY_REGISTERED/);
});

test('MediaService dispatches a registered native operation handler',async()=>{
  const home=await mkdtemp(path.resolve('.codex/phase5-media-'));
  try{
    const registry=new MediaOperationRegistry([{id:'fixture',handler:'fixture',timeoutMs:1000,quotaUnits:1,execute:async(job:any)=>{assert.equal(job.operation,'fixture');return{text:'fixture-result'};}}]);
    const store={home,patchJob:()=>{},consumeMediaQuota:()=>{}} as any;
    const assets={resolve:async()=>{throw new Error('unexpected asset lookup');}} as any;
    const media=new MediaService(store,assets,'python',undefined,undefined,registry);
    assert.deepEqual(await media.run('scope','fixture',{} as any,[],{},AbortSignal.timeout(1000)),{text:'fixture-result',coverage:undefined,assetIds:[],contextAssetIds:[],incomplete:undefined});
  }finally{await rm(home,{recursive:true,force:true});}
});

test('worker job protocol is versioned and rejects stale jobs',()=>{
  const job:MediaWorkerJob={protocol:MEDIA_WORKER_PROTOCOL,protocolVersion:MEDIA_WORKER_PROTOCOL_VERSION,id:'job',scope:'scope',operation:'fixture',handler:'fixture',inputs:[],parameters:{},output:'C:/job',usagePath:'C:/job/usage.json',deadline:Date.now()+10000,timeoutMs:1000,quotaUnits:1};
  assert.doesNotThrow(()=>validateMediaWorkerJob(job));assert.throws(()=>validateMediaWorkerJob({...job,protocolVersion:99}),/PROTOCOL_UNSUPPORTED/);
});

test('Store lifecycle stages are explicit and ordered',async()=>{
  const home=await mkdtemp(path.resolve('.codex/phase5-store-'));
  const store=Store.open(home,undefined,{secureDefaults:true});
  try{
    assert.equal(store.lifecycleStage(),'opened');store.initialize();assert.equal(store.lifecycleStage(),'initialized');store.migrate();assert.equal(store.lifecycleStage(),'migrated');store.recover();assert.equal(store.lifecycleStage(),'recovered');store.start();assert.equal(store.lifecycleStage(),'started');
  }finally{store.close();assert.equal(store.lifecycleStage(),'closed');await rm(home,{recursive:true,force:true});}
});

test('lifecycle handshake fails closed until coordinator and runtime agree',()=>{
  const runtime={packageRoot:'fixture',quiesce:async()=>{},resumeProcessing:()=>{},health:()=>({ready:true})};
  const previousCoordinator=(globalThis as any)[Symbol.for('sakura.lifecycle.coordinator')];const previousHandshake=(globalThis as any).__DSH_LIFECYCLE_HANDSHAKE__;
  try{
    delete (globalThis as any)[Symbol.for('sakura.lifecycle.coordinator')];delete (globalThis as any).__DSH_LIFECYCLE_HANDSHAKE__;
    (globalThis as any).__DSH_LIFECYCLE_HANDSHAKE__={protocol:'dsh.lifecycle',version:99,instance:'stale',capabilities:['runtime.quiesce']};
    assert.equal(lifecycleAvailable(),false);
    (globalThis as any).__DSH_LIFECYCLE_HANDSHAKE__={protocol:'dsh.lifecycle',version:1,instance:'orphan',capabilities:['runtime.health'],runtime};
    assert.equal(lifecycleAvailable(),false);assert.equal(lifecycleRuntime(),undefined);
    delete (globalThis as any).__DSH_LIFECYCLE_HANDSHAKE__;
    const incompatible={protocol:'dsh.lifecycle',version:99,instance:'old',capabilities:['coordinator.tick']};
    (globalThis as any)[Symbol.for('sakura.lifecycle.coordinator')]=incompatible;
    markLifecycleAvailable(true);assert.equal(lifecycleAvailable(),false);assert.equal(incompatible.version,99);
    const blocked=registerLifecycleRuntime(runtime);assert.equal(lifecycleAvailable(),false);assert.equal(incompatible.version,99);blocked();
    delete (globalThis as any)[Symbol.for('sakura.lifecycle.coordinator')];
    markLifecycleAvailable(true);assert.equal(lifecycleAvailable(),false);
    const dispose=registerLifecycleRuntime(runtime);assert.equal(lifecycleAvailable(),true);
    dispose();assert.equal(lifecycleAvailable(),false);
  }finally{
    if(previousCoordinator===undefined)delete (globalThis as any)[Symbol.for('sakura.lifecycle.coordinator')];else (globalThis as any)[Symbol.for('sakura.lifecycle.coordinator')]=previousCoordinator;
    if(previousHandshake===undefined)delete (globalThis as any).__DSH_LIFECYCLE_HANDSHAKE__;else (globalThis as any).__DSH_LIFECYCLE_HANDSHAKE__=previousHandshake;
  }
});

test('evolution rejects an injected incompatible lifecycle port',async()=>{
  const home=await mkdtemp(path.resolve('.codex/phase5-evolution-'));
  try {
    const service=new EvolutionService({home,saveEvolutionTask:()=>{}},home,{lifecycle:{available:()=>true,handshake:()=>({protocol:'dsh.lifecycle',version:99,instance:'bad',capabilities:[]})}});
    assert.throws(()=>service.create('scope','config','goal'),/LIFECYCLE_HANDSHAKE_UNAVAILABLE/);
  } finally { await rm(home,{recursive:true,force:true}); }
});
