import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProfileStore,profileContentHash} from '../src/core/profile-store.js';
import {ReadOnlyServiceDiscovery} from '../src/core/service-discovery.js';
import {GptSovitsServiceAdapter} from '../src/core/gpt-sovits-adapter.js';

const base={serviceId:'gpt-sovits',profileId:'voice',state:'ready' as const,capabilities:['gpt-sovits.speak'],displayName:'Voice',managedConfig:{protocol:'gpt_sovits',voice:'voice',baseUrl:'http://localhost:9880',modelVersion:'v4',gptWeightsPath:'gpt.ckpt',sovitsWeightsPath:'sovits.pth',refAudioPath:'reference.wav',promptText:'参考文本',promptLang:'all_zh',textLang:'all_zh'}};

test('discovery metadata contributes resources to immutable identity without changing existing V4 hashes',()=>{
  const profiles=new ProfileStore(),manual=profiles.create(base);assert.equal(manual.contentHash,profileContentHash(base.managedConfig));
  const discovered=profiles.create({...base,profileId:'discovered',discovery:{sourceId:'library',resourceHash:'a'.repeat(64)}}),snapshot=profiles.snapshot(discovered);
  assert.equal(profiles.create({...discovered}).revision,1);
  const changed=profiles.create({...discovered,discovery:{sourceId:'library',resourceHash:'b'.repeat(64)}});assert.equal(changed.revision,2);assert.notEqual(changed.contentHash,discovered.contentHash);
  assert.throws(()=>profiles.assertExecutable(snapshot),/PROFILE_BLOCKED/);
  assert.equal(Object.isFrozen(discovered.discovery),true);
  assert.doesNotMatch(JSON.stringify(profiles.list()),/managedConfig|discovery|sourceId|resourceHash|localhost|gptWeightsPath/);
  assert.doesNotMatch(JSON.stringify(profiles.publicProjection(discovered)),/managedConfig|discovery|sourceId|resourceHash/);
  const blocked=profiles.transition(discovered,'blocked');assert.deepEqual(blocked.discovery,changed.discovery);assert.throws(()=>profiles.assertExecutable(snapshot),/PROFILE_BLOCKED/);
  const imported=new ProfileStore().import(changed);assert.deepEqual(imported.discovery,changed.discovery);
  assert.throws(()=>new ProfileStore().import({...changed,discovery:{sourceId:'library',resourceHash:'c'.repeat(64)}}),/HASH_MISMATCH/);
});

test('resource replacement fences old turns while configuration-only changes preserve frozen settings',()=>{
  const profiles=new ProfileStore(),discovered=profiles.create({...base,discovery:{sourceId:'library',resourceHash:'a'.repeat(64)}}),snapshot=profiles.snapshot(discovered);
  const configured=profiles.create({...discovered,managedConfig:{...base.managedConfig,promptText:'更新参考文本'}});
  assert.equal(configured.revision,2);
  assert.equal(profiles.assertExecutable(snapshot).managedConfig.promptText,'参考文本');
  const configuredSnapshot=profiles.snapshot(configured);
  const replaced=profiles.create({...configured,discovery:{sourceId:'library',resourceHash:'b'.repeat(64)}});
  assert.throws(()=>profiles.assertExecutable(snapshot),/PROFILE_BLOCKED/);
  assert.throws(()=>profiles.assertExecutable(configuredSnapshot),/PROFILE_BLOCKED/);
  assert.equal(profiles.assertExecutable(profiles.snapshot(replaced)).contentHash,replaced.contentHash);
  const restored=profiles.create({...configured,discovery:{sourceId:'library',resourceHash:'a'.repeat(64)}});
  assert.throws(()=>profiles.assertExecutable(snapshot),/PROFILE_BLOCKED/);
  assert.equal(profiles.assertExecutable(profiles.snapshot(restored)).contentHash,restored.contentHash);
});

test('reconciled Profiles pass real adapter strict configuration parsing',async()=>{
  const profiles=new ProfileStore(),discovery=new ReadOnlyServiceDiscovery(profiles,new Map());
  discovery.reconcile(base.serviceId,'library',[{...base,resourceHash:'a'.repeat(64)}]);
  const selected=profiles.require(base);let checked=false;
  const adapter=new GptSovitsServiceAdapter({run:async()=>({})},{check:async config=>{checked=true;assert.equal(config.gptWeightsPath,'gpt.ckpt');assert.equal('__discovery' in config,false);assert.equal('discovery' in config,false);return true;}});
  assert.equal((await adapter.health(selected,new AbortController().signal)).state,'ready');assert.equal(checked,true);
});
