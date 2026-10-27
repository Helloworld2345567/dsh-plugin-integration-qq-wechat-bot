import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/core/store.js';
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
