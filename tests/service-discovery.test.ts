import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ProfileStore} from '../src/core/profile-store.js';
import {ReadOnlyServiceDiscovery} from '../src/core/service-discovery.js';

const candidate=(context:any,profileId='default')=>[{profileId,displayName:'Music',capabilities:['music.search'],managedConfig:{source:'registered',files:context.files},resources:context.files.map((file:any)=>file.relativePath)}];

test('discovery scans only canonical registered roots, hashes files and records scan evidence in immutable profiles',async t=>{
  const parent=await mkdtemp(path.resolve('.codex/service-discovery-')),root=path.join(parent,'registered'),outside=path.join(parent,'outside');await mkdir(root);await mkdir(outside);await writeFile(path.join(root,'model.bin'),'model');await writeFile(path.join(outside,'secret.bin'),'secret');t.after(()=>rm(parent,{recursive:true,force:true}));const profiles=new ProfileStore(),discovery=new ReadOnlyServiceDiscovery(profiles,new Map([['music',[path.join(root,'.')]]]));let files:any[]=[],rootHash='';const result=await discovery.refresh('music',async context=>{files=[...context.files];rootHash=context.rootContentHash;return candidate(context);},new AbortController().signal);assert.equal(result.length,1);assert.equal(result[0].revision,1);assert.deepEqual(files.map(file=>file.relativePath),['model.bin']);assert.match(files[0].sha256,/^[a-f0-9]{64}$/);assert.match(rootHash,/^[a-f0-9]{64}$/);const managed=profiles.require({serviceId:'music',profileId:'default'}).managedConfig as any;assert.equal(managed.files instanceof Array,true);assert.equal(managed.__discovery,undefined);const privateProfile=profiles.require({serviceId:'music',profileId:'default'});assert.match(privateProfile.discovery!.resourceHash,/^[a-f0-9]{64}$/);assert.ok(privateProfile.discovery!.sourceId.includes('registered'));assert.doesNotMatch(JSON.stringify(discovery.catalog()),/registered|model\.bin|sha256|__discovery/);assert.equal(discovery.status('music').state,'ready');
});

test('missing roots do not get created and previously discovered profiles become missing without fallback',async t=>{
  const parent=await mkdtemp(path.resolve('.codex/service-missing-')),root=path.join(parent,'registered');await mkdir(root);await writeFile(path.join(root,'model.bin'),'model');t.after(()=>rm(parent,{recursive:true,force:true}));const profiles=new ProfileStore(),discovery=new ReadOnlyServiceDiscovery(profiles,new Map([['music',[root]]]));const ready=await discovery.refresh('music',async context=>candidate(context),new AbortController().signal);assert.equal(ready[0].state,'ready');await rm(root,{recursive:true});const missing=await discovery.refresh('music',async()=>{throw new Error('must not run');},new AbortController().signal);assert.equal(missing[0].state,'missing');assert.equal(missing[0].revision,2);assert.equal(discovery.status('music').state,'missing');await assert.rejects(()=>access(root),/ENOENT/);
});

test('failed refresh blocks prior ready profiles while operator disabled or revoked states stay authoritative',async t=>{
  const parent=await mkdtemp(path.resolve('.codex/service-blocked-')),root=path.join(parent,'root'),outside=path.join(parent,'outside');await mkdir(root);await mkdir(outside);await writeFile(path.join(root,'model.bin'),'model');t.after(()=>rm(parent,{recursive:true,force:true}));const profiles=new ProfileStore(),discovery=new ReadOnlyServiceDiscovery(profiles,new Map([['music',[root]]]));await discovery.refresh('music',async context=>candidate(context),new AbortController().signal);const link=path.join(root,'escape');await symlink(outside,link,process.platform==='win32'?'junction':'dir');await assert.rejects(()=>discovery.refresh('music',async()=>[],new AbortController().signal),/REPARSE_POINT/);assert.equal(discovery.catalog('music')[0].state,'blocked');await rm(link,{force:true});profiles.transition({serviceId:'music',profileId:'default'},'disabled');await rm(root,{recursive:true});await discovery.refresh('music',async()=>[],new AbortController().signal);assert.equal(discovery.catalog('music')[0].state,'disabled');await mkdir(root);await writeFile(path.join(root,'model.bin'),'restored');await discovery.refresh('music',async context=>candidate(context),new AbortController().signal);assert.equal(discovery.catalog('music')[0].state,'disabled','read-only discovery cannot re-enable an operator-disabled profile');
});

