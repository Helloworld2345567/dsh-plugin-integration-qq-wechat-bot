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

test('deleting historical session removes its attachments but retains media shared with another session and channel memory',async t=>{
  const f=await fixture(t),old=f.store.sessions.binding(owner),oldFile=await seedHistory(f.store,old,'old');
  f.store.inbox.updateMessage(old.key,{...input('old'),text:'我喜欢绿茶'});f.store.memory.remember(old.key,'preference','绿茶','old','我喜欢绿茶');
  const asset=await f.assets.save(old.key,{kind:'file',name:'shared.txt',mime:'text/plain'},Buffer.from('shared content'));
  const received=await f.assets.save(old.key,{kind:'image',name:'received.png',mime:'image/png'},Buffer.from('received'));
  const generated=await f.assets.save(old.key,{kind:'audio',name:'generated.wav',mime:'audio/wav'},Buffer.from('generated'),'old-job');
  const sent=await f.assets.save(old.key,{kind:'file',name:'sent.txt',mime:'text/plain'},Buffer.from('sent'),undefined,'sent');
  f.store.assets.saveAsset({...received,pinned:true});
  const current=f.store.sessions.reset(owner),currentFile=await seedHistory(f.store,current,'current');
  const currentAsset=await f.assets.save(current.key,{kind:'file',name:'current.txt',mime:'text/plain'},Buffer.from('current attachment'));
  f.store.deliveries.enqueue(current,'current','2',[{type:'asset',assetId:asset.id,resend:true}],input('current').reply);
  const other=f.store.sessions.binding({...owner,channelId:'other',senderId:'other'}),otherFile=await seedHistory(f.store,other,'other');
  const workspace=await f.store.workspaceFiles.scope(old.key),userFile=path.join(workspace,'keep-user-file.txt');await writeFile(userFile,'keep');
  const oldDirectory=await f.store.workspaceFiles.session(old.key,old.sessionId),currentDirectory=await f.store.workspaceFiles.session(current.key,current.sessionId);
  await writeFile(path.join(oldDirectory,'outputs','old.txt'),'old session output');await writeFile(path.join(currentDirectory,'outputs','current.txt'),'current session output');
  const scheduled=f.runtime.automation.createJob(owner,'keep schedule',{runAt:Date.now()+86400000});
  const child='owned-child';f.store.statsData.putSessionOwner({sessionId:child,rootSessionId:old.sessionId,botId:'bot',kind:'subagent'});f.store.statsSessions.saveOwnedStart(child,3);
  f.runtime.saveBot({...f.store.bots.bot('bot'),workingDirectory:path.join(f.home,'new-root')});
  f.harness.deleteSessions=async ids=>{assert.deepEqual(ids,[old.sessionId]);return[old.sessionId,child];};
  assert.deepEqual(await f.runtime.deleteSession(old.sessionId),{current:false});
  assert.equal(f.store.sessions.findSession(old.sessionId),undefined);assert.equal(f.store.sessions.findBinding(old.key)?.sessionId,current.sessionId);
  assert.ok(f.store.sessions.findSession(other.sessionId));assert.equal(f.store.inbox.source(old.key,'old'),undefined);
  assert.ok(f.store.inbox.source(current.key,'current'));assert.equal(f.store.statsData.getSessionOwner(child),undefined);
  assert.equal(f.store.memory.memories(old.key).length,1);assert.ok(f.store.automation.findJob(scheduled.id));
  await assert.rejects(stat(oldFile),{code:'ENOENT'});await stat(currentFile);await stat(otherFile);
  await assert.rejects(stat(oldDirectory),{code:'ENOENT'});assert.equal(await readFile(path.join(currentDirectory,'outputs','current.txt'),'utf8'),'current session output');
  assert.equal(await readFile(asset.path,'utf8'),'shared content');assert.equal(await readFile(userFile,'utf8'),'keep');
  assert.ok(f.store.assets.findAsset(asset.id));assert.ok(f.store.deliveries.findByAsset(current.key,asset.id).length);
  for(const removed of [received,generated,sent]){await assert.rejects(stat(removed.path),{code:'ENOENT'});assert.equal(f.store.assets.findAsset(removed.id),undefined);}
  assert.equal(await readFile(currentAsset.path,'utf8'),'current attachment');assert.ok(f.store.assets.findAsset(currentAsset.id));
  const reopened=new SqlitePersistence(f.home);try{assert.equal(reopened.sessions.findSession(old.sessionId),undefined);assert.equal(reopened.sessions.findBinding(current.key)?.sessionId,current.sessionId);for(const removed of [received,generated,sent])assert.equal(reopened.assets.findAsset(removed.id),undefined);assert.ok(reopened.assets.findAsset(currentAsset.id));}finally{reopened.close();}
  f.harness.deleteSessions=async ids=>ids;await f.runtime.deleteSession(current.sessionId);
  assert.equal(f.store.assets.findAsset(asset.id),undefined);await assert.rejects(stat(asset.path),{code:'ENOENT'});
});

