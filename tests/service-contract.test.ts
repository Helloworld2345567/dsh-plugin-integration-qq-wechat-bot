import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parseServicePluginManifest,serviceJobSchema,type ServiceAdapter,type ServicePluginManifest} from '../src/core/service-contract.js';
import {sanitizeServiceDiagnostic,serviceErrorSchema} from '../src/core/service-errors.js';
import {ServiceCatalog} from '../src/core/service-catalog.js';
import {ProfileStore,profileContentHash} from '../src/core/profile-store.js';
import {computeServiceArtifactHash,ServicePluginHost,validateServicePlugin,versionSatisfies} from '../src/core/service-plugin-host.js';

const schema={dialect:'https://json-schema.org/draft/2020-12/schema' as const,schema:{type:'object'}};
const manifest=(serviceId='music',overrides:Partial<ServicePluginManifest>={}):ServicePluginManifest=>parseServicePluginManifest({manifestVersion:1,serviceId,packageId:`service-${serviceId}`,version:'1.0.0',hostApiRange:'^1.0.0',entry:'entry.js',protocols:['fixture@1'],capabilities:[{operation:`${serviceId}.search`,inputKinds:['text'],outputKinds:['file'],parameterSchema:schema,permission:`${serviceId}.use`,tool:`bot_${serviceId.replaceAll('-','_')}`,quotaPolicy:'host.default',concurrencyPolicy:'host.default',deliveryPolicy:'host_decides'}],profileSchema:schema,dependencies:[],credentialRefs:[],artifactSha256:'0'.repeat(64),...overrides});

test('manifest validates namespace, entry containment and required contract fields',()=>{
  assert.equal(manifest().serviceId,'music');
  for(const entry of ['../entry.js','/entry.js','C:/entry.js','folder\\entry.js','folder/../entry.js'])assert.throws(()=>manifest('music',{entry}),/entry/);
  assert.throws(()=>manifest('music',{capabilities:[{...manifest().capabilities[0],operation:'voice.speak'}]}),/namespace/);
  assert.throws(()=>parseServicePluginManifest({...manifest(),manifestVersion:2}),/manifestVersion/);
});

test('version ranges enforce host and dependency compatibility',()=>{
  assert.equal(versionSatisfies('1.2.3','^1.0.0'),true);assert.equal(versionSatisfies('2.0.0','^1.0.0'),false);assert.equal(versionSatisfies('1.2.3','>=1.0.0 <2.0.0'),true);assert.equal(versionSatisfies('1.3.0','~1.2.0'),false);
});

test('catalog allows one service tool to route operations and rejects cross-service collisions',()=>{
  const music=manifest('music',{capabilities:[manifest().capabilities[0],{...manifest().capabilities[0],operation:'music.acquire'}]});assert.equal(new ServiceCatalog([music]).list().length,1);
  const voice=manifest('voice',{capabilities:[{...manifest('voice').capabilities[0],tool:'bot_music',permission:'music.use'}]});assert.throws(()=>new ServiceCatalog([music,voice]),/PERMISSION_DUPLICATE|TOOL_DUPLICATE/);
  assert.throws(()=>new ServiceCatalog([music,music]),/SERVICE_ID_DUPLICATE/);
});

test('profile revisions are immutable, content-addressed and privately projected',()=>{
  const store=new ProfileStore(),first=store.create({serviceId:'music',profileId:'default',state:'ready',capabilities:['music.search'],displayName:'Music',managedConfig:{root:'private',sources:['a']}}),same=store.create({serviceId:'music',profileId:'default',state:'ready',capabilities:['music.search'],displayName:'Music',managedConfig:{sources:['a'],root:'private'}}),second=store.create({serviceId:'music',profileId:'default',state:'ready',capabilities:['music.search'],displayName:'Music',managedConfig:{root:'private-2'}});
  assert.equal(first.revision,1);assert.equal(same.revision,1);assert.equal(second.revision,2);assert.equal(first.contentHash,profileContentHash({sources:['a'],root:'private'}));assert.equal('managedConfig' in store.publicProjection(first),false);
  assert.throws(()=>store.import({...first,revision:3,contentHash:'0'.repeat(64)}),/HASH_MISMATCH/);
});

test('job freezes profile revision, content hash, inputs, output and idempotency',()=>{
  const profile={serviceId:'music',profileId:'default',revision:2,contentHash:'a'.repeat(64),state:'ready' as const,capabilities:['music.search'],displayName:'Music',updatedAt:1};
  assert.doesNotThrow(()=>serviceJobSchema.parse({jobId:'job-1',operation:'music.search',profile,inputHandles:['asset-1'],parameters:{query:'x'},outputDirectory:path.resolve('.codex/job'),idempotencyKey:'same-turn',deadline:Date.now()+1000}));
  assert.throws(()=>serviceJobSchema.parse({jobId:'job-1',operation:'voice.speak',profile,inputHandles:[],parameters:{},outputDirectory:path.resolve('.codex/job'),idempotencyKey:'same-turn',deadline:Date.now()+1000}),/service|operation/i);
});

test('service diagnostics redact paths, locators, credentials and traceback',()=>{
  const value=sanitizeServiceDiagnostic("token=super-secret-token https://private.example/x C:\\private\\model.pth\n at run (C:\\private\\x.js:1:2)");assert.doesNotMatch(value,/super-secret|private\.example|C:\\private|at run/);assert.match(value,/redacted/);
  assert.throws(()=>serviceErrorSchema.parse({category:'UNKNOWN_STATE',retryable:false,blocksService:false}),/blocksService/);
});

