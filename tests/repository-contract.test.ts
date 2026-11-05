import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/infrastructure/sqlite/store.js';
import {botSchema} from '../src/core/types.js';

async function fixture(t:any){const home=await mkdtemp(path.resolve('.codex/repository-contract-'));const store=new Store(home);t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account'}));return store;}

test('session keyset pages are stable, filter-bound and stale after mutation',async t=>{const store=await fixture(t);const scope=(senderId:string)=>({botId:'bot',platform:'qq',accountId:'account',kind:'private' as const,channelId:senderId,senderId});for(const sender of ['a','b','c'])store.binding(scope(sender));const first=store.pageSessions({},2);assert.equal(first.items.length,2);assert.ok(first.nextCursor);const second=store.pageSessions({},2,first.nextCursor!);assert.equal(second.items.length,1);assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,3);assert.throws(()=>store.pageSessions({scopeKey:first.items[0].scopeKey},2,first.nextCursor!),/PAGE_CURSOR_MISMATCH/);store.reset(scope('a'));assert.throws(()=>store.pageSessions({},2,first.nextCursor!),/PAGE_STALE/);});
test('delivery repository pages and sendable query release later outputs after unknown or failed rows',async t=>{
  const store=await fixture(t),binding=store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});
  store.enqueue(binding,'source','turn',[{type:'text',text:'one'},{type:'asset',assetId:'asset-one'},{type:'text',text:'three'}],{});
  const repository=store.deliveryRepository(),first=repository.pageDeliveries({filter:{scopeKey:binding.key},limit:2});
  assert.equal(first.items.length,2);assert.ok(first.nextCursor);
  const second=repository.pageDeliveries({filter:{scopeKey:binding.key},limit:2,cursor:first.nextCursor!});
  assert.equal(second.items.length,1);
  const all=store.deliveries();
  store.deliveryState(all[0],'unknown',undefined,'uncertain');
  assert.deepEqual(repository.nextSendable('bot',100).map(row=>row.index),[1]);
  assert.equal(repository.hasEarlierBlocker(all[1]),false);
  store.deliveryState(all[1],'sending');
  assert.equal(repository.hasEarlierBlocker(all[2]),true);
  store.deliveryState(all[1],'failed',undefined,'rejected');
  assert.deepEqual(repository.nextSendable('bot',100).map(row=>row.index),[2]);
  assert.throws(()=>repository.pageDeliveries({filter:{botId:'bot'},limit:2,cursor:first.nextCursor!}),/PAGE_CURSOR_MISMATCH/);
});

test('delivery repository finds asset deliveries and retries the original ID',async t=>{
  const store=await fixture(t),binding=store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});
  store.enqueue(binding,'source','turn',[{type:'asset',assetId:'asset-one'}],{});
  const repository=store.deliveryRepository(),delivery=store.deliveries()[0];
  assert.deepEqual(repository.findByAsset(binding.key,'asset-one').map(row=>row.id),[delivery.id]);
  store.deliveryState(delivery,'failed',undefined,'rejected');
  assert.deepEqual(repository.findByAsset(binding.key,'asset-one').map(row=>row.state),['failed']);
  store.deliveryState(delivery,'unknown',undefined,'receipt lost');
  assert.deepEqual(repository.findByAsset(binding.key,'asset-one',['unknown']).map(row=>row.state),['unknown']);
  const retried=repository.retry(delivery.id);
  assert.equal(retried?.id,delivery.id);
  assert.equal(retried?.state,'pending');
  assert.equal(retried?.error,undefined);
  assert.equal(store.deliveries()[0].id,delivery.id);
  assert.equal(repository.retry(delivery.id),undefined,'a pending delivery is not duplicated by retry');
});

test('automatic asset registration reuses a durable claim while explicit resend creates a new intent',async t=>{
  const store=await fixture(t),binding=store.binding({botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'user',senderId:'user'});
  store.enqueue(binding,'source-1','turn-1',[{type:'asset',assetId:'asset-one'}],{});
  const first=store.deliveries()[0];store.deliveryState(first,'sent','receipt');
  store.enqueue(binding,'source-2','turn-2',[{type:'asset',assetId:'asset-one'}],{});
  assert.equal(store.deliveries().length,1,'a repeated automatic registration must reuse the sent claim');
  store.enqueue(binding,'source-3','turn-3',[{type:'asset',assetId:'asset-one',resend:true}],{});
  const rows=store.deliveries();assert.equal(rows.length,2);assert.notEqual(rows[1].id,first.id);assert.equal(rows[1].output.resend,true);
});

