import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {Assets} from '../src/core/media.js';
import {botSchema,type CallerScope} from '../src/core/types.js';

import {deleteNativeSessions} from '../src/harness/session-deletion.js';
import {SessionQueryError} from '@deepseek-ai/dsh-session-query';
import {botHistorySentinelCounts,seedBotHistoryAggregate} from './sqlite-fixtures.js';

test('history purge removes old sessions, memories, media, automation and stats only for its owner',async t=>{
  const home=await mkdtemp(path.resolve('.codex/history-'));const store=new SqlitePersistence(home),assets=new Assets(store.repositories());
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  for(const id of ['one','two'])store.bots.saveBot(botSchema.parse({id,name:id,channel:'qq'}));
  const scope=(botId:string):CallerScope=>({botId,platform:'qq',accountId:botId,kind:'private',channelId:'alice',senderId:'alice'});
  const old=store.sessions.binding(scope('one')),fresh=store.sessions.reset(scope('one')),other=store.sessions.binding(scope('two'));
  for(const b of [old,fresh,other]){
    store.inbox.accept({id:b.sessionId,text:'private history',scope:b.scope,attachments:[],reply:{kind:'private',target:'alice',msgId:'source'},timestamp:Date.now()});
    await assets.save(b.key,{name:'test.txt',mime:'text/plain',kind:'file'},Buffer.from('attachment'));
    seedBotHistoryAggregate(store,b);
    store.deliveries.enqueue(b,'source','turn',[{type:'text',text:'private reply'}],{kind:'private',target:'alice',msgId:'source'});
    store.jobs.saveJob(b.sessionId,{id:b.sessionId,scope:b.key});await mkdir(path.join(home,'jobs',b.sessionId),{recursive:true});await writeFile(path.join(home,'jobs',b.sessionId,'input.json'),'private input');
  }
  const history=store.botHistory.snapshot('one');assert.deepEqual(history.sessions,new Set([old.sessionId,fresh.sessionId]));
  const ownedPaths=store.assets.allAssets().filter(item=>item.scopeKey===old.key).map(item=>item.path),otherPath=store.assets.allAssets().find(item=>item.scopeKey===other.key)!.path;
  await store.botHistory.deleteFiles(assets.root,history);store.botHistory.deleteRecords('one',history);
  assert.deepEqual(store.sessions.sessionsAll().map(item=>item.id),[other.sessionId]);
  assert.equal(store.sessions.bindings().length,1);assert.equal(store.inbox.allMessages().length,1);
  const sentinels=botHistorySentinelCounts(store);assert.equal(sentinels.memory,1);
  assert.equal(store.automation.listJobs().length,1);assert.equal(store.automation.listRuns('scheduled').length,1);assert.equal(sentinels.native,1);assert.equal(sentinels.replySequence,1);
  assert.equal(store.deliveries.deliveries().length,1);assert.equal(store.assets.allAssets().length,1);assert.equal(store.jobs.jobs().length,1);
  for(const file of ownedPaths)await assert.rejects(stat(file),{code:'ENOENT'});await stat(otherPath);
  await assert.rejects(stat(path.join(home,'jobs',old.sessionId)),{code:'ENOENT'});await stat(path.join(home,'jobs',other.sessionId));
  assert.equal(store.personas.config('sakura').id,'sakura');assert.equal(store.bots.bot('one').id,'one');
});

test('native deletion closes owners, clears cache, removes descendants and reconciles search without touching unrelated logs',async t=>{
  const root=await mkdtemp(path.resolve('.codex/native-history-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const headers=[{id:'parent'},{id:'child',parentSession:'parent'},{id:'grandchild',parentSession:'child'},{id:'other'}];
  for(const header of headers){await mkdir(path.join(root,header.id));await writeFile(path.join(root,header.id,'session.v4.jsonl'),'history');}
  const order:string[]=[];const ctx={sessionPersistence:{list:async()=>headers.map(header=>({header})),locate:(h:any)=>({kind:'jsonl',path:path.join(root,h.id,'session.v4.jsonl')}),flush:async()=>{order.push('flush');}},sessions:{get:()=>undefined},storageDomain:{get:()=>({table:()=>({delete:async(id:string)=>{order.push(`cache:${id}`);}})})},sessionQuery:{searchSessions:async()=>{order.push('search');}}};
  await deleteNativeSessions(ctx as any,['parent'],async id=>{order.push(`dispose:${id}`);});
  for(const header of headers.slice(0,3))await assert.rejects(stat(path.join(root,header.id)),{code:'ENOENT'});
  assert.equal(await readFile(path.join(root,'other','session.v4.jsonl'),'utf8'),'history');
  assert.deepEqual(order,['dispose:parent','dispose:child','dispose:grandchild','flush','cache:parent','cache:child','cache:grandchild','search']);
});

test('disabled native search needs no index cleanup, but actual index failures remain retryable',async()=>{
  const ctx={sessionPersistence:{list:async()=>[],flush:async()=>{}},sessions:{get:()=>undefined},storageDomain:{get:()=>undefined},sessionQuery:{searchSessions:async()=>{throw new SessionQueryError('disabled','SESSION_QUERY_SEARCH_DISABLED');}}};
  await deleteNativeSessions(ctx as any,['already-removed'],async()=>{});
  ctx.sessionQuery.searchSessions=async()=>{throw new SessionQueryError('broken index','SESSION_QUERY_INDEX_FAILED');};
  await assert.rejects(deleteNativeSessions(ctx as any,['already-removed'],async()=>{}),/broken index/);
});