test('plugin host rejects unlisted, revoked, wrong hash, traversal and symlink entry',async t=>{
  const root=await mkdtemp(path.resolve('.codex/service-plugin-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(path.join(root,'entry.js'),'export default {}\n');
  let value=manifest();await writeFile(path.join(root,'service-plugin.json'),JSON.stringify(value));const digest=await computeServiceArtifactHash(root);value=manifest('music',{artifactSha256:digest});await writeFile(path.join(root,'service-plugin.json'),JSON.stringify(value));
  const adapter:ServiceAdapter={serviceId:'music',listProfiles:async()=>[],health:async()=>({state:'ready',checkedAt:1,expiresAt:2}),execute:async()=>({outputs:[]}),cancel:async()=>({state:'cancelled'}),dispose:async()=>{}};
  const registration={root,source:'bundled' as const,expectedArtifactSha256:digest,allowlisted:true,revoked:false,installedAt:1,createAdapter:()=>adapter};
  assert.equal((await validateServicePlugin(registration)).manifest.serviceId,'music');await assert.rejects(()=>validateServicePlugin({...registration,allowlisted:false}),/NOT_ALLOWLISTED/);await assert.rejects(()=>validateServicePlugin({...registration,revoked:true}),/REVOKED/);await assert.rejects(()=>validateServicePlugin({...registration,expectedArtifactSha256:'f'.repeat(64)}),/HASH_MISMATCH/);
  const outside=path.join(root,'..',`outside-${Date.now()}.js`);await writeFile(outside,'x');const linked=path.join(root,'linked.js');try{await symlink(outside,linked,'file');value=manifest('music',{entry:'linked.js'});await writeFile(path.join(root,'service-plugin.json'),JSON.stringify(value));const linkedHash=await computeServiceArtifactHash(root).catch(()=>undefined);assert.equal(linkedHash,undefined);await assert.rejects(()=>validateServicePlugin({...registration,expectedArtifactSha256:value.artifactSha256}),/REPARSE_POINT/);}finally{await rm(outside,{force:true});}
});

test('manifest Ed25519 signature accepts the pinned key and rejects tampering',async t=>{
  const root=await mkdtemp(path.resolve('.codex/service-signature-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(path.join(root,'entry.js'),'x');let value=manifest();await writeFile(path.join(root,'service-plugin.json'),JSON.stringify(value));const digest=await computeServiceArtifactHash(root);value=manifest('music',{artifactSha256:digest});const {privateKey,publicKey}=generateKeyPairSync('ed25519'),payload=Buffer.from(JSON.stringify(value)),signature=sign(null,payload,privateKey).toString('base64');value=manifest('music',{artifactSha256:digest,signature:`ed25519:release:${signature}`});await writeFile(path.join(root,'service-plugin.json'),JSON.stringify(value));
  const registration={root,source:'bundled' as const,expectedArtifactSha256:digest,allowlisted:true,revoked:false,installedAt:1,publicKeys:{release:publicKey.export({type:'spki',format:'pem'}).toString()},createAdapter:()=>({} as ServiceAdapter)};assert.equal((await validateServicePlugin(registration)).manifest.signature,value.signature);await assert.rejects(()=>validateServicePlugin({...registration,publicKeys:{release:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString()}}),/SIGNATURE_INVALID/);
});

test('catalog reservations prevent service plugins from shadowing host IDs and entries are immutable copies',()=>{
  assert.throws(()=>new ServiceCatalog([manifest()],{operations:new Set(['music.search'])}),/OPERATION_RESERVED/);assert.throws(()=>new ServiceCatalog([manifest()],{tools:new Set(['bot_music'])}),/TOOL_RESERVED/);assert.throws(()=>new ServiceCatalog([manifest()],{permissions:new Set(['music.use'])}),/PERMISSION_RESERVED/);
  const source=manifest(),catalog=new ServiceCatalog([source]),entry=catalog.require('music');assert.equal(Object.isFrozen(entry),true);assert.equal(Object.isFrozen(entry.manifest),true);assert.equal(Object.isFrozen(entry.capabilities),true);assert.notEqual(entry.manifest,source);assert.throws(()=>{(entry.capabilities as ServicePluginManifest['capabilities'] as any[]).push(source.capabilities[0]);},/extensible|read only|frozen/i);
});

test('core service host starts without external services and exposes an empty catalog',async()=>{const host=await ServicePluginHost.create([]);try{assert.deepEqual(host.catalog.list(),[]);assert.deepEqual(host.records,[]);}finally{await host.dispose();}});

test('adapter startup is atomic and dispose runs in reverse order',async t=>{
  const parent=await mkdtemp(path.resolve('.codex/service-host-'));t.after(()=>rm(parent,{recursive:true,force:true}));const events:string[]=[];const registrations=[];
  for(const id of ['one','two']){const root=path.join(parent,id);await mkdir(root);await writeFile(path.join(root,'entry.js'),'x');let value=manifest(id);await writeFile(path.join(root,'service-plugin.json'),JSON.stringify(value));const digest=await computeServiceArtifactHash(root);value=manifest(id,{artifactSha256:digest});await writeFile(path.join(root,'service-plugin.json'),JSON.stringify(value));registrations.push({root,source:'builtin' as const,expectedArtifactSha256:digest,allowlisted:true,revoked:false,installedAt:1,createAdapter:()=>({serviceId:id,listProfiles:async()=>[],health:async()=>({state:'ready' as const,checkedAt:1,expiresAt:2}),execute:async()=>({outputs:[]}),cancel:async()=>({state:'cancelled' as const}),dispose:async()=>{events.push(id);}})});}
  const host=await ServicePluginHost.create(registrations);await host.dispose();assert.deepEqual(events,['two','one']);
});