test('deleting history retains attachments reused by another session input or pending quote',async t=>{
  const f=await fixture(t),old=f.store.sessions.binding(owner);await seedHistory(f.store,old,'old');
  const owned=await f.assets.save(old.key,{kind:'file',name:'owned.txt',mime:'text/plain'},Buffer.from('owned'));
  f.store.inbox.updateMessage(old.key,{...input('old'),attachments:[{kind:'file',name:owned.name,mime:owned.mime,handle:owned.id}]});
  const reused=await f.assets.save(old.key,{kind:'file',name:'reused.txt',mime:'text/plain'},Buffer.from('reused'));
  const quoted=await f.assets.save(old.key,{kind:'file',name:'quoted.txt',mime:'text/plain'},Buffer.from('quoted'));
  const current=f.store.sessions.reset(owner);await seedHistory(f.store,current,'current');
  f.store.inbox.updateMessage(current.key,{...input('current'),attachments:[{kind:'file',name:reused.name,mime:reused.mime,handle:reused.id}]});
  f.store.failures.saveFailure('earlier-attempt',{sessionId:old.sessionId,scope:old.key,sourceIds:['current']});
  f.store.turnSnapshots.saveTurnSnapshot(old.sessionId,freezeTurn(f.store.personas.effectiveConfig(old),f.store.bots.bot('bot'),owner,['current']));
  f.store.inbox.accept({...input('pending'),quoted:{attachments:[{kind:'file',name:quoted.name,mime:quoted.mime,handle:quoted.id}]}});
  await f.runtime.deleteSession(old.sessionId);
  assert.equal(f.store.assets.findAsset(owned.id),undefined);await assert.rejects(stat(owned.path),{code:'ENOENT'});
  for(const retained of [reused,quoted]){assert.ok(f.store.assets.findAsset(retained.id));assert.equal(await readFile(retained.path,'utf8'),retained===reused?'reused':'quoted');}
});

for(const evidence of ['failure','turn-snapshot'] as const)test(`deleting a pre-model attachment failure uses ${evidence} ownership when the metric has no session`,async t=>{
  const f=await fixture(t),old=f.store.sessions.binding(owner);let modelCalls=0;
  f.harness.run=async()=>{modelCalls++;throw Error('model must not run');};
  f.adapter.materialize=async()=>{throw Error('attachment unavailable');};
  f.store.inbox.accept({...input('downloaded'),attachments:[{kind:'file',name:'downloaded.txt',mime:'text/plain',bytes:Buffer.from('downloaded').toString('base64')}]});
  f.store.inbox.accept({...input('unavailable'),attachments:[{kind:'file',name:'missing.txt',mime:'text/plain',url:'https://example.invalid/missing'}]});
  await f.runtime.process(old.key);
  assert.equal(modelCalls,0);assert.equal(f.store.turnMetrics.findTurnMetric(`inbox:${old.key}:downloaded`)?.sessionId,undefined);
  const attachment=f.store.assets.allAssets()[0];assert.ok(attachment);assert.equal(f.store.inbox.source(old.key,'downloaded')?.attachments[0].handle,attachment.id);
  if(evidence==='failure')f.store.database.records.delete('turn-snapshot',old.sessionId);
  else for(const row of f.store.failures.entries())f.store.failures.delete(row.id);
  f.store.sessions.reset(owner);
  await f.runtime.deleteSession(old.sessionId);
  assert.equal(f.store.assets.findAsset(attachment.id),undefined);await assert.rejects(stat(attachment.path),{code:'ENOENT'});
});

