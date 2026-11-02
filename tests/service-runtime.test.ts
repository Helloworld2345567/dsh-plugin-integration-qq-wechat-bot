import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {computeServiceArtifactHash,ServicePluginHost} from '../src/core/service-plugin-host.js';
import {ProfileStore} from '../src/core/profile-store.js';
import {OutputValidatorRegistry} from '../src/core/output-validator.js';
import {ServiceRuntime} from '../src/core/service-runtime.js';
import {InMemoryServiceStateRepository} from '../src/core/service-state-store.js';
import {ServiceContractError} from '../src/core/service-errors.js';
import type {CancelResult,ResolvedServiceProfileRevision,ServiceAdapter,ServiceJob,ServiceResult} from '../src/core/service-contract.js';

async function runtimeFixture(t:any,options:{execute?:(job:ServiceJob,signal:AbortSignal)=>Promise<ServiceResult>;cancel?:(job:string)=>Promise<CancelResult>;health?:(profile:ResolvedServiceProfileRevision)=>Promise<{state:'ready';checkedAt:number;expiresAt:number}>}={}){
  const root=await mkdtemp(path.resolve('.codex/service-runtime-')),output=path.join(root,'output');await mkdir(output);t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(path.join(root,'entry.js'),'x');const schema={dialect:'https://json-schema.org/draft/2020-12/schema',schema:{type:'object'}};let manifest:any={manifestVersion:1,serviceId:'music',packageId:'service-music',version:'1.0.0',hostApiRange:'^1.0.0',entry:'entry.js',protocols:['fixture@1'],capabilities:[{operation:'music.search',inputKinds:['text'],outputKinds:['file'],parameterSchema:schema,permission:'music.use',tool:'bot_music',quotaPolicy:'host.default',concurrencyPolicy:'host.default',deliveryPolicy:'host_decides'}],profileSchema:schema,dependencies:[],credentialRefs:[],artifactSha256:'0'.repeat(64)};await writeFile(path.join(root,'service-plugin.json'),JSON.stringify(manifest));const digest=await computeServiceArtifactHash(root);manifest={...manifest,artifactSha256:digest};await writeFile(path.join(root,'service-plugin.json'),JSON.stringify(manifest));
  const adapter:ServiceAdapter={serviceId:'music',listProfiles:async()=>[],health:options.health??(async()=>({state:'ready',checkedAt:1,expiresAt:2})),execute:options.execute??(async()=>({outputs:[]})),cancel:options.cancel??(async()=>({state:'cancelled'})),dispose:async()=>{}};
  const host=await ServicePluginHost.create([{root,source:'builtin',expectedArtifactSha256:digest,allowlisted:true,revoked:false,installedAt:1,createAdapter:()=>adapter}]);t.after(()=>host.dispose());const profiles=new ProfileStore(),profile=profiles.create({serviceId:'music',profileId:'default',state:'ready',capabilities:['music.search'],displayName:'Music',managedConfig:{root:'private'}}),state=new InMemoryServiceStateRepository(),runtime=new ServiceRuntime(host,profiles,new OutputValidatorRegistry(),new Map([['music.search',{permission:'music.use',concurrency:'global',quotaPolicy:'host.default',delivery:'host_decides'}]]),state);
  const request={operation:'music.search',profile:{serviceId:'music',profileId:'default'},profileRevision:profile.revision,profileContentHash:profile.contentHash,inputHandles:[],parameters:{query:'x'},outputDirectory:output,idempotencyKey:'key-1',deadline:Date.now()+30_000,signal:new AbortController().signal};return{runtime,state,request};
}

test('shutdown can cancel after stop-accepting and waits for execute settlement',async t=>{
  let release!:()=>void,cancelled=false;const gate=new Promise<void>(resolve=>release=resolve);const f=await runtimeFixture(t,{execute:async(_job,signal)=>{await Promise.race([gate,new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))]);return{outputs:[]};},cancel:async()=>{cancelled=true;release();return{state:'cancelled'};}});const execution=f.runtime.execute(f.request).catch(error=>error);await new Promise(resolve=>setImmediate(resolve));await f.runtime.cancelAndDrain();assert.equal(cancelled,true);assert.equal((await execution) instanceof ServiceContractError,true);await assert.rejects(()=>f.runtime.execute({...f.request,idempotencyKey:'key-2'}),/正在关闭/);
});

