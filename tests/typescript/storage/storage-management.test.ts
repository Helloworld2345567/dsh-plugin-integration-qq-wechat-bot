import {test} from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../../../src/infrastructure/sqlite/persistence.js';
import {Assets} from '../../../src/core/media.js';
import {WorkspaceStorageService} from '../../../src/core/storage-management.js';
import {botSchema,type CallerScope} from '../../../src/core/types.js';

const scope:CallerScope={botId:'one',platform:'qq',accountId:'account-one',kind:'private',channelId:'alice',senderId:'alice'};
const media={kind:'image' as const,name:'photo.png',mime:'image/png'};
async function fixture(t:any){
  const home=await mkdtemp(path.resolve('.codex/storage-management-')),store=new SqlitePersistence(home);
  for(const id of ['one','two'])store.bots.saveBot(botSchema.parse({id,name:id,channel:'qq',accountId:`account-${id}`}));
  const assets=new Assets(store.repositories()),service=new WorkspaceStorageService(store.repositories());
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  return {home,store,assets,service};
}

test('storage preview counts owned media by kind, origin and date and identifies current-session protection',async t=>{
  const {store,assets,service}=await fixture(t),first=store.sessions.binding(scope);
  const older=await assets.save(first.key,media,Buffer.from('old'),'generated-job');
  store.assets.saveAsset({...older,createdAt:Date.UTC(2026,0,1)});
  store.sessions.reset(scope);
  await assets.save(first.key,{kind:'audio',name:'voice.mp3',mime:'audio/mpeg'},Buffer.from('current'));
  const other=store.sessions.binding({...scope,botId:'two',accountId:'account-two'});
  await assets.save(other.key,media,Buffer.from('other bot'));
  const report=service.preview({botId:'one'});
  assert.deepEqual(report.total,{count:2,bytes:10});assert.deepEqual(report.reclaimable,{count:1,bytes:3});
  assert.equal(report.items.find(item=>item.kind==='audio')?.protection,'current-session');
  const filtered=service.preview({botId:'one',kind:'image',origin:'generated',before:Date.UTC(2026,1,1)});
  assert.deepEqual(filtered.groups,[{kind:'image',origin:'generated',date:'2026-01-01',count:1,bytes:3}]);
  assert.equal(service.preview({botId:'one',offset:1,limit:1}).items.length,1);
});

test('cleanup rechecks kept files, active jobs and retryable delivery references after preview',async t=>{
  const {store,assets,service}=await fixture(t),binding=store.sessions.binding(scope);
  const kept=await assets.save(binding.key,media,Buffer.from('keep'));
  const queued=await assets.save(binding.key,media,Buffer.from('delivery'));
  const adapted=await assets.save(binding.key,{kind:'audio',name:'voice.silk',mime:'audio/silk'},Buffer.from('platform audio'),'adapted');
  const jobAsset=await assets.save(binding.key,media,Buffer.from('job'),'worker');
  const next=store.sessions.reset(scope);
  assert.equal(service.preview({botId:'one'}).reclaimable.count,4);
  service.pin({botId:'one',assetId:kept.id,pinned:true});
  store.deliveries.enqueue(next,'source','turn',[{type:'asset',assetId:queued.id}],{});
  const delivery=store.deliveries.findByAsset(next.key,queued.id)[0];store.deliveries.deliveryState({...delivery,attempt:{number:1,phase:'upload',assetId:adapted.id}},'failed');
  const result=await service.cleanup({botId:'one',assetIds:[kept.id,queued.id,adapted.id]});
  assert.equal(result.count,0);assert.deepEqual(result.skipped.map(item=>item.reason),['retained','delivery','delivery']);
  store.jobs.saveJob('worker',{id:'worker',scope:binding.key,state:'running'});
  assert.equal((await service.cleanup({botId:'one',assetIds:[jobAsset.id]})).skipped[0].reason,'active-task');
  store.jobs.patchJob('worker',{state:'succeeded'});
  assert.equal((await new WorkspaceStorageService(store.repositories(),()=>true).cleanup({botId:'one',assetIds:[jobAsset.id]})).skipped[0].reason,'active-task');
  for(const asset of [kept,queued,jobAsset])await access(asset.path);
});

test('cleanup deletes only selected owned assets while retaining user files, other bots and current sessions',async t=>{
  const {store,assets,service}=await fixture(t),binding=store.sessions.binding(scope);
  const old=await assets.save(binding.key,media,Buffer.from('old'));
  const userFile=path.join(old.workspace!,'user-project.txt');await writeFile(userFile,'keep');
  store.sessions.reset(scope);const current=await assets.save(binding.key,media,Buffer.from('current'));
  const other=store.sessions.binding({...scope,botId:'two',accountId:'account-two'}),foreign=await assets.save(other.key,media,Buffer.from('foreign'));
  await assert.rejects(service.cleanup({botId:'one',assetIds:[old.id,foreign.id]}),/WORKSPACE_ASSET_NOT_OWNED/);await access(old.path);
  assert.throws(()=>service.pin({botId:'one',assetId:foreign.id,pinned:true}),/WORKSPACE_ASSET_NOT_OWNED/);
  const result=await service.cleanup({botId:'one',assetIds:[old.id,current.id]});
  assert.equal(result.count,1);assert.equal(result.bytes,3);assert.equal(result.skipped[0].reason,'current-session');
  assert.equal(store.assets.findAsset(old.id),undefined);await assert.rejects(access(old.path));
  await access(current.path);await access(foreign.path);assert.equal(await readFile(userFile,'utf8'),'keep');
});

test('retention pins survive asynchronous workspace migration and protect unclaimed media',async t=>{
  const {home,store,assets,service}=await fixture(t),binding=store.sessions.binding(scope);
  const asset=await assets.save(binding.key,media,Buffer.from('keep during migration'));
  store.bots.saveBot({...store.bots.bot('one'),workingDirectory:path.join(home,'custom')});
  const destination=await assets.workspace(binding.key);
  let resume!:()=>void,entered!:()=>void;
  const pending=new Promise<void>(resolve=>{resume=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const migrating=new Assets({...store.repositories(),workspace:{home:store.home,scope:async()=>{entered();await pending;return destination;},session:store.workspaceFiles.session.bind(store.workspaceFiles)}});
  const migration=migrating.migrate(binding.key);await started;
  service.pin({botId:'one',assetId:asset.id,pinned:true});resume();await migration;
  assert.equal(store.assets.asset(binding.key,asset.id).pinned,true);
  assert.equal(store.assets.asset(binding.key,asset.id).workspace,destination);
  assert.equal(await assets.removeUnclaimed(binding.key,asset.id),false);
  assert.equal((await assets.read(binding.key,asset.id)).toString(),'keep during migration');
  service.pin({botId:'one',assetId:asset.id,pinned:false});
  assert.equal(await assets.removeUnclaimed(binding.key,asset.id),true);
});
