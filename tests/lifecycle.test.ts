import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {LifecycleCoordinator,type PackageManager} from '../src/lifecycle/coordinator.js';
import {LifecycleJournal,atomicJson,packageIdentity,sha256,handleLifecycleShutdown,type EvolutionTask,type LifecycleRuntime} from '../src/lifecycle/protocol.js';

function fixture(t:any){
  mkdirSync('.codex',{recursive:true});const home=mkdtempSync(path.resolve('.codex/lifecycle-test-'));
  const make=(name:string)=>{const root=path.join(home,name);mkdirSync(path.join(root,'dist'),{recursive:true});writeFileSync(path.join(root,'package.json'),JSON.stringify({name,files:['dist/*.js','cordis.patch.yml']}));for(const file of ['cordis.patch.yml','dist/index.js','dist/client.js'])writeFileSync(path.join(root,file),name+file);const archive=path.join(home,`${name}.tgz`);writeFileSync(archive,name);return{root,artifact:{path:archive,sha256:sha256(archive),identity:packageIdentity(root)}};};
  const old=make('old'),next=make('next');atomicJson(path.join(home,'installation.json'),{schemaVersion:1,sourceRoot:old.root,sourceDigest:'old-source-digest',current:old.artifact,updatedAt:Date.now()});
  const journal=new LifecycleJournal(home);const task:EvolutionTask={id:'task-1',kind:'upgrade',scopeKey:'scope',configId:'sakura',goal:'change',phase:'queued',createdAt:1,updatedAt:1,artifact:next.artifact,previous:old.artifact,sourceRoot:old.root,sourceDigest:'old-source-digest',validatedDigest:'new-source-digest',events:[]};journal.write(task);
  let current=old.root;let drains=0,resumes=0;const calls:string[]=[];
  const runtime=():LifecycleRuntime=>({packageRoot:current,quiesce:async()=>{drains++;},resumeProcessing:()=>{resumes++;},health:()=>({ready:true})});
  const manager:PackageManager={listBundles:async()=>[{name:'dsh-plugin-integration-qq-wechat-bot',installed:true,enabled:true}],removeBundle:async()=>{calls.push('remove');return{application:'applied'};},installBundle:async file=>{calls.push(file);current=file===old.artifact.path?old.root:next.root;return{application:'applied'};}};
  t.after(()=>rmSync(home,{recursive:true,force:true}));return{home,old,next,journal,task,manager,runtime,calls,drains:()=>drains,resumes:()=>resumes};
}
test('independent coordinator drains before remove/install and checks the new identity',async t=>{
  const f=fixture(t);await new LifecycleCoordinator(f.home,f.manager,{runtime:f.runtime,healthTimeoutMs:100}).tick();
  assert.equal(f.drains(),1);assert.deepEqual(f.calls,['remove',f.next.artifact.path]);assert.equal(f.journal.read(f.task.id).phase,'succeeded');assert.equal(f.resumes(),1);
  assert.equal(JSON.parse(readFileSync(path.join(f.home,'installation.json'),'utf8')).current.sha256,f.next.artifact.sha256);
});
test('coordinator does not install until the calling turn has drained',async t=>{
  const f=fixture(t);let drain!:()=>void;const runtime=f.runtime();runtime.quiesce=()=>new Promise(resolve=>drain=resolve);
  const coordinator=new LifecycleCoordinator(f.home,f.manager,{runtime:()=>f.calls.length?f.runtime():runtime});const tick=coordinator.tick();
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.calls,[]);assert.equal(f.journal.read(f.task.id).phase,'draining');drain();await tick;assert.equal(f.journal.read(f.task.id).phase,'succeeded');
});
test('activation failure restores the archived previous package once',async t=>{
  const f=fixture(t);const install=f.manager.installBundle;f.manager.installBundle=async(file,options)=>file===f.next.artifact.path?{application:'failed',error:{code:'operation-error',diagnostic:'bad activation'}}:install(file,options);
  await new LifecycleCoordinator(f.home,f.manager,{runtime:f.runtime,healthTimeoutMs:100}).tick();const task=f.journal.read(f.task.id);
  assert.equal(task.phase,'rolled-back');assert.equal(task.rollbackAttempted,true);assert.deepEqual(f.calls,['remove','remove',f.old.artifact.path]);
  const metadata=JSON.parse(readFileSync(path.join(f.home,'installation.json'),'utf8'));assert.equal(metadata.sourceDigest,'old-source-digest');assert.equal(metadata.sourceRoot,f.old.root);
});
test('independently disposable bot and coordinator IPC listeners coalesce authenticated shutdown',()=>{
  const previous=process.env.BOT_LAUNCH_TOKEN;const key=Symbol.for('sakura.lifecycle.shutdown-requested');const prior=(globalThis as any)[key];delete(globalThis as any)[key];process.env.BOT_LAUNCH_TOKEN='test-token';
  try{
    let calls=0;const emit=()=>{calls++;};assert.equal(handleLifecycleShutdown({type:'bot-stop',nonce:'wrong'},emit),false);assert.equal(calls,0);
    assert.equal(handleLifecycleShutdown({type:'bot-stop',nonce:'test-token'},emit),true);assert.equal(handleLifecycleShutdown({type:'bot-stop',nonce:'test-token'},emit),true);assert.equal(calls,1);
  }finally{if(previous===undefined)delete process.env.BOT_LAUNCH_TOKEN;else process.env.BOT_LAUNCH_TOKEN=previous;if(prior===undefined)delete(globalThis as any)[key];else(globalThis as any)[key]=prior;}
});
test('restart-required waits for a new coordinator and does not mark success in the old process',async t=>{
  const f=fixture(t);let restarts=0;const install=f.manager.installBundle;f.manager.installBundle=async(file,options)=>{await install(file,options);return{application:'restart-required'};};
  const coordinator=new LifecycleCoordinator(f.home,f.manager,{runtime:f.runtime,restart:async()=>{restarts++;}});await coordinator.tick();await coordinator.tick();
  assert.equal(restarts,1);assert.equal(f.journal.read(f.task.id).phase,'restarting');
  await new LifecycleCoordinator(f.home,f.manager,{runtime:f.runtime}).tick();assert.equal(f.journal.read(f.task.id).phase,'succeeded');
});
test('interrupted removal is recovered using the previous archive, preserving all unrelated data',async t=>{
  const f=fixture(t);f.journal.phase(f.task,'applying','simulated crash');writeFileSync(path.join(f.home,'chat.sqlite'),'new chats');
  await new LifecycleCoordinator(f.home,f.manager,{runtime:f.runtime}).tick();assert.equal(f.journal.read(f.task.id).phase,'rolled-back');assert.equal(readFileSync(path.join(f.home,'chat.sqlite'),'utf8'),'new chats');
});
test('tampered archive fails before any uninstall',async t=>{
  const f=fixture(t);writeFileSync(f.next.artifact.path,'tampered');await new LifecycleCoordinator(f.home,f.manager,{runtime:f.runtime}).tick();assert.deepEqual(f.calls,[]);assert.equal(f.journal.read(f.task.id).phase,'failed');assert.equal(f.resumes(),1);
});
test('crash after package removal restores the archive without trying to remove an absent bundle',async t=>{
  const f=fixture(t);f.journal.phase(f.task,'applying','crashed after uninstall');f.manager.listBundles=async()=>[];
  f.manager.removeBundle=async()=>{throw Error('Must not call remove for absent bundle');};
  await new LifecycleCoordinator(f.home,f.manager,{runtime:f.runtime}).tick();assert.equal(f.journal.read(f.task.id).phase,'rolled-back');assert.deepEqual(f.calls,[f.old.artifact.path]);
});
test('supervisor accepts only authenticated durable restart requests and only starts after exit',async()=>{
  // JS module is intentionally shared by the packaged launcher, not imported by the bot bundle.
  const {Supervisor}=await import('../scripts/supervisor.mjs' as string);
  class Child extends EventEmitter {connected=true;exitCode=null;signalCode=null;sent:any[]=[];send(value:any){this.sent.push(value);}kill(){} }
  const children:Child[]=[];let recoveries=0;const task={id:'restart-1',phase:'restarting',artifact:{identity:'expected'}};
  const supervisor=new Supervisor({token:'secret',spawn:()=>{const child=new Child();children.push(child);return child;},readTask:async()=>task,recover:async()=>{recoveries++;},timeoutMs:10000});
  const first=supervisor.start();await supervisor.message(first,{type:'bot-restart',nonce:'wrong',taskId:task.id});assert.equal(first.sent.length,0);
  await supervisor.message(first,{type:'bot-restart',nonce:'secret',taskId:task.id});assert.equal(first.sent[0].type,'bot-stop');assert.equal(children.length,1);
  await supervisor.exited(first,0,1);assert.equal(children.length,2);
  await supervisor.message(children[1],{type:'bot-ready',nonce:'secret',identity:'wrong'});assert.equal(supervisor.healthy,false);
  await supervisor.exited(children[1],1,2);assert.equal(recoveries,1);assert.equal(children.length,3);assert.equal(supervisor.recoveryAttempted,true);
  task.id='restart-2';await supervisor.message(children[2],{type:'bot-restart',nonce:'secret',taskId:task.id});assert.equal(supervisor.recoveryAttempted,false);
  supervisor.stop();await supervisor.exited(children[2],0,3);
});
