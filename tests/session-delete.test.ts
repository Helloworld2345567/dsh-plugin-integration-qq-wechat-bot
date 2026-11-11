import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime} from '../src/core/runtime.js';
import type {HarnessPort} from '../src/core/runtime-ports.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {botSchema,type CallerScope,type ChannelAdapter,type InboundMessage,type SessionBinding} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';
import {deleteNativeSessions} from '../src/harness/session-deletion.js';
import {SessionQueryError} from '@deepseek-ai/dsh-session-query';

const owner:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
const input=(id:string,scope=owner):InboundMessage=>({id,scope,text:`message ${id}`,attachments:[],reply:{kind:'private',target:'owner',msgId:id},timestamp:Date.now()});
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
async function fixture(t:any){
  const home=await mkdtemp(path.resolve('.codex/session-delete-')),store=new SqlitePersistence(home);
  store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true,trustedUsers:['owner']}));
  const harness:HarnessPort={run:async(binding,_messages,_signal,options)=>({turnId:'1',outputs:[],snapshot:options?.snapshot??freezeTurn(store.personas.effectiveConfig(binding),store.bots.bot('bot'),binding.scope,[])}),cancel:()=>{},dispose:async()=>{},deleteSessions:async ids=>ids,validateModel:async()=>{}};
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=> 'receipt'};
  const channels=createChannelRegistry([{id:'qq',displayName:'QQ',capabilities:{conversations:['private'],login:[],groupSupport:'unsupported'},adapter}]);
  const assets=new Assets(store.repositories()),runtime=new BotRuntime(store.repositories(),assets,new MediaService(store.repositories(),assets),harness,channels,{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},60000);
  t.after(async()=>{await runtime.close();store.close();await rm(home,{recursive:true,force:true});});
  return{home,store,assets,harness,adapter,runtime};
}
async function seedHistory(store:SqlitePersistence,binding:SessionBinding,id:string){
  const message=input(id,binding.scope);store.inbox.accept(message);store.inbox.mark(binding.key,[id],'complete');
  store.turnMetrics.updateTurnMetrics(binding.key,[id],{sessionId:binding.sessionId,turnId:'1'});
  await store.repositories().chatHistory.write(binding.key,binding.sessionId,[{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:message.text}]}}]);
  store.deliveries.enqueue(binding,id,'1',[{type:'text',text:`reply ${id}`}],message.reply);
  return store.history.find(binding.sessionId)!.file;
}

test('deleting historical session removes only its records and exports and retains shared assets and memory after restart',async t=>{
  const f=await fixture(t),old=f.store.sessions.binding(owner),oldFile=await seedHistory(f.store,old,'old');
  f.store.inbox.updateMessage(old.key,{...input('old'),text:'我喜欢绿茶'});f.store.memory.remember(old.key,'preference','绿茶','old','我喜欢绿茶');
  const asset=await f.assets.save(old.key,{kind:'file',name:'shared.txt',mime:'text/plain'},Buffer.from('shared content'));
  const current=f.store.sessions.reset(owner),currentFile=await seedHistory(f.store,current,'current');
  f.store.deliveries.enqueue(current,'current','2',[{type:'asset',assetId:asset.id,resend:true}],input('current').reply);
  const other=f.store.sessions.binding({...owner,channelId:'other',senderId:'other'}),otherFile=await seedHistory(f.store,other,'other');
  const workspace=await f.store.workspaceFiles.scope(old.key),userFile=path.join(workspace,'keep-user-file.txt');await writeFile(userFile,'keep');
  const scheduled=f.runtime.automation.createJob(owner,'keep schedule',{runAt:Date.now()+86400000});
  const child='owned-child';f.store.statsData.putSessionOwner({sessionId:child,rootSessionId:old.sessionId,botId:'bot',kind:'subagent'});f.store.statsSessions.saveOwnedStart(child,3);
  f.harness.deleteSessions=async ids=>{assert.deepEqual(ids,[old.sessionId]);return[old.sessionId,child];};
  assert.deepEqual(await f.runtime.deleteSession(old.sessionId),{current:false});
  assert.equal(f.store.sessions.findSession(old.sessionId),undefined);assert.equal(f.store.sessions.findBinding(old.key)?.sessionId,current.sessionId);
  assert.ok(f.store.sessions.findSession(other.sessionId));assert.equal(f.store.inbox.source(old.key,'old'),undefined);
  assert.ok(f.store.inbox.source(current.key,'current'));assert.equal(f.store.statsData.getSessionOwner(child),undefined);
  assert.equal(f.store.memory.memories(old.key).length,1);assert.ok(f.store.automation.findJob(scheduled.id));
  await assert.rejects(stat(oldFile),{code:'ENOENT'});await stat(currentFile);await stat(otherFile);
  assert.equal(await readFile(asset.path,'utf8'),'shared content');assert.equal(await readFile(userFile,'utf8'),'keep');
  assert.ok(f.store.assets.findAsset(asset.id));assert.ok(f.store.deliveries.findByAsset(current.key,asset.id).length);
  const reopened=new SqlitePersistence(f.home);try{assert.equal(reopened.sessions.findSession(old.sessionId),undefined);assert.equal(reopened.sessions.findBinding(current.key)?.sessionId,current.sessionId);}finally{reopened.close();}
});

