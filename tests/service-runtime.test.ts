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
import type {CancelResult,ServiceAdapter,ServiceJob,ServiceResult} from '../src/core/service-contract.js';

async function runtimeFixture(t:any,options:{execute?:(job:ServiceJob,signal:AbortSignal)=>Promise<ServiceResult>;cancel?:(job:string)=>Promise<CancelResult>}={}){
  const root=await mkdtemp(path.resolve('.codex/service-runtime-')),output=path.join(root,'output');await mkdir(output);t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(path.join(root,'entry.js'),'x');const schema={dialect:'https://json-schema.org/draft/2020-12/schema',schema:{type:'object'}};let manifest:any={manifestVersion:1,serviceId:'music',packageId:'service-music',version:'1.0.0',hostApiRange:'^1.0.0',entry:'entry.js',protocols:['fixture@1'],capabilities:[{operation:'music.search',inputKinds:['text'],outputKinds:['file'],parameterSchema:schema,permission:'music.use',tool:'bot_music',quotaPolicy:'host.default',concurrencyPolicy:'host.default',deliveryPolicy:'host_decides'}],profileSchema:schema,dependencies:[],credentialRefs:[],artifactSha256:'0'.repeat(64)};await writeFile(path.join(root,'service-plugin.json'),JSON.stringify(manifest));const digest=await computeServiceArtifactHash(root);manifest={...manifest,artifactSha256:digest};await writeFile(path.join(root,'service-plugin.json'),JSON.stringify(manifest));
  const adapter:ServiceAdapter={serviceId:'music',listProfiles:async()=>[],health:async()=>({state:'ready',checkedAt:1,expiresAt:2}),execute:options.execute??(async()=>({outputs:[]})),cancel:options.cancel??(async()=>({state:'cancelled'})),dispose:async()=>{}};
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

test('idempotency key refuses duplicate nonterminal requests',async t=>{
  const f=await runtimeFixture(t);await f.runtime.execute(f.request);await assert.rejects(()=>f.runtime.execute(f.request),/幂等请求已存在/);
});
