import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store,scopeKey} from '../src/core/store.js';
import {Assets} from '../src/core/media.js';
import {botSchema,type CallerScope} from '../src/core/types.js';
import {scopeWorkspace,writeChatHistory} from '../src/core/workspace-files.js';

async function fixture(t:any){const root=await mkdtemp(path.resolve('.codex/storage-'));const store=new Store(path.join(root,'data'));store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq'}));const scope:CallerScope={botId:'bot',platform:'qq',accountId:'bot',kind:'private',channelId:'a',senderId:'a'};store.binding(scope);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});return{root,store,scope,key:scopeKey(scope),assets:new Assets(store)};}

test('media is grouped by kind, origin, date and scope; old assets and workspace edits keep IDs readable',async t=>{
  const f=await fixture(t),workspace=await scopeWorkspace(f.store,f.key);
  for(const kind of ['image','video','audio','file'] as const){const asset=await f.assets.save(f.key,{kind,name:'same.bin',mime:'application/octet-stream'},Buffer.from(kind));assert.equal(asset.path,path.join(workspace,{image:'images',video:'videos',audio:'audio',file:'files'}[kind],'received',new Date(asset.createdAt).toISOString().slice(0,10),f.key,asset.id,'same.bin'));}
  const asset=await f.assets.save(f.key,{kind:'image',name:'old.png',mime:'image/png'},Buffer.from('original'));
  const legacy=path.join(f.store.home,'assets',f.key,asset.id,'old.png');await mkdir(path.dirname(legacy),{recursive:true});await writeFile(legacy,'legacy pixels');await rm(asset.path);
  f.store.saveAsset({...asset,path:legacy,workspace:undefined,origin:undefined});await f.assets.migrate();assert.equal((await f.assets.read(f.key,asset.id)).toString(),'legacy pixels');await assert.rejects(stat(legacy),{code:'ENOENT'});
  const custom=path.join(f.root,'custom');f.store.saveBot({...f.store.bot('bot'),workingDirectory:custom});await f.assets.migrate();assert.ok(f.store.asset(f.key,asset.id).path.startsWith(custom+path.sep));assert.equal((await f.assets.read(f.key,asset.id)).toString(),'legacy pixels');
  await assert.rejects(f.assets.read('other-scope',asset.id),/不属于/);
});

test('readable history follows the selected workspace without reasoning or stale copies',async t=>{
  const f=await fixture(t),id=f.store.findBinding(f.key)!.sessionId;
  const events=[{type:'user/message',data:{message:{content:[{type:'text',text:'hello'}]}}},{type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'private reasoning'},{type:'text',text:'answer'}]}}}];
  await writeChatHistory(f.store,f.key,id,events);const original=f.store.get<any>('history-location',id).file;
  assert.match(await readFile(original,'utf8'),/hello/);assert.doesNotMatch(await readFile(original,'utf8'),/private reasoning/);
  const custom=path.join(f.root,'custom');f.store.saveBot({...f.store.bot('bot'),workingDirectory:custom});await writeChatHistory(f.store,f.key,id,events);
  const moved=f.store.get<any>('history-location',id).file;assert.ok(moved.startsWith(custom+path.sep));await assert.rejects(stat(original),{code:'ENOENT'});assert.match(await readFile(moved,'utf8'),/answer/);
});

test('installer moves shared runtime storage and preserves other composition and media bytes',async t=>{
  const root=await mkdtemp(path.resolve('.codex/storage-install-'));t.after(()=>rm(root,{recursive:true,force:true}));const home=path.join(root,'home'),workspace=path.join(root,'workspaces');
  for(const name of ['sessions','storages','attachments']){await mkdir(path.join(home,name),{recursive:true});await writeFile(path.join(home,name,'record.bin'),name);}
  const {configureWorkspaceStorage,moveStorage}=await import('../scripts/workspace-storage.mjs' as string);
  const patch=[{id:'other',config:{keep:true}},{id:'session-persistence-jsonl',config:{compression:'none'}}];await configureWorkspaceStorage(home,workspace,patch);
  assert.equal(patch[0].config.keep,true);assert.equal(patch[1].config.compression,'none');
  for(const name of ['sessions','storages','attachments']){assert.equal(await readFile(path.join(workspace,'.runtime',name,'record.bin'),'utf8'),name);await assert.rejects(stat(path.join(home,name)),{code:'ENOENT'});}
  await configureWorkspaceStorage(home,workspace,patch);assert.equal(patch.filter(item=>item.id==='attachment-local').length,1);
  await mkdir(path.join(home,'sessions'));await writeFile(path.join(home,'sessions','record.bin'),'conflict');await assert.rejects(moveStorage(path.join(home,'sessions'),path.join(workspace,'.runtime','sessions')),/conflict/);assert.equal(await readFile(path.join(workspace,'.runtime','sessions','record.bin'),'utf8'),'sessions');
});

test('launcher confines plugin home and temporary defaults to workspace runtime',async t=>{
  const root=await mkdtemp(path.resolve('.codex/storage-env-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const code='const {runtimeEnv}=await import("./scripts/runtime.mjs");console.log(JSON.stringify(Object.fromEntries(["USERPROFILE","HOME","TEMP","TMP","APPDATA","LOCALAPPDATA","BOT_DATA_HOME"].map(key=>[key,runtimeEnv[key]]))))';
  const env=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,BOT_HOME:path.join(root,'home'),BOT_WORKSPACE_ROOT:path.join(root,'workspaces')},windowsHide:true,encoding:'utf8'}));
  for(const value of Object.values(env))assert.ok(String(value).startsWith(path.join(root,'workspaces','.runtime')+path.sep));
  assert.ok((await readdir(path.join(root,'workspaces','.runtime'))).includes('tmp'));
});