test('unregistered services stay missing and discovery never scans caller supplied paths',async t=>{
  const parent=await mkdtemp(path.resolve('.codex/service-unregistered-')),outside=path.join(parent,'outside');await mkdir(outside);await writeFile(path.join(outside,'secret.bin'),'secret');t.after(()=>rm(parent,{recursive:true,force:true}));const discovery=new ReadOnlyServiceDiscovery(new ProfileStore(),new Map());let called=false;assert.deepEqual(await discovery.refresh('music',async()=>{called=true;return[];},new AbortController().signal),[]);assert.equal(called,false);assert.equal(discovery.status('music').state,'missing');assert.equal((await access(path.join(outside,'secret.bin')).then(()=>true)),true);
});

test('discovery rejects symlink or junction roots and entries, including canonical duplicate roots',async t=>{
  const parent=await mkdtemp(path.resolve('.codex/service-links-')),root=path.join(parent,'root'),outside=path.join(parent,'outside');await mkdir(root);await mkdir(outside);await writeFile(path.join(outside,'model.bin'),'x');t.after(()=>rm(parent,{recursive:true,force:true}));const link=path.join(root,'linked');await symlink(outside,link,process.platform==='win32'?'junction':'dir');const discovery=new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['music',[root]]]));await assert.rejects(()=>discovery.refresh('music',async()=>[],new AbortController().signal),/REPARSE_POINT/);assert.equal(discovery.status('music').state,'blocked');
  await rm(link,{force:true});const rootLink=path.join(parent,'root-link');await symlink(root,rootLink,process.platform==='win32'?'junction':'dir');const linkedRoot=new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['music',[rootLink]]]));await assert.rejects(()=>linkedRoot.refresh('music',async()=>[],new AbortController().signal),/REPARSE_POINT/);const nestedRoot=new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['music',[path.join(rootLink,'child')]]]));await assert.rejects(()=>nestedRoot.refresh('music',async()=>[],new AbortController().signal),/REPARSE_POINT/);
  const duplicate=new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['music',[root,path.join(root,'.')]]]));await assert.rejects(()=>duplicate.refresh('music',async()=>[],new AbortController().signal),/ROOT_DUPLICATE/);
});

test('file count, size, total size, depth, profile and deadline limits fail closed across all roots',async t=>{
  const parent=await mkdtemp(path.resolve('.codex/service-limits-')),one=path.join(parent,'one'),two=path.join(parent,'two');await mkdir(one);await mkdir(two);await writeFile(path.join(one,'a'),'12');await writeFile(path.join(two,'b'),'34');const deep=path.join(one,'deep');await mkdir(deep);await writeFile(path.join(deep,'c'),'x');t.after(()=>rm(parent,{recursive:true,force:true}));
  const roots=new Map([['music',[one,two]]] as const);for(const [limits,error] of [[{maxFiles:1},/FILE_COUNT_LIMIT/],[{maxFileBytes:1},/FILE_SIZE_LIMIT/],[{maxTotalBytes:3},/TOTAL_SIZE_LIMIT/],[{maxDepth:0},/DEPTH_LIMIT/]] as const){const discovery=new ReadOnlyServiceDiscovery(new ProfileStore(),roots,limits);await assert.rejects(()=>discovery.refresh('music',async()=>[],new AbortController().signal),error);}
  const profiles=new ReadOnlyServiceDiscovery(new ProfileStore(),roots,{maxProfiles:1});await assert.rejects(()=>profiles.refresh('music',async context=>candidate(context,path.basename(context.root)),new AbortController().signal),/PROFILE_LIMIT/);
  const deadline=new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['music',[two]]]),{deadlineMs:5});await assert.rejects(()=>deadline.refresh('music',async context=>{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,100);context.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(context.signal.reason);},{once:true});});return[];},new AbortController().signal),/TimeoutError|aborted|timeout/i);assert.equal(deadline.status('music').state,'blocked');
});

