import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ProfileStore} from '../src/core/profile-store.js';
import {ReadOnlyServiceDiscovery} from '../src/core/service-discovery.js';

test('discovery scans only registered roots, hashes files and creates immutable revisions',async t=>{
  const parent=await mkdtemp(path.resolve('.codex/service-discovery-')),root=path.join(parent,'registered'),outside=path.join(parent,'outside');await mkdir(root);await mkdir(outside);await writeFile(path.join(root,'model.bin'),'model');await writeFile(path.join(outside,'secret.bin'),'secret');t.after(()=>rm(parent,{recursive:true,force:true}));const profiles=new ProfileStore(),discovery=new ReadOnlyServiceDiscovery(profiles,new Map([['music',[root]]]));let files:any[]=[];const result=await discovery.refresh('music',async context=>{files=[...context.files];return[{profileId:'default',displayName:'Music',capabilities:['music.search'],managedConfig:{files:context.files}}];},new AbortController().signal);assert.equal(result.length,1);assert.equal(result[0].revision,1);assert.deepEqual(files.map(file=>file.relativePath),['model.bin']);assert.match(files[0].sha256,/^[a-f0-9]{64}$/);assert.equal(profiles.require({serviceId:'music',profileId:'default'}).managedConfig.files instanceof Array,true);
});

test('missing registered roots stay read-only and return an empty catalog',async t=>{
  const parent=await mkdtemp(path.resolve('.codex/service-missing-')),missing=path.join(parent,'missing');t.after(()=>rm(parent,{recursive:true,force:true}));const discovery=new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['music',[missing]]]));assert.deepEqual(await discovery.refresh('music',async()=>{throw new Error('must not run');},new AbortController().signal),[]);await assert.rejects(()=>access(missing),/ENOENT/);
});

test('discovery rejects symlink or junction roots and entries plus scan limits',async t=>{
  const parent=await mkdtemp(path.resolve('.codex/service-links-')),root=path.join(parent,'root'),outside=path.join(parent,'outside');await mkdir(root);await mkdir(outside);await writeFile(path.join(outside,'model.bin'),'x');t.after(()=>rm(parent,{recursive:true,force:true}));const link=path.join(root,'linked');await symlink(outside,link,process.platform==='win32'?'junction':'dir');const discovery=new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['music',[root]]]));await assert.rejects(()=>discovery.refresh('music',async()=>[],new AbortController().signal),/REPARSE_POINT/);
  await rm(link,{force:true});await writeFile(path.join(root,'one'),'1');await writeFile(path.join(root,'two'),'2');const limited=new ReadOnlyServiceDiscovery(new ProfileStore(),new Map([['music',[root]]]),{maxFiles:1});await assert.rejects(()=>limited.refresh('music',async()=>[],new AbortController().signal),/FILE_COUNT_LIMIT/);
});
