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
  const headers=[{id:'parent'},{id:'child',parentSession:'parent',origin:'subagent'},{id:'grandchild',parentSession:'child',origin:'subagent'},{id:'other'},{id:'fork',parentSession:'parent'}];
  for(const header of headers){await mkdir(path.join(root,header.id));await writeFile(path.join(root,header.id,'session.v4.jsonl'),'history');}
  const order:string[]=[];const removed:string[]=[];const ctx={sessionPersistence:{list:async()=>headers.map(header=>({header})),locate:(h:any)=>({kind:'jsonl',path:path.join(root,h.id,'session.v4.jsonl')}),flush:async()=>{order.push('flush');}},emit:(name:string,id:string)=>{assert.equal(name,'api-session/removed');removed.push(id);},storageDomain:{get:()=>({table:()=>({delete:async(id:string)=>{order.push(`cache:${id}`);}})})},sessionQuery:{searchSessions:async()=>{order.push('search');}}};
  await deleteNativeSessions(ctx as any,['parent'],async(ids,remove)=>{for(const id of ids)order.push(`dispose:${id}`);return remove();});
  for(const header of headers.slice(0,3))await assert.rejects(stat(path.join(root,header.id)),{code:'ENOENT'});
  assert.equal(await readFile(path.join(root,'other','session.v4.jsonl'),'utf8'),'history');
  assert.equal(await readFile(path.join(root,'fork','session.v4.jsonl'),'utf8'),'history');
  assert.deepEqual(order,['dispose:parent','dispose:child','dispose:grandchild','flush','cache:parent','cache:child','cache:grandchild','search']);
  assert.deepEqual(removed,['parent','child','grandchild']);
});

test('native deletion waits for an external owner to release its writer before removing logs or indexes',async t=>{
  const root=await mkdtemp(path.resolve('.codex/native-history-busy-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'web-owned'));const file=path.join(root,'web-owned','session.v4.jsonl');await writeFile(file,'history');
  let released=false,cacheDeletes=0;const ctx={sessionPersistence:{list:async()=>[{header:{id:'web-owned'}}],locate:()=>({kind:'jsonl',path:file}),flush:async()=>{assert.equal(released,true);}},emit:()=>{},storageDomain:{get:()=>({table:()=>({delete:async()=>{cacheDeletes++;}})})},sessionQuery:{searchSessions:async()=>{}}};
  assert.deepEqual(await deleteNativeSessions(ctx as any,['web-owned'],async(ids,remove)=>{assert.deepEqual(ids,['web-owned']);assert.equal(await readFile(file,'utf8'),'history');assert.equal(cacheDeletes,0);released=true;return remove();}),['web-owned']);
  await assert.rejects(stat(file),{code:'ENOENT'});assert.equal(cacheDeletes,1);
});

test('native deletion includes child logs published while its owner is being drained',async t=>{
  const root=await mkdtemp(path.resolve('.codex/native-history-late-child-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const headers:any[]=[{id:'parent'}];await mkdir(path.join(root,'parent'));await writeFile(path.join(root,'parent','session.v4.jsonl'),'parent');
  const removed:string[]=[];const ctx={sessionPersistence:{list:async()=>headers.map(header=>({header})),locate:(header:any)=>({kind:'jsonl',path:path.join(root,header.id,'session.v4.jsonl')}),flush:async()=>{}},emit:(_name:string,id:string)=>removed.push(id),storageDomain:{get:()=>undefined},sessionQuery:{searchSessions:async()=>{}}};
  const result=await deleteNativeSessions(ctx as any,['parent'],async(ids,remove)=>{
    assert.deepEqual(ids,['parent']);headers.push({id:'late-child',parentSession:'parent',origin:'subagent'});
    await mkdir(path.join(root,'late-child'));await writeFile(path.join(root,'late-child','session.v4.jsonl'),'child');
    return remove();
  });
  assert.deepEqual(result,['parent','late-child']);assert.deepEqual(removed,result);
  for(const id of result)await assert.rejects(stat(path.join(root,id)),{code:'ENOENT'});
});

test('disabled native search from another module permits retry after logs were removed, but other errors propagate',async()=>{
  const {SessionQueryError:HostSessionQueryError}=await import(`${import.meta.resolve('@deepseek-ai/dsh-session-query')}?native-deletion`);
  const hostDisabled=new HostSessionQueryError('disabled','SESSION_QUERY_SEARCH_DISABLED');
  assert.equal(hostDisabled instanceof SessionQueryError,false);
  let failure:unknown=hostDisabled;
  const ctx={sessionPersistence:{list:async()=>[],flush:async()=>{}},emit:()=>{},storageDomain:{get:()=>undefined},sessionQuery:{searchSessions:async()=>{throw failure;}}};
  assert.deepEqual(await deleteNativeSessions(ctx as any,['already-removed'],async(_ids,remove)=>remove()),['already-removed']);
  failure=new SessionQueryError('disabled','SESSION_QUERY_SEARCH_DISABLED');
  assert.deepEqual(await deleteNativeSessions(ctx as any,['already-removed'],async(_ids,remove)=>remove()),['already-removed']);
  for(failure of [new HostSessionQueryError('broken index','SESSION_QUERY_INDEX_FAILED'),new SessionQueryError('broken index','SESSION_QUERY_INDEX_FAILED'),new Error('session search is disabled')]){
    await assert.rejects(deleteNativeSessions(ctx as any,['already-removed'],async(_ids,remove)=>remove()),error=>error===failure);
  }
});
