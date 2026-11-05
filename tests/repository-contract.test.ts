import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {botSchema,type Asset,type CallerScope} from '../src/core/types.js';

/** Every assertion runs against a real temporary SQLite database. */
async function fixture(t:any){
  await mkdir(path.resolve('.codex'),{recursive:true});
  const home=await mkdtemp(path.resolve('.codex/repository-contract-'));
  const persistence=SqlitePersistence.open(home).initialize().migrate();
  t.after(async()=>{persistence.close();await rm(home,{recursive:true,force:true});});
  const repos=persistence.repositories();
  repos.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account'}));
  return {home,persistence,repos};
}
const privateScope=(botId:string,senderId:string):CallerScope=>({botId,platform:'qq',accountId:botId,kind:'private',channelId:senderId,senderId});

test('repository contract: reopen keeps configuration revision, bindings, assets and pending deliveries',async t=>{
  const {home,persistence,repos}=await fixture(t);
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
  const {repos}=await fixture(t);
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
  const {repos}=await fixture(t);
  const config=repos.personas.config('default');
  repos.personas.saveConfig({...config,name:'First'},config.revision);
  assert.throws(()=>repos.personas.saveConfig({...config,name:'Stale'},config.revision),/配置已被其他操作修改/);
  assert.equal(repos.personas.config('default').name,'First');
  assert.equal(repos.personas.configVersions().filter(row=>row.id==='default').length,2);
});

test('repository contract: session reset advances generation and stale cursors cannot be reused',async t=>{
  const {repos}=await fixture(t);
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

test('repository contract: delivery ordering, cursor binding and original-ID retry are stable',async t=>{
  const {repos}=await fixture(t);
  const binding=repos.sessions.binding(privateScope('bot','owner'));
  repos.deliveries.enqueue(binding,'source','turn',[{type:'text',text:'one'},{type:'asset',assetId:'asset-one'},{type:'text',text:'three'}],{});
  const page=repos.deliveries.pageDeliveries({filter:{scopeKey:binding.key},limit:2});
  assert.equal(page.items.length,2);assert.ok(page.nextCursor);
  assert.equal(repos.deliveries.pageDeliveries({filter:{scopeKey:binding.key},limit:2,cursor:page.nextCursor!}).items.length,1);
  assert.throws(()=>repos.deliveries.pageDeliveries({filter:{botId:'bot'},limit:2,cursor:page.nextCursor!}),/PAGE_CURSOR_MISMATCH/);
  const [first,second,third]=repos.deliveries.deliveries();
  repos.deliveries.deliveryState(first,'unknown',undefined,'receipt lost');
  assert.deepEqual(repos.deliveries.nextSendable('bot',10).map(row=>row.index),[1]);
  repos.deliveries.deliveryState(second,'sending');assert.equal(repos.deliveries.hasEarlierBlocker(third),true);
  repos.deliveries.deliveryState(second,'failed',undefined,'rejected');assert.deepEqual(repos.deliveries.nextSendable('bot',10).map(row=>row.index),[2]);
  const retried=repos.deliveries.retry(first.id);assert.equal(retried?.id,first.id);assert.equal(retried?.state,'pending');
  assert.equal(repos.deliveries.retry(first.id),undefined,'a pending delivery is not duplicated by retry');
});

test('repository contract: unknown is not replayed and explicit resend creates a new intent',async t=>{
  const {repos}=await fixture(t),binding=repos.sessions.binding(privateScope('bot','owner'));
  repos.deliveries.enqueue(binding,'source-1','turn-1',[{type:'asset',assetId:'asset-one'}],{});
  const first=repos.deliveries.deliveries()[0];repos.deliveries.deliveryState(first,'unknown',undefined,'receipt lost');
  assert.equal(repos.deliveries.nextSendable('bot',10).length,0);
  repos.deliveries.enqueue(binding,'source-2','turn-2',[{type:'asset',assetId:'asset-one'}],{});
  assert.equal(repos.deliveries.deliveries().length,1,'automatic registration reuses the unresolved claim');
  repos.deliveries.enqueue(binding,'source-3','turn-3',[{type:'asset',assetId:'asset-one',resend:true}],{});
  const rows=repos.deliveries.deliveries();assert.equal(rows.length,2);assert.notEqual(rows[1].id,first.id);
});

test('repository contract: a failed multi-write transaction rolls back every adapter',async t=>{
  const {persistence,repos}=await fixture(t),binding=repos.sessions.binding(privateScope('bot','owner'));
  assert.throws(()=>persistence.database.transaction(()=>{
    repos.inbox.accept({id:'message-1',text:'hello',scope:binding.scope,attachments:[],reply:{},timestamp:Date.now()});
    throw Error('BOOM');
  }),/BOOM/);
  assert.equal(repos.inbox.source(binding.key,'message-1'),undefined);
  assert.equal(repos.telemetry.metrics.findTurnMetric(`inbox:${binding.key}:message-1`),undefined);
});

test('repository contract: profile revisions are immutable',async t=>{
  const {persistence}=await fixture(t);
  const record={serviceId:'music' as const,profileId:'one',revision:1,contentHash:'a'.repeat(64),state:'ready' as const,capabilities:['music.search'],displayName:'Music',updatedAt:1,managedConfig:{endpoint:'x'}};
  persistence.profiles.save(record);assert.throws(()=>persistence.profiles.save(record),/PROFILE_REVISION_IMMUTABLE/);
});
