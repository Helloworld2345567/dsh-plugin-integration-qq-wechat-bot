import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {Store} from '../src/core/store.js';
import {DynamicSkills} from '../src/core/skills.js';
import {configSchema} from '../src/core/types.js';
import {parseStatsArguments,renderStats} from '../src/core/features.js';
import {StatsService} from '../src/core/stats.js';

async function fixture(t:any){const root=await mkdtemp(path.resolve('.codex/skills-test-'));const store=new Store(root);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});return{root,store,skills:new DynamicSkills(store)};}
const files=(value:string)=>[{path:'SKILL.md',content:`---\nname: weather-helper\ndescription: 查询用户指定城市天气\n---\n${value}`},{path:'scripts/weather.py',content:`print(${JSON.stringify(value)})`}];
test('published skill instructions and script resources remain frozen across revisions',async t=>{
  const {skills,store}=await fixture(t);let config=store.config('sakura');config=store.saveConfig(skills.stageFiles(config,'weather-helper',files('FIRST')),config.revision);
  const old=skills.snapshot(config)['weather-helper'];assert.match(old.content,/FIRST/);assert.match(await readFile(path.join(old.resourceBase.path,'scripts/weather.py'),'utf8'),/FIRST/);
  config=store.saveConfig(skills.stageFiles(config,'weather-helper',files('SECOND')),config.revision);const next=skills.snapshot(config)['weather-helper'];
  assert.notEqual(old.version,next.version);assert.match(old.content,/FIRST/);assert.match(await readFile(path.join(old.resourceBase.path,'scripts/weather.py'),'utf8'),/FIRST/);assert.match(next.content,/SECOND/);
});
test('draft conflicts preserve manual edits and builtin shadowing/path escape is rejected',async t=>{
  const {skills,store}=await fixture(t);let config=store.config('sakura');config=store.saveConfig(skills.stageFiles(config,'weather-helper',files('FIRST')),config.revision);
  const draft=path.join(store.personas.directory('sakura'),'skills/weather-helper/SKILL.md');await writeFile(draft,files('MANUAL')[0].content);
  assert.throws(()=>skills.stageFiles(config,'weather-helper',files('REPLACED')),/DRAFT_CONFLICT/);assert.match(await readFile(draft,'utf8'),/MANUAL/);
  assert.throws(()=>skills.stageFiles(config,'image-generation',files('BAD')),/BUILTIN/);
  assert.throws(()=>skills.stageFiles(config,'escape',[{path:'../outside',content:'x'}]),/PATH_INVALID/);
  assert.throws(()=>skills.stageFiles(config,'escape',[{path:'scripts/CON.txt',content:'x'}]),/PATH_INVALID/);
  const updated=store.saveConfig(skills.stageDrafts(config),config.revision);assert.match(skills.snapshot(updated)['weather-helper'].content,/MANUAL/);
});
test('skill validation, disabled reload behavior and copying keep published versions explicit',async t=>{
  const {skills,store}=await fixture(t);const initial=store.config('sakura');
  assert.throws(()=>skills.snapshot({...initial,skills:['missing']}),/NOT_PUBLISHED/);
  assert.throws(()=>skills.stageFiles(initial,'weather-helper',[{path:'SKILL.md',content:'missing metadata'}]),/FRONTMATTER/);
  const published=store.saveConfig(skills.stageFiles(initial,'weather-helper',files('READY')),initial.revision);
  const disabled=store.saveConfig({...published,skills:published.skills.filter(s=>s!=='weather-helper')},published.revision);
  assert.ok(!skills.stageDrafts(disabled).skills.includes('weather-helper'));
  skills.copy(published,'copy');const copy=store.saveConfig({...published,id:'copy',revision:1});assert.match(skills.snapshot(copy)['weather-helper'].content,/READY/);
  const frozen=skills.snapshot(copy)['weather-helper'];await writeFile(path.join(frozen.resourceBase.path,'scripts/weather.py'),'tampered');assert.throws(()=>skills.snapshot(copy),/RELEASE_CHANGED/);
});
test('stats arguments remain bounded and unknown fields remain visible in chat formatting',async t=>{
  const {store}=await fixture(t);assert.deepEqual(parseStatsArguments('7d bot=one model=Example-MODEL groups'),{range:'7d',botId:'one',model:'Example-MODEL',groups:true});
  assert.throws(()=>parseStatsArguments('arbitrary=path'));
  const text=renderStats(new StatsService(store).query({range:'all'}));assert.match(text,/用量未知/);assert.match(text,/未报告/);
});