test('deleting the current running session drains its work and creates a blank replacement with the same overrides',async t=>{
  const f=await fixture(t),binding=f.store.sessions.binding(owner);
  f.store.sessions.updateSession({...binding,personaId:'sakura',modelOverride:{provider:'fixture',model:'chosen'}});
  const entered=gate();let stopped=false;
  f.harness.run=async(_binding,_messages,signal)=>{entered.resolve();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{stopped=true;resolve();},{once:true}));throw signal.reason;};
  f.harness.deleteSessions=async ids=>{assert.equal(stopped,true);assert.equal(f.runtime.busy(binding.key),false);return ids;};
  f.store.inbox.accept(input('running'));const processing=f.runtime.process(binding.key);await entered.promise;
  const result=await f.runtime.deleteSession(binding.sessionId);await processing;
  const next=f.store.sessions.findBinding(binding.key)!;
  assert.deepEqual(result,{current:true,newSessionId:next.sessionId});assert.notEqual(next.sessionId,binding.sessionId);
  assert.equal(next.generation,binding.generation+1);assert.equal(next.persisted,false);assert.equal(next.personaId,'sakura');assert.deepEqual(next.modelOverride,{provider:'fixture',model:'chosen'});
  assert.equal(f.store.sessions.findSession(binding.sessionId),undefined);
});

test('deleting a historical session does not cancel the active conversation in the same channel',async t=>{
  const f=await fixture(t),old=f.store.sessions.binding(owner);await seedHistory(f.store,old,'old');const current=f.store.sessions.reset(owner);
  const entered=gate(),finish=gate();let cancelled=false;
  f.harness.cancel=()=>{cancelled=true;};
  f.harness.run=async(_binding,_messages,_signal,options)=>{entered.resolve();await finish.promise;return{turnId:'1',outputs:[{type:'text',text:'current reply'}],snapshot:options!.snapshot!};};
  f.store.inbox.accept(input('active'));const processing=f.runtime.process(current.key);await entered.promise;
  try{assert.deepEqual(await f.runtime.deleteSession(old.sessionId),{current:false});assert.equal(cancelled,false);assert.equal(f.runtime.busy(current.key),true);assert.equal(f.store.sessions.findBinding(current.key)?.sessionId,current.sessionId);}finally{finish.resolve();await processing;}
});

test('a writer teardown failure keeps the binding, session index and readable history available for retry',async t=>{
  const f=await fixture(t),binding=f.store.sessions.binding(owner),file=await seedHistory(f.store,binding,'blocked');
  f.harness.deleteSessions=async()=>{throw Error('writer close failed');};
  await assert.rejects(f.runtime.deleteSession(binding.sessionId),/writer close failed/);
  assert.equal(f.store.sessions.findBinding(binding.key)?.sessionId,binding.sessionId);assert.ok(f.store.sessions.findSession(binding.sessionId));
  assert.ok(f.store.inbox.source(binding.key,'blocked'));await stat(file);
  f.harness.deleteSessions=async ids=>ids;assert.equal((await f.runtime.deleteSession(binding.sessionId)).current,true);
});

test('retry removes plugin history left after native logs were deleted with search disabled',async t=>{
  const f=await fixture(t),old=f.store.sessions.binding(owner),file=await seedHistory(f.store,old,'retry');
  const current=f.store.sessions.reset(owner);
  const ctx={sessionPersistence:{list:async()=>[],flush:async()=>{}},emit:()=>{},storageDomain:{get:()=>undefined},sessionQuery:{searchSessions:async()=>{throw new SessionQueryError('disabled','SESSION_QUERY_SEARCH_DISABLED');}}};
  f.harness.deleteSessions=ids=>deleteNativeSessions(ctx as any,ids,async(_ids,remove)=>remove());
  assert.deepEqual(await f.runtime.deleteSession(old.sessionId),{current:false});
  assert.equal(f.store.sessions.findSession(old.sessionId),undefined);
  assert.equal(f.store.sessions.findBinding(old.key)?.sessionId,current.sessionId);
  assert.equal(f.store.inbox.source(old.key,'retry'),undefined);
  assert.equal(f.store.deliveries.deliveries().some(row=>row.sessionId===old.sessionId),false);
  await assert.rejects(stat(file),{code:'ENOENT'});
});

test('session deletion cancels and drains only its own pending and in-flight deliveries',async t=>{
  const f=await fixture(t),old=f.store.sessions.binding(owner),current=f.store.sessions.reset(owner);
  f.store.deliveries.enqueue(old,'old','old-turn',[{type:'text',text:'old first'},{type:'text',text:'old second'}],input('old').reply);
  f.store.deliveries.enqueue(current,'new','new-turn',[{type:'text',text:'current'}],input('new').reply);
  const entered=gate();const sent:string[]=[];let stopped=false;
  f.adapter.send=async(_bot,_credential,delivery,_asset,signal)=>{if(delivery.sessionId===old.sessionId){entered.resolve();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{stopped=true;resolve();},{once:true}));throw Error('cancelled');}sent.push(delivery.output.text!);return 'current receipt';};
  const flushing=f.runtime.deliveryWorker.flush();await entered.promise;
  f.harness.deleteSessions=async ids=>{assert.equal(stopped,true);return ids;};
  await f.runtime.deleteSession(old.sessionId);await flushing;
  assert.deepEqual(sent,['current']);assert.equal(f.store.deliveries.deliveries().some(row=>row.sessionId===old.sessionId),false);
  assert.equal(f.store.deliveries.deliveries().find(row=>row.sessionId===current.sessionId)?.state,'sent');
});
