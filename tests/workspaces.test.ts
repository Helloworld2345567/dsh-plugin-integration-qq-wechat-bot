import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {botSchema} from '../src/core/types.js';
import {Store} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime} from '../src/core/runtime.js';
import {defaultWorkspaceRoot,workingDirectory,prepareWorkingDirectory} from '../src/core/workspaces.js';
import {Admin} from '../src/harness/admin.js';
import {fixtureChannels} from './test-channel.js';

async function fixture(t:any){
  const folder=await mkdtemp(path.resolve('.codex/workspace-test-'));const previous=process.env.BOT_WORKSPACE_ROOT;
  process.env.BOT_WORKSPACE_ROOT=path.join(folder,'default-root');const store=new Store(path.join(folder,'data'));
  t.after(async()=>{store.close();if(previous===undefined)delete process.env.BOT_WORKSPACE_ROOT;else process.env.BOT_WORKSPACE_ROOT=previous;await rm(folder,{recursive:true,force:true});});
  const bot=store.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq'}));return{folder,store,bot};
}
test('default workspaces are repository-local and ignored, with isolated scope directories and preserved legacy files',async t=>{
  const f=await fixture(t);delete process.env.BOT_WORKSPACE_ROOT;
  assert.equal(defaultWorkspaceRoot(),path.resolve('.runtime/workspaces'));
  assert.ok(execFileSync('git',['check-ignore','--no-index','.runtime/workspaces/private.txt'],{encoding:'utf8',windowsHide:true}).trim());
  process.env.BOT_WORKSPACE_ROOT=path.join(f.folder,'default-root');
  const legacy=path.join(f.store.home,'workspaces','scope-a');await mkdir(legacy,{recursive:true});await writeFile(path.join(legacy,'keep.txt'),'legacy work');
  const a=await prepareWorkingDirectory(f.bot,'scope-a',f.store.home);const b=await prepareWorkingDirectory(f.bot,'scope-b',f.store.home);assert.notEqual(a,b);
  assert.equal(await readFile(path.join(a,'keep.txt'),'utf8'),'legacy work');await assert.rejects(readFile(path.join(legacy,'keep.txt')),{code:'ENOENT'});
  await writeFile(path.join(a,'keep.txt'),'updated work');await prepareWorkingDirectory(f.bot,'scope-a',f.store.home);assert.equal(await readFile(path.join(a,'keep.txt'),'utf8'),'updated work');
});
test('bot working directory saves preserve bindings and permissions; invalid paths never replace a working choice',async t=>{
  const f=await fixture(t);const assets=new Assets(f.store);const adapter={beginLogin:async()=>({status:'pending' as const}),pollLogin:async()=>({status:'expired' as const}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=> 'receipt'};const runtime=new BotRuntime(f.store,assets,new MediaService(f.store,assets),{run:async()=>{throw Error('unused');},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}},fixtureChannels(adapter),{} as any);t.after(()=>runtime.close());
  const binding=f.store.binding({botId:f.bot.id,platform:'qq',accountId:'one',kind:'private',channelId:'alice',senderId:'alice'});
  const directory=path.join(f.folder,'自定义 工作目录 & literal');const saved=runtime.saveBot({...f.bot,workingDirectory:directory});
  assert.equal(workingDirectory(saved,binding.key),directory);assert.deepEqual(saved.trustedUsers,f.bot.trustedUsers);assert.equal(f.store.binding(binding.scope).sessionId,binding.sessionId);
  const file=path.join(f.folder,'file.txt');await writeFile(file,'file');for(const invalid of ['relative/path','C:relative',directory+'\0bad',file])assert.throws(()=>runtime.saveBot({...saved,workingDirectory:invalid}));
  assert.equal(f.store.bot(f.bot.id).workingDirectory,directory);assert.equal((await realpath(directory)).toLowerCase(),directory.toLowerCase());
  const cleared=runtime.saveBot({...saved,workingDirectory:''});assert.equal(cleared.workingDirectory,undefined);assert.notEqual(workingDirectory(cleared,binding.key),directory);
});
test('configuration directory action opens only the selected persona directory and rejects arbitrary path requests',async t=>{
  const f=await fixture(t);const opened:string[]=[];const admin=new Admin({} as any,{store:f.store} as any,'fixture',async directory=>{opened.push(directory);});
  const directory=f.store.personas.directory('sakura');
  const result=await admin.invoke('config.directory.open',{botId:f.bot.id,configId:'sakura'});assert.deepEqual(result,{opened:true,directory});assert.deepEqual(opened,[directory]);
  await assert.rejects(admin.invoke('config.directory.open',{path:f.folder}));await assert.rejects(admin.invoke('config.directory.open',{botId:'missing'}));assert.equal(opened.length,1);
  const failing=new Admin({} as any,{store:f.store} as any,'fixture',async()=>{throw Error('未确认配置目录窗口已打开');});
  await assert.rejects(failing.invoke('config.directory.open',{botId:f.bot.id}),/未确认配置目录窗口已打开/);
});