/** Contract suite: every assertion below runs against a real temporary SQLite database. */
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import type {CallerScope} from '../src/core/types.js';
import {capabilityAcceptanceSchema} from '../src/core/service-contract.js';
import type {Asset} from '../src/core/types.js';

async function adapterFixture(t:any){
  const home=await mkdtemp(path.resolve('.codex/repository-adapters-'));
  const persistence=SqlitePersistence.open(home).initialize().migrate();
  t.after(async()=>{persistence.close();await rm(home,{recursive:true,force:true});});
  const repos=persistence.repositories();
  repos.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account'}));
  return {home,persistence,repos};
}
const privateScope=(botId:string,senderId:string):CallerScope=>({botId,platform:'qq',accountId:botId,kind:'private',channelId:senderId,senderId});

test('repository contract: reopen keeps configuration revision, bindings, assets and pending deliveries',async t=>{
  const {home,persistence,repos}=await adapterFixture(t);
  const binding=repos.sessions.binding(privateScope('bot','owner'));
  const config=repos.personas.config('default');
  const saved=repos.personas.saveConfig({...config,name:'Renamed'},config.revision);
  assert.equal(saved.revision,config.revision+1);
  const asset:Asset={id:'asset-1',scopeKey:binding.key,name:'a.txt',mime:'text/plain',kind:'file',path:path.join(home,'a.txt'),size:3,createdAt:Date.now(),sessionId:binding.sessionId};
  repos.media.assets.saveAsset(asset);
  repos.deliveries.enqueue(binding,'source','turn',[{type:'text',text:'hello'}],{});
  persistence.close();
  const reopened=SqlitePersistence.open(home).initialize().migrate();
  const again=reopened.repositories();
  assert.equal(again.personas.config('default').revision,saved.revision);
  assert.equal(again.sessions.findBinding(binding.key)?.sessionId,binding.sessionId);
  assert.equal(again.media.assets.asset(binding.key,'asset-1').name,'a.txt');
  assert.equal(again.deliveries.deliveries(['pending']).length,1);
  assert.equal(again.inbox.countMessages(),0);
  reopened.close();
});

test('repository contract: scopes, sessions and assets stay isolated',async t=>{
  const {repos}=await adapterFixture(t);
  const alice=repos.sessions.binding(privateScope('bot','alice')),bob=repos.sessions.binding(privateScope('bot','bob'));
  assert.notEqual(alice.key,bob.key);
  assert.equal(repos.sessions.sessions(privateScope('bot','alice')).length,1);
  const asset:Asset={id:'asset-a',scopeKey:alice.key,name:'a.png',mime:'image/png',kind:'image',path:'/tmp/a.png',size:1,createdAt:1,sessionId:alice.sessionId};
  repos.media.assets.saveAsset(asset);
  assert.equal(repos.media.assets.asset(alice.key,'asset-a').id,'asset-a');
  assert.throws(()=>repos.media.assets.asset(bob.key,'asset-a'),/附件不存在或不属于当前会话/);
  assert.throws(()=>repos.sessions.session(privateScope('bot','bob'),alice.sessionId),/会话不存在或不属于当前渠道身份/);
});

test('repository contract: persona revision CAS rejects a stale writer without changing state',async t=>{
  const {repos}=await adapterFixture(t);
  const config=repos.personas.config('default');
  repos.personas.saveConfig({...config,name:'First'},config.revision);
  assert.throws(()=>repos.personas.saveConfig({...config,name:'Stale'},config.revision),/配置已被其他操作修改/);
  assert.equal(repos.personas.config('default').name,'First');
  assert.equal(repos.personas.configVersions().filter(row=>row.id==='default').length,2);
});

test('repository contract: session reset advances generation and stale cursors cannot be reused',async t=>{
  const {repos}=await adapterFixture(t);
  const scope=privateScope('bot','owner');
  const binding=repos.sessions.binding(scope);
  const first=repos.sessions.reset(scope);
  assert.equal(first.generation,binding.generation+1);
  assert.notEqual(first.sessionId,binding.sessionId);
  const page=repos.sessions.pageSessions({},1);
  assert.ok(page.nextCursor);
  assert.throws(()=>repos.sessions.pageSessions({scopeKey:binding.key},1,page.nextCursor!),/PAGE_CURSOR_MISMATCH/);
  assert.throws(()=>repos.sessions.pageSessions({},1,'forged'),/PAGE_CURSOR_INVALID/);
  repos.sessions.reset(scope);
  assert.throws(()=>repos.sessions.pageSessions({},1,page.nextCursor!),/PAGE_STALE/);
});