test('deleting the current session removes its attachment referenced only by a cancelled unassigned input',async t=>{
  const f=await fixture(t),binding=f.store.sessions.binding(owner);
  const attachment=await f.assets.save(binding.key,{kind:'file',name:'pending.txt',mime:'text/plain'},Buffer.from('pending'));
  f.store.inbox.accept({...input('pending'),attachments:[{kind:'file',name:attachment.name,mime:attachment.mime,handle:attachment.id}]});
  assert.equal(f.store.turnMetrics.findTurnMetric(`inbox:${binding.key}:pending`)?.sessionId,undefined);
  await f.runtime.deleteSession(binding.sessionId);
  assert.equal(f.store.inbox.stateOf(binding.key,'pending'),'cancelled');
  assert.equal(f.store.assets.findAsset(attachment.id),undefined);await assert.rejects(stat(attachment.path),{code:'ENOENT'});
});

test('a current media job protects only its historical inputs until its own session is deleted',async t=>{
  const f=await fixture(t),old=f.store.sessions.binding(owner);
  const used=await f.assets.save(old.key,{kind:'file',name:'used.txt',mime:'text/plain'},Buffer.from('historical input'));
  const unused=await f.assets.save(old.key,{kind:'file',name:'unused.txt',mime:'text/plain'},Buffer.from('unused'));
  const current=f.store.sessions.reset(owner),entered=gate(),finish=gate();
  const media=new MediaService(f.store.repositories(),f.assets,'python',undefined,{run:async job=>{entered.resolve();await finish.promise;return{text:await readFile(job.inputs[0].path,'utf8')};}});
  const pending=media.run(current.key,'document_read',f.store.personas.effectiveConfig(current),[used.id],{},new AbortController().signal);
  try{
    await Promise.race([entered.promise,pending.then(()=>{throw Error('worker did not enter');})]);
    assert.equal(f.store.inbox.allMessages().length,0);assert.equal(f.store.deliveries.deliveries().length,0);
    const job=f.store.jobs.jobs()[0];assert.equal(job.sessionId,current.sessionId);assert.deepEqual(job.inputAssetIds,[used.id]);
    await f.runtime.deleteSession(old.sessionId);
    assert.ok(f.store.assets.findAsset(used.id));await stat(used.path);
    assert.equal(f.store.assets.findAsset(unused.id),undefined);await assert.rejects(stat(unused.path),{code:'ENOENT'});
  }finally{finish.resolve();await pending;}
  assert.equal((await pending).text,'historical input');assert.equal(f.store.jobs.jobs()[0].state,'complete');
  await f.runtime.deleteSession(current.sessionId);
  assert.equal(f.store.assets.findAsset(used.id),undefined);await assert.rejects(stat(used.path),{code:'ENOENT'});
});

test('deleting the current running session drains its work and creates a blank replacement with the same overrides',async t=>{
  const f=await fixture(t),binding=f.store.sessions.binding(owner);
  const attachment=await f.assets.save(binding.key,{kind:'file',name:'current.txt',mime:'text/plain'},Buffer.from('current attachment'));
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
  assert.equal(f.store.assets.findAsset(attachment.id),undefined);await assert.rejects(stat(attachment.path),{code:'ENOENT'});
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
  const attachment=await f.assets.save(binding.key,{kind:'file',name:'retry.txt',mime:'text/plain'},Buffer.from('retry attachment'));
  f.harness.deleteSessions=async()=>{throw Error('writer close failed');};
  await assert.rejects(f.runtime.deleteSession(binding.sessionId),/writer close failed/);
  assert.equal(f.store.sessions.findBinding(binding.key)?.sessionId,binding.sessionId);assert.ok(f.store.sessions.findSession(binding.sessionId));
  assert.ok(f.store.inbox.source(binding.key,'blocked'));await stat(file);
  assert.equal(await readFile(attachment.path,'utf8'),'retry attachment');assert.ok(f.store.assets.findAsset(attachment.id));
  f.harness.deleteSessions=async ids=>ids;assert.equal((await f.runtime.deleteSession(binding.sessionId)).current,true);
  assert.equal(f.store.assets.findAsset(attachment.id),undefined);await assert.rejects(stat(attachment.path),{code:'ENOENT'});
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