test('candidate validation rejects duplicate profiles, wrong service namespaces and reserved discovery metadata',async t=>{
  const parent=await mkdtemp(path.resolve('.codex/service-candidate-')),one=path.join(parent,'one'),two=path.join(parent,'two');await mkdir(one);await mkdir(two);await writeFile(path.join(one,'a'),'a');await writeFile(path.join(two,'b'),'b');t.after(()=>rm(parent,{recursive:true,force:true}));
  await assert.rejects(()=>new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['music',[one,two]]])).refresh('music',async context=>candidate(context),new AbortController().signal),/PROFILE_DUPLICATE/);
  await assert.rejects(()=>new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['music',[one]]])).refresh('music',async()=>[{profileId:'default',displayName:'Music',capabilities:['voice.speak'],managedConfig:{}}],new AbortController().signal),/namespace/);
  await assert.rejects(()=>new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['music',[one]]])).refresh('music',async()=>[{profileId:'default',displayName:'Music',capabilities:['music.search'],managedConfig:{__discovery:{forged:true}}}],new AbortController().signal),/RESERVED_CONFIG/);
});


test('resource updates affect only their model; logs and identical refreshes retain revisions',async t=>{
  const root=await mkdtemp(path.resolve('.codex/service-resources-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'one.pth'),'one');await writeFile(path.join(root,'two.pth'),'two');
  const profiles=new ProfileStore(),discovery=new ReadOnlyServiceDiscovery(profiles,new Map([['rvc',[root]]]));
  const models=async()=>['one','two'].map(profileId=>({profileId,displayName:profileId,capabilities:['rvc.convert'],managedConfig:{model:profileId},resources:[`${profileId}.pth`]}));
  await discovery.refresh('rvc',models,new AbortController().signal);const first=discovery.catalog('rvc');
  await discovery.refresh('rvc',models,new AbortController().signal);assert.deepEqual(discovery.catalog('rvc'),first);
  await writeFile(path.join(root,'train.log'),'unrelated log');await discovery.refresh('rvc',models,new AbortController().signal);assert.deepEqual(discovery.catalog('rvc'),first);
  await writeFile(path.join(root,'one.pth'),'changed-one');await discovery.refresh('rvc',models,new AbortController().signal);
  assert.equal(profiles.require({serviceId:'rvc',profileId:'one'}).revision,2);assert.notEqual(profiles.require({serviceId:'rvc',profileId:'one'}).contentHash,first[0].contentHash);
  assert.deepEqual(discovery.catalog('rvc')[1],first[1]);
});

test('scanner reconciliation scopes missing and blocked states to its owner and rejects collisions',()=>{
  const profiles=new ProfileStore(),discovery=new ReadOnlyServiceDiscovery(profiles,new Map());
  const row=(profileId:string)=>({profileId,displayName:profileId,capabilities:['rvc.convert'],managedConfig:{protocol:'rvc_cli_v1'},resourceHash:'a'.repeat(64)});
  const manual=profiles.create({serviceId:'rvc',profileId:'manual',state:'ready',capabilities:['rvc.convert'],displayName:'Manual',managedConfig:{}});
  discovery.reconcile('rvc','library-one',[row('one')]);discovery.reconcile('rvc','library-two',[row('two')]);
  assert.throws(()=>discovery.reconcile('rvc','library-one',[row('manual')]),/SOURCE_COLLISION/);
  assert.throws(()=>discovery.reconcile('rvc','library-one',[row('two')]),/SOURCE_COLLISION/);
  discovery.reconcile('rvc','library-one',[]);assert.equal(profiles.require({serviceId:'rvc',profileId:'one'}).state,'missing');
  assert.equal(profiles.require({serviceId:'rvc',profileId:'two'}).state,'ready');assert.deepEqual(profiles.require(manual),manual);
  discovery.failSource('rvc','library-two','blocked');assert.equal(profiles.require({serviceId:'rvc',profileId:'two'}).state,'blocked');assert.deepEqual(profiles.require(manual),manual);
  discovery.reconcile('rvc','library-two',[row('two')]);profiles.transition({serviceId:'rvc',profileId:'two'},'disabled');
  discovery.reconcile('rvc','library-two',[row('two')]);assert.equal(profiles.require({serviceId:'rvc',profileId:'two'}).state,'disabled');
});

test('directory resource declarations reject missing or escaping files without publishing partial candidates',async t=>{
  const root=await mkdtemp(path.resolve('.codex/service-resources-invalid-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'model.pth'),'model');
  for(const resource of ['missing.pth','../model.pth','C:/model.pth']){
    const discovery=new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['rvc',[root]]]));
    await assert.rejects(()=>discovery.refresh('rvc',async()=>[{profileId:'one',displayName:'One',capabilities:['rvc.convert'],managedConfig:{},resources:[resource]}],new AbortController().signal),/RESOURCE_/);
    assert.deepEqual(discovery.catalog(),[]);
  }
});