test('combined draft fingerprint keeps file limits per skill',async t=>{
  const {skills,store}=await fixture(t);const config=store.config('sakura');
  for(const name of ['weather-helper','second-helper']){
    const entries=[{path:'SKILL.md',content:files('READY')[0].content.replace('weather-helper',name)},...Array.from({length:100},(_,i)=>({path:`resources/${i}.txt`,content:'resource'}))];
    const root=path.join(store.personas.directory(config.id),'skills',name);await mkdir(path.join(root,'resources'),{recursive:true});
    for(const entry of entries)await writeFile(path.join(root,entry.path),entry.content);
  }
  const before=skills.draftFingerprint(config.id);
  await writeFile(path.join(store.personas.directory(config.id),'skills/second-helper/resources/0.txt'),'manual edit');
  assert.notEqual(skills.draftFingerprint(config.id),before);
});

test('failed second draft replacement restores only drafts already changed',async t=>{
  const {skills,store}=await fixture(t);let config=store.config('sakura');
  const skillFiles=(name:string,value:string)=>files(value).map(f=>({...f,content:f.content.replaceAll('weather-helper',name)}));
  for(const name of ['weather-helper','second-helper'])config=store.saveConfig(skills.stageFiles(config,name,skillFiles(name,'FIRST')),config.revision);
  const before=config;
  for(const name of ['weather-helper','second-helper'])config=store.saveConfig(skills.stageFiles(config,name,skillFiles(name,'SECOND')),config.revision);
  const second=path.join(store.personas.directory(config.id),'skills','second-helper');
  const rename=fs.renameSync;
  t.mock.method(fs,'renameSync',(source:fs.PathLike,target:fs.PathLike)=>{
    if(String(source)===second)throw Error('SIMULATED_RENAME_FAILURE');
    return rename(source,target);
  });syncBuiltinESMExports();
  try{assert.throws(()=>skills.restoreDrafts(before,config,()=>assert.fail('must not commit')),/SIMULATED_RENAME_FAILURE/);}
  finally{t.mock.restoreAll();syncBuiltinESMExports();}
  for(const name of ['weather-helper','second-helper'])assert.match(await readFile(path.join(store.personas.directory(config.id),'skills',name,'SKILL.md'),'utf8'),/SECOND/);
});

test('rollback recovery preserves a conflicting draft and still restores other changed drafts',async t=>{
  const {skills,store}=await fixture(t);let config=store.config('sakura');
  const skillFiles=(name:string,value:string)=>files(value).map(f=>({...f,content:f.content.replaceAll('weather-helper',name)}));
  for(const name of ['weather-helper','second-helper'])config=store.saveConfig(skills.stageFiles(config,name,skillFiles(name,'FIRST')),config.revision);
  const before=config;
  for(const name of ['weather-helper','second-helper'])config=store.saveConfig(skills.stageFiles(config,name,skillFiles(name,'SECOND')),config.revision);
  const draft=(name:string)=>path.join(store.personas.directory(config.id),'skills',name,'SKILL.md');
  assert.throws(()=>skills.restoreDrafts(before,config,()=>{fs.writeFileSync(draft('second-helper'),'MANUAL');throw Error('COMMIT_FAILED');}),/SKILL_ROLLBACK_CONFLICT/);
  assert.match(await readFile(draft('weather-helper'),'utf8'),/SECOND/);
  assert.equal(await readFile(draft('second-helper'),'utf8'),'MANUAL');
});
