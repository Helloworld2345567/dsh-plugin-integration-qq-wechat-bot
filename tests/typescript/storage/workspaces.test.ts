import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {botSchema} from '../../../src/core/types.js';
import {SqlitePersistence} from '../../../src/infrastructure/sqlite/persistence.js';
import {Assets,MediaService} from '../../../src/core/media.js';
import {BotRuntime} from '../../../src/core/runtime.js';
import {defaultWorkspaceRoot,workingDirectory,prepareWorkingDirectory,sessionDirectory} from '../../../src/core/workspaces.js';
import {Admin} from '../../../src/harness/admin.js';
import {NativeHarness} from '../../../src/harness/bridge.js';
import {fixtureChannels} from '../../fixtures/test-channel.js';

async function fixture(t:any){
  const folder=await mkdtemp(path.resolve('.codex/workspace-test-'));const previous=process.env.BOT_WORKSPACE_ROOT;
  process.env.BOT_WORKSPACE_ROOT=path.join(folder,'default-root');const store=new SqlitePersistence(path.join(folder,'data'));
  t.after(async()=>{store.close();if(previous===undefined)delete process.env.BOT_WORKSPACE_ROOT;else process.env.BOT_WORKSPACE_ROOT=previous;await rm(folder,{recursive:true,force:true});});
  const bot=store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq'}));return{folder,store,bot};
}
test('default workspaces are repository-local and ignored, with isolated scope and session directories',async t=>{
  const f=await fixture(t);delete process.env.BOT_WORKSPACE_ROOT;
  assert.equal(defaultWorkspaceRoot(),path.resolve('.runtime/workspaces'));
  assert.ok(execFileSync('git',['check-ignore','--no-index','.runtime/workspaces/private.txt'],{encoding:'utf8',windowsHide:true}).trim());
  process.env.BOT_WORKSPACE_ROOT=path.join(f.folder,'default-root');
  const a=await prepareWorkingDirectory(f.bot,'scope-a',f.store.home);const b=await prepareWorkingDirectory(f.bot,'scope-b',f.store.home);assert.notEqual(a,b);
  await writeFile(path.join(a,'keep.txt'),'updated work');await prepareWorkingDirectory(f.bot,'scope-a',f.store.home);assert.equal(await readFile(path.join(a,'keep.txt'),'utf8'),'updated work');
  const binding=f.store.sessions.binding({botId:f.bot.id,platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'}),first=await f.store.workspaceFiles.session(binding.key,binding.sessionId),next=f.store.sessions.reset(binding.scope),second=await f.store.workspaceFiles.session(next.key,next.sessionId);
  assert.equal(first,path.join(workingDirectory(f.bot,binding.key,f.store.home),'sessions',binding.sessionId));assert.notEqual(first,second);
  await writeFile(path.join(first,'outputs','result.txt'),'first result');await assert.rejects(readFile(path.join(second,'outputs','result.txt')),{code:'ENOENT'});
  assert.throws(()=>sessionDirectory(a,'../outside'),/SESSION_WORKSPACE_PATH_INVALID/);
});
test('bot working directory saves preserve bindings and permissions; invalid paths never replace a working choice',async t=>{
  const f=await fixture(t);const assets=new Assets(f.store.repositories());const adapter={beginLogin:async()=>({status:'pending' as const}),pollLogin:async()=>({status:'expired' as const}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=> 'receipt'};const runtime=new BotRuntime(f.store.repositories(),assets,new MediaService(f.store.repositories(),assets),{run:async()=>{throw Error('unused');},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}},fixtureChannels(adapter),{} as any);t.after(()=>runtime.close());
  const binding=f.store.sessions.binding({botId:f.bot.id,platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'});
  const directory=path.join(f.folder,'自定义 工作目录 & literal');const saved=runtime.saveBot({...f.bot,workingDirectory:directory});
  assert.equal(workingDirectory(saved,binding.key),path.join(directory,f.bot.id,binding.key));assert.deepEqual(saved.trustedUsers,f.bot.trustedUsers);assert.equal(f.store.sessions.binding(binding.scope).sessionId,binding.sessionId);
  assert.notEqual(workingDirectory(saved,'other'),workingDirectory(saved,binding.key));assert.notEqual(workingDirectory({...saved,id:'other'},binding.key),workingDirectory(saved,binding.key));
  const file=path.join(f.folder,'file.txt');await writeFile(file,'file');for(const invalid of ['relative/path','C:relative',directory+'\0bad',file])assert.throws(()=>runtime.saveBot({...saved,workingDirectory:invalid}));
  assert.equal(f.store.bots.bot(f.bot.id).workingDirectory,directory);assert.equal((await realpath(directory)).toLowerCase(),directory.toLowerCase());
  const cleared=runtime.saveBot({...saved,workingDirectory:''});assert.equal(cleared.workingDirectory,undefined);assert.notEqual(workingDirectory(cleared,binding.key),directory);
});
test('configuration directory action opens only the selected persona directory and rejects arbitrary path requests',async t=>{
  const f=await fixture(t);const opened:string[]=[];const admin=new Admin({} as any,{repos:f.store.repositories()} as any,'fixture',async directory=>{opened.push(directory);});
  const directory=f.store.personaFiles.directory('sakura');
  const result=await admin.invoke('config.directory.open',{botId:f.bot.id,configId:'sakura'});assert.deepEqual(result,{opened:true,directory});assert.deepEqual(opened,[directory]);
  await assert.rejects(admin.invoke('config.directory.open',{path:f.folder}));await assert.rejects(admin.invoke('config.directory.open',{botId:'missing'}));assert.equal(opened.length,1);
  const failing=new Admin({} as any,{repos:f.store.repositories()} as any,'fixture',async()=>{throw Error('未确认配置目录窗口已打开');});
  await assert.rejects(failing.invoke('config.directory.open',{botId:f.bot.id}),/未确认配置目录窗口已打开/);
});

test('session outputs move with a changed workspace root and their actual location survives binding updates',async t=>{
  const f=await fixture(t),binding=f.store.sessions.binding({botId:f.bot.id,platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'});
  const original=await f.store.workspaceFiles.session(binding.key,binding.sessionId);await writeFile(path.join(original,'outputs','result.txt'),'retained output');
  const originalWorkspace=f.store.sessions.findSession(binding.sessionId)!.workspace;
  f.store.sessions.updateSession({...binding,persisted:true});assert.equal(f.store.sessions.findSession(binding.sessionId)!.workspace,originalWorkspace);
  const custom=path.join(f.folder,'changed-root');f.store.bots.saveBot({...f.bot,workingDirectory:custom});
  const changed=await f.store.workspaceFiles.session(binding.key,binding.sessionId);
  assert.equal(changed,path.join(custom,f.bot.id,binding.key,'sessions',binding.sessionId));
  assert.equal(await readFile(path.join(changed,'outputs','result.txt'),'utf8'),'retained output');await assert.rejects(readFile(path.join(original,'outputs','result.txt')),{code:'ENOENT'});
  assert.equal(f.store.sessions.findSession(binding.sessionId)!.workspace,path.join(custom,f.bot.id,binding.key));
  assert.equal(await f.store.workspaceFiles.session(binding.key,binding.sessionId),changed);
  await assert.rejects(f.store.workspaceFiles.session('foreign',binding.sessionId),/SESSION_OWNERSHIP_MISMATCH/);
});

test('changing the workspace waits for writing children and updates their cwd after moving session files',async t=>{
  const f=await fixture(t),binding=f.store.sessions.binding({botId:f.bot.id,platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'}),original=await f.store.workspaceFiles.session(binding.key,binding.sessionId);
  await writeFile(path.join(original,'outputs','result.txt'),'child output');
  let release!:()=>void,entered!:()=>void;const idle=new Promise<void>(resolve=>release=resolve),waiting=new Promise<void>(resolve=>entered=resolve);
  const main={id:binding.sessionId,status:'idle'},child={id:'child',status:'running',whenIdle:()=>{entered();return idle;}},foreign={id:'foreign',status:'running',whenIdle:()=>{throw Error('unrelated child must not be awaited');}},changed:Array<{id:string;cwd:string}>=[],killed:string[]=[];
  const terminals={list:(agent:{id:string})=>[{sessionId:`terminal-${agent.id}`}],kill:async(agent:{id:string},id:string)=>{assert.equal(child.status,'idle');assert.equal(await readFile(path.join(original,'outputs','result.txt'),'utf8'),'child output');assert.equal(id,`terminal-${agent.id}`);killed.push(agent.id);},hasOwnerActivity:()=>false};
  const ctx:any={on:()=>{},effect:()=>{},tools:{guard:()=>{}},agents:{list:()=>[main,child,foreign]},agentPresets:{serviceFor:()=>terminals},workingDirectory:{set:async(agent:{id:string},cwd:string)=>{changed.push({id:agent.id,cwd});}}};
  const assets=new Assets(f.store.repositories()),bridge=new NativeHarness(ctx,f.store.repositories(),assets,new MediaService(f.store.repositories(),assets),{skills:{} as any}),live={binding,cwd:original,shellDirectory:original},mainLive={binding,cwd:original,shellDirectory:original};
  (bridge as any).scoped.set(main,mainLive);(bridge as any).scoped.set(child,live);(bridge as any).scoped.set(foreign,{binding:{...binding,sessionId:'foreign'},cwd:original});
  assert.equal(await (bridge as any).prepareSessionDirectory(binding),original,'unchanged workspaces do not wait for children');
  const custom=path.join(f.folder,'child-root');f.store.bots.saveBot({...f.bot,workingDirectory:custom});
  const moving=(bridge as any).prepareSessionDirectory(binding) as Promise<string>;
  try{await waiting;assert.equal(await readFile(path.join(original,'outputs','result.txt'),'utf8'),'child output');assert.deepEqual(changed,[]);assert.deepEqual(killed,[]);}
  finally{child.status='idle';release();}
  const directory=await moving;assert.equal(await readFile(path.join(directory,'outputs','result.txt'),'utf8'),'child output');await assert.rejects(readFile(path.join(original,'outputs','result.txt')),{code:'ENOENT'});
  assert.deepEqual(changed,[{id:'child',cwd:directory}]);assert.equal(live.cwd,directory);assert.equal(live.shellDirectory,undefined);
  assert.deepEqual(killed,[binding.sessionId,'child']);assert.equal(mainLive.shellDirectory,undefined);assert.ok((bridge as any).closedTerminals.get(main).has(`terminal-${binding.sessionId}`));
});

test('unfinished terminal disposal prevents moving a session directory',async t=>{
  const f=await fixture(t),binding=f.store.sessions.binding({botId:f.bot.id,platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'}),original=await f.store.workspaceFiles.session(binding.key,binding.sessionId);
  await writeFile(path.join(original,'outputs','result.txt'),'retained output');
  const main={id:binding.sessionId},ctx:any={on:()=>{},effect:()=>{},tools:{guard:()=>{}},agents:{list:()=>[main]},agentPresets:{serviceFor:()=>({list:()=>[],hasOwnerActivity:()=>true})}};
  const assets=new Assets(f.store.repositories()),bridge=new NativeHarness(ctx,f.store.repositories(),assets,new MediaService(f.store.repositories(),assets),{skills:{} as any});
  const previous=f.store.sessions.findSession(binding.sessionId)!.workspace;f.store.bots.saveBot({...f.bot,workingDirectory:path.join(f.folder,'blocked-root')});
  await assert.rejects((bridge as any).prepareSessionDirectory(binding),/BOT_TERMINAL_TRANSITION_PENDING/);
  assert.equal(f.store.sessions.findSession(binding.sessionId)!.workspace,previous);assert.equal(await readFile(path.join(original,'outputs','result.txt'),'utf8'),'retained output');
});