test('unknown cancellation persists a fence and prevents retry or duplicate execution',async t=>{
  const f=await runtimeFixture(t,{execute:async(_job,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new ServiceContractError({category:'UNKNOWN_STATE',safeDiagnostic:'unknown',retryable:false,blocksService:true})),{once:true})),cancel:async()=>({state:'unknown',blocksService:true})});const execution=f.runtime.execute(f.request).catch(error=>error);await new Promise(resolve=>setImmediate(resolve));await assert.rejects(()=>f.runtime.cancelAndDrain(),/状态未知/);await execution;assert.equal(f.state.fence('music')?.state,'blocked_unknown');
  const second=await runtimeFixture(t);second.state.saveFence(f.state.fence('music')!);await assert.rejects(()=>second.runtime.execute(second.request),error=>error instanceof ServiceContractError&&error.serviceError.category==='UNKNOWN_STATE');
});

test('idempotency key refuses duplicate requests in every terminal state',async t=>{
  const succeeded=await runtimeFixture(t);await succeeded.runtime.execute(succeeded.request);await assert.rejects(()=>succeeded.runtime.execute(succeeded.request),/幂等请求已存在/);
  const failed=await runtimeFixture(t,{execute:async()=>{throw Error('fixture failure');}});await assert.rejects(()=>failed.runtime.execute(failed.request));await assert.rejects(()=>failed.runtime.execute(failed.request),/幂等请求已存在/);
});

test('service capability registration requires a host binder and never accepts profile or paths from model arguments',async t=>{
  const f=await runtimeFixture(t);const {CapabilityRegistry}=await import('../src/core/capability-registry.js');const registry=new CapabilityRegistry();assert.throws(()=>f.runtime.registerCapabilities(registry),/BINDER_REQUIRED/);let seen:any;f.runtime.execute=async request=>{seen=request;return{outputs:[]};};f.runtime.registerCapabilities(registry,async(operation,parameters,context)=>{assert.equal(operation,'music.search');assert.deepEqual(parameters,{query:'safe',profile:{serviceId:'evil',profileId:'evil'},outputDirectory:'C:/evil'});return{profile:{serviceId:'music',profileId:'default'},profileRevision:f.request.profileRevision,profileContentHash:f.request.profileContentHash,inputHandles:[],outputDirectory:f.request.outputDirectory,idempotencyKey:'bound',deadline:Date.now()+1000,scopeKey:context.scopeKey};});await registry.execute('music.search',{query:'safe',profile:{serviceId:'evil',profileId:'evil'},outputDirectory:'C:/evil'},{signal:new AbortController().signal,scopeKey:'scope'});assert.deepEqual(seen.profile,{serviceId:'music',profileId:'default'});assert.equal(seen.outputDirectory,f.request.outputDirectory);assert.deepEqual(seen.parameters,{query:'safe',profile:{serviceId:'evil',profileId:'evil'},outputDirectory:'C:/evil'});
});

test('health accepts only catalog-registered profiles and never probes missing or revoked records',async t=>{
  let calls=0;const f=await runtimeFixture(t,{health:async profile=>{calls++;assert.equal(profile.serviceId,'music');assert.equal(profile.profileId,'default');assert.equal(profile.managedConfig.root,'private');assert.equal(profile.revision,1);return{state:'ready',checkedAt:1,expiresAt:2};}});assert.equal((await f.runtime.health({serviceId:'music',profileId:'default'},new AbortController().signal)).state,'ready');assert.equal(calls,1);
  await assert.rejects(()=>f.runtime.health({serviceId:'music',profileId:'absent'},new AbortController().signal),/未登记/);assert.equal(calls,1);
  f.runtime.profiles.transition({serviceId:'music',profileId:'default'},'revoked');assert.equal((await f.runtime.health({serviceId:'music',profileId:'default'},new AbortController().signal)).state,'blocked');assert.equal(calls,1);
  await assert.rejects(()=>f.runtime.health({serviceId:'voice',profileId:'default'},new AbortController().signal),/NOT_REGISTERED/);assert.equal(calls,1);
});
