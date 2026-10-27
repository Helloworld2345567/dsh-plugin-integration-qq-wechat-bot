import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store,ConflictError} from '../src/core/store.js';
import {defaultPersonasRoot} from '../src/core/personas.js';
import {BotRuntime} from '../src/core/runtime.js';
import {Assets,MediaService} from '../src/core/media.js';
import {botSchema,configSchema,type BotConfig} from '../src/core/types.js';
import {freezeTurn,allowedNow} from '../src/core/policy.js';
import {Admin} from '../src/harness/admin.js';
import {fixtureChannels} from './test-channel.js';

function fixture(t:any){
  const root=mkdtempSync(path.resolve('.codex/personas-test-'));const home=path.join(root,'storages','bot-integration');const store=new Store(home);
  t.after(()=>{store.close();rmSync(root,{recursive:true,force:true});});
  const folder=store.personas.directory('sakura');
  const settings=()=>JSON.parse(readFileSync(path.join(folder,'config.json'),'utf8'));
  const edit=(patch:any)=>writeFileSync(path.join(folder,'config.json'),JSON.stringify({...settings(),...patch},null,2));
  const assets=new Assets(store);let validations=0,cancellations=0;let validate:((c:BotConfig)=>Promise<void>)|undefined;
  const adapter={beginLogin:async()=>({status:'pending' as const}),pollLogin:async()=>({status:'expired' as const}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=> 'receipt'};
  const runtime=new BotRuntime(store,assets,new MediaService(store,assets),{run:async()=>{throw Error('unused');},cancel:()=>{},dispose:async()=>{},validateModel:async c=>{validations++;if(c.model?.model==='invalid')throw Error('UNKNOWN_MODEL');await validate?.(c);},recheckPermissions:()=>{cancellations++;}},fixtureChannels(adapter),{} as any);
  t.after(()=>runtime.close());
  return{root,home,store,folder,settings,edit,runtime,validations:()=>validations,cancellations:()=>cancellations,setValidate:(fn:(c:BotConfig)=>Promise<void>)=>{validate=fn;}};
}

test('existing applied configurations export once at the product root, preserving revisions, history and sessions',_t=>{
  const root=mkdtempSync(path.resolve('.codex/personas-migration-'));const home=path.join(root,'storages','bot-integration');mkdirSync(home,{recursive:true});
  const original=configSchema.parse({id:'sakura',name:'迁移人设',revision:9,personaPrompt:'原始人设\n第二行',model:{provider:'fixture',model:'chat'},tools:['web_search']});
  const db=new DatabaseSync(path.join(home,'bots.sqlite'));db.exec('CREATE TABLE records(kind TEXT,id TEXT,json TEXT,PRIMARY KEY(kind,id))');
  const put=db.prepare('INSERT INTO records VALUES(?,?,?)');
  for(const c of [configSchema.parse({id:'default',name:'默认',personaPrompt:'默认人设'}),original])put.run('config',c.id,JSON.stringify(c));
  put.run('config-version','sakura:8',JSON.stringify({...original,revision:8,personaPrompt:'历史'}));put.run('binding','fixture',JSON.stringify({sessionId:'same-session'}));db.close();
  let store=new Store(home);
  try{
    assert.equal(store.personas.root,path.join(root,'personas'));assert.equal(defaultPersonasRoot(path.join(root,'custom')),path.join(root,'custom','personas'));
    const file=store.personas.read('sakura');assert.deepEqual(file.config,original);assert.equal('personaPrompt' in JSON.parse(readFileSync(path.join(root,'personas','sakura','config.json'),'utf8')),false);
    assert.equal(store.personaStatus('sakura').state,'synced');assert.equal(store.get<any>('binding','fixture').sessionId,'same-session');assert.equal(store.get<any>('config-version','sakura:8').personaPrompt,'历史');
    writeFileSync(path.join(root,'personas','sakura','persona.md'),'手工草稿');store.close();store=new Store(home);
    assert.equal(store.personas.read('sakura').config.personaPrompt,'手工草稿');assert.deepEqual(store.config('sakura'),original);assert.equal(store.personaStatus('sakura').state,'draft');
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('panel saves update both persona files; external drafts block overwrites and apply once with a new version',async t=>{
  const f=fixture(t);const old=f.store.config('sakura');
  const saved=await f.runtime.saveConfig({...old,name:'面板名称',personaPrompt:'面板人设'},old.revision);
  assert.deepEqual(f.store.personas.read('sakura').config,saved);assert.equal(saved.revision,2);
  const bot=f.store.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',configId:'sakura',enabled:true}));
  const scope={botId:bot.id,platform:'qq' as const,accountId:'one',kind:'private' as const,channelId:'alice',senderId:'alice'};const binding=f.store.binding(scope);const snapshot=freezeTurn(saved,bot,scope,[]);
  f.edit({name:'文件名称',tools:[]});writeFileSync(path.join(f.folder,'persona.md'),'文件人设\n保留换行\n');
  await assert.rejects(f.runtime.saveConfig({...saved,name:'覆盖'},saved.revision),ConflictError);
  assert.equal(f.store.config('sakura').revision,2);assert.equal(f.store.personas.read('sakura').config.name,'文件名称');
  const applied=await f.runtime.applyPersonaFiles('sakura');
  assert.equal(applied.revision,3);assert.equal(applied.personaPrompt,'文件人设\n保留换行\n');assert.equal(f.settings().revision,3);assert.equal(f.store.personaStatus('sakura').state,'synced');
  assert.equal(f.store.binding(scope).sessionId,binding.sessionId);assert.equal(snapshot.config.personaPrompt,'面板人设');assert.equal(allowedNow('bot_media',snapshot,applied,bot,scope),false);assert.ok(f.cancellations()>=2);
  assert.equal((await f.runtime.applyPersonaFiles('sakura')).revision,3);assert.equal(f.store.get<BotConfig>('config-version','sakura:2')?.personaPrompt,'面板人设');
});

test('invalid files and models keep the applied version intact; stale drafts and edits during validation conflict',async t=>{
  const f=fixture(t);const old=f.store.config('sakura');
  for(const patch of [{id:'other'},{apiKey:'must-not-be-accepted'},{model:{provider:'p',model:'invalid'}},{revision:99}]){
    writeFileSync(path.join(f.folder,'config.json'),JSON.stringify({...(({personaPrompt,...rest})=>rest)(old),...patch}));
    await assert.rejects(f.runtime.applyPersonaFiles('sakura'));assert.deepEqual(f.store.config('sakura'),old);
  }
  writeFileSync(path.join(f.folder,'config.json'),'not json');await assert.rejects(f.runtime.applyPersonaFiles('sakura'));assert.equal(f.store.personaStatus('sakura').state,'error');
  writeFileSync(path.join(f.folder,'config.json'),JSON.stringify((({personaPrompt,...rest})=>rest)(old)));
  f.setValidate(async()=>{writeFileSync(path.join(f.folder,'persona.md'),'校验时发生的修改');});
  await assert.rejects(f.runtime.applyPersonaFiles('sakura'),/校验期间被修改/);assert.deepEqual(f.store.config('sakura'),old);assert.equal(readFileSync(path.join(f.folder,'persona.md'),'utf8'),'校验时发生的修改');
});

test('interrupted two-file saves recover according to the SQLite commit and preserve unexpected external changes',t=>{
  const f=fixture(t);const beforeConfig=f.settings();const beforePersona=readFileSync(path.join(f.folder,'persona.md'),'utf8');
  const before={config:readFileSync(path.join(f.folder,'config.json'),'utf8'),persona:beforePersona};
  const next={...f.store.config('sakura'),name:'新版本',personaPrompt:'新的人设',revision:2};const {personaPrompt,...settings}=next;
  const after={config:JSON.stringify(settings,null,2)+'\n',persona:personaPrompt};const journal=path.join(f.folder,'.pending.json');
  writeFileSync(journal,JSON.stringify({before,after}));writeFileSync(path.join(f.folder,'persona.md'),after.persona);
  f.store.personas.recover('sakura',f.store.config('sakura'));assert.equal(readFileSync(path.join(f.folder,'persona.md'),'utf8'),beforePersona);assert.deepEqual(f.settings(),beforeConfig);assert.equal(existsSync(journal),false);
  writeFileSync(journal,JSON.stringify({before,after}));writeFileSync(path.join(f.folder,'persona.md'),after.persona);
  f.store.put('config','sakura',next);f.store.personas.recover('sakura',next);assert.deepEqual(f.settings(),settings);assert.equal(existsSync(journal),false);
  writeFileSync(journal,JSON.stringify({before,after}));writeFileSync(path.join(f.folder,'persona.md'),'人工在崩溃后修改');
  assert.throws(()=>f.store.personas.recover('sakura',next),/保存期间被修改/);assert.equal(readFileSync(path.join(f.folder,'persona.md'),'utf8'),'人工在崩溃后修改');assert.equal(existsSync(journal),true);
});

test('a failed SQLite commit restores the draft pair without publishing a revision',t=>{
  const f=fixture(t);const old=f.store.config('sakura');const fingerprint=f.store.personas.read('sakura').digest;
  f.store.db.exec("CREATE TRIGGER fail_persona BEFORE UPDATE ON records WHEN NEW.kind='config' BEGIN SELECT RAISE(ABORT,'fixture commit failure'); END");
  assert.throws(()=>f.store.saveConfig({...old,personaPrompt:'must roll back'},old.revision),/fixture commit failure/);
  assert.deepEqual(f.store.config('sakura'),old);assert.equal(f.store.personas.read('sakura').digest,fingerprint);assert.equal(f.store.get('config-version','sakura:2'),undefined);assert.equal(existsSync(path.join(f.folder,'.pending.json')),false);
});

test('a live writer journal is never recovered by a second Store instance',t=>{
  const f=fixture(t);const before={config:readFileSync(path.join(f.folder,'config.json'),'utf8'),persona:readFileSync(path.join(f.folder,'persona.md'),'utf8')};
  const journal=path.join(f.folder,'.pending.json');writeFileSync(journal,JSON.stringify({pid:process.pid,before,after:{...before,persona:'正在保存'}}));
  writeFileSync(path.join(f.folder,'persona.md'),'正在保存');
  const other=new Store(f.home);try{assert.equal(readFileSync(path.join(f.folder,'persona.md'),'utf8'),'正在保存');assert.equal(existsSync(journal),true);assert.equal(other.personaStatus('sakura').state,'error');assert.throws(()=>other.saveConfig({...other.config('sakura'),name:'并发写入'},1),/活动进程/);}finally{other.close();}
});

test('file actions use validated persona IDs, support adding a persona, and never accept caller paths',async t=>{
  const f=fixture(t);const admin=new Admin({} as any,f.runtime,'fixture',async()=>{});
  const copy={...f.settings(),id:'new-persona',revision:1};const folder=f.store.personas.directory(copy.id);mkdirSync(folder);writeFileSync(path.join(folder,'config.json'),JSON.stringify(copy));writeFileSync(path.join(folder,'persona.md'),'新的人设');
  const created=await admin.invoke('config.files.apply',{id:copy.id}) as BotConfig;assert.equal(created.revision,1);assert.equal(created.personaPrompt,'新的人设');
  for(const id of ['../outside','../sakura','CON','SAKURA','D:/outside'])await assert.rejects(admin.invoke('config.files.apply',{id}));
  await assert.rejects(admin.invoke('config.files.apply',{id:'sakura',path:f.root}));
  const directories=await admin.invoke('directories',{}) as any;assert.equal(directories.configDirectory,path.join(f.root,'personas'));assert.equal(directories.storageDirectory,f.home);assert.equal(directories.personas.find((p:any)=>p.id==='new-persona').state,'synced');
});

test('pre-existing partial or invalid persona drafts survive migration and do not disable applied configs',t=>{
  const f=fixture(t);rmSync(path.join(f.folder,'config.json'));writeFileSync(path.join(f.folder,'persona.md'),'保留草稿');
  const reopened=new Store(f.home);try{assert.equal(reopened.config('sakura').revision,1);assert.equal(reopened.personaStatus('sakura').state,'error');assert.equal(readFileSync(path.join(f.folder,'persona.md'),'utf8'),'保留草稿');assert.equal(existsSync(path.join(f.folder,'config.json')),false);}finally{reopened.close();}
});

test('persona directory junctions cannot redirect reads or writes outside the personas root',async t=>{
  const f=fixture(t);const target=path.join(f.root,'outside');mkdirSync(target);const file=path.join(target,'persona.md');writeFileSync(file,'不可覆盖');
  const link=path.join(f.store.personas.root,'linked');symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(f.runtime.applyPersonaFiles('linked'),/普通目录/);
  assert.throws(()=>f.store.saveConfig({...f.store.config('sakura'),id:'linked'}),/普通目录/);assert.equal(readFileSync(file,'utf8'),'不可覆盖');assert.equal(existsSync(path.join(target,'config.json')),false);
});