test('repository contract: delivery retry keeps the original intent and unknown rows are not replayed automatically',async t=>{
  const {repos}=await adapterFixture(t);
  const binding=repos.sessions.binding(privateScope('bot','owner'));
  repos.deliveries.enqueue(binding,'source','turn',[{type:'text',text:'one'}],{});
  const delivery=repos.deliveries.deliveries()[0];
  repos.deliveries.deliveryState(delivery,'unknown',undefined,'receipt lost');
  assert.equal(repos.deliveries.nextSendable('bot',10).length,0,'unknown rows are not pending');
  const retried=repos.deliveries.retry(delivery.id);
  assert.equal(retried?.id,delivery.id);assert.equal(retried?.state,'pending');
  repos.deliveries.deliveryState(retried!,'sending');
  assert.equal(repos.deliveries.retry(delivery.id),undefined,'a sending intent is not duplicated');
  assert.equal(repos.deliveries.pendingBotIds().includes('bot'),false);
});

test('repository contract: a failed multi-write transaction rolls back every adapter',async t=>{
  const {persistence,repos}=await adapterFixture(t);
  const binding=repos.sessions.binding(privateScope('bot','owner'));
  assert.throws(()=>persistence.database.transaction(()=>{
    repos.inbox.accept({id:'message-1',text:'hello',scope:binding.scope,attachments:[],reply:{},timestamp:Date.now()});
    throw Error('BOOM');
  }),/BOOM/);
  assert.equal(repos.inbox.source(binding.key,'message-1'),undefined);
  assert.equal(repos.telemetry.metrics.findTurnMetric(`inbox:${binding.key}:message-1`),undefined);
});

test('repository contract: profile revisions are immutable and acceptance binds persona and profile revision',async t=>{
  const {persistence,repos}=await adapterFixture(t);
  const record={serviceId:'music' as const,profileId:'one',revision:1,contentHash:'a'.repeat(64),state:'ready' as const,capabilities:['music.search'],displayName:'Music',updatedAt:1,managedConfig:{endpoint:'x'}};
  persistence.profiles.save(record);
  assert.throws(()=>persistence.profiles.save(record),/PROFILE_REVISION_IMMUTABLE/);
  const acceptance=capabilityAcceptanceSchema.parse({serviceId:'music',profileId:'one',profileRevision:1,profileContentHash:'a'.repeat(64),personaId:'default',personaRevision:1,operation:'music.search',state:'PASS',evidenceType:'operator-review',evidence:'ok',checkedAt:1,expiresAt:2,source:'operator'});
  repos.capabilities.saveAcceptance('key',acceptance);
  assert.equal(repos.capabilities.acceptance('key')?.operation,'music.search');
  assert.equal(repos.capabilities.findAcceptance(row=>row.personaRevision===99),undefined);
  persistence.serviceState.saveFence({serviceId:'music',state:'blocked_unknown',updatedAt:1});
  assert.equal(persistence.serviceState.fence('music')?.state,'blocked_unknown');
});

test('repository contract: deleting one bot keeps another bot history intact and teardown is explicit',async t=>{
  const {persistence,repos}=await adapterFixture(t);
  repos.bots.saveBot(botSchema.parse({id:'other',name:'Other',channel:'qq',accountId:'other'}));
  const mine=repos.sessions.binding(privateScope('bot','owner')),theirs=repos.sessions.binding(privateScope('other','owner'));
  const asset=(id:string,scope:string,sessionId:string):Asset=>({id,scopeKey:scope,name:`${id}.png`,mime:'image/png',kind:'image',path:`/tmp/${id}.png`,size:1,createdAt:1,sessionId});
  repos.media.assets.saveAsset(asset('mine',mine.key,mine.sessionId));
  repos.media.assets.saveAsset(asset('theirs',theirs.key,theirs.sessionId));
  const snapshot=persistence.botHistory.snapshot('bot');
  assert.ok(snapshot.scopes.has(mine.key));assert.ok(!snapshot.scopes.has(theirs.key));
  persistence.botHistory.deleteRecords('bot',snapshot);
  assert.equal(repos.media.assets.findAsset('mine'),undefined);
  assert.equal(repos.media.assets.findAsset('theirs')?.id,'theirs');
  assert.equal(repos.sessions.findBinding(theirs.key)?.sessionId,theirs.sessionId);
  persistence.close();
  assert.equal(persistence.lifecycleStage(),'closed');
  assert.throws(()=>persistence.recover(),/STORE_CLOSED/);
});
