import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {EvolutionService,cleanValidationEnv,sourceFiles,sourceDigest,type ValidationCommand} from '../src/core/evolution.js';
import {atomicJson,packageIdentity,sha256} from '../src/lifecycle/protocol.js';

function fixture(t:any){
  mkdirSync('.codex',{recursive:true});const root=mkdtempSync(path.resolve('.codex/evolution-test-'));const source=path.join(root,'project');const home=path.join(root,'home');
  const write=(file:string,value:string)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,value);};
  for(const [name,value] of Object.entries({'package.json':'{"name":"test-package","version":"1.0.0"}','package-lock.json':'{}','cordis.patch.yml':'test','src/index.ts':'original dirty source','scripts/build.mjs':'protected build','src/lifecycle/index.ts':'protected coordinator','dist/index.js':'old code','dist/client.js':'client'}))write(path.join(source,name),value);
  write(path.join(source,'.runtime','credentials.json'),'secret');write(path.join(source,'node_modules','test','index.js'),'excluded');write(path.join(source,'.env'),'secret');
  const archive=path.join(home,'old.tgz');write(archive,'old archive');
  atomicJson(path.join(home,'installation.json'),{schemaVersion:1,sourceRoot:source,projectRoot:source,sourceDigest:sourceDigest(sourceFiles(source)),installedFrom:archive,current:{path:archive,sha256:sha256(archive),identity:packageIdentity(source)},updatedAt:Date.now()});
  const commands:string[]=[];
  const runner=async(command:ValidationCommand,cwd:string,env:NodeJS.ProcessEnv)=>{
    assert.ok(env.BOT_HOME?.startsWith(root));assert.equal(env.BOT_LAUNCH_TOKEN,undefined);commands.push(command.name);
    if(command.name==='build'){write(path.join(cwd,'dist/index.js'),'new code');write(path.join(cwd,'dist/client.js'),'client');}
    if(command.name==='pack'){write(path.join(path.dirname(cwd),'new.tgz'),'new archive');return JSON.stringify([{filename:'new.tgz'}]);}return'PASS';
  };
  const service=new EvolutionService({home,put:()=>{}},source,{available:()=>true,run:runner});
  t.after(()=>rmSync(root,{recursive:true,force:true}));return{root,source,home,write,service,commands,runner};
}

test('candidate copies the dirty source into the project without private/runtime/dependency material',t=>{
  const f=fixture(t);const task=f.service.create('trusted-scope','sakura','Improve a feature');
  assert.ok(task.candidateRoot!.startsWith(path.join(f.source,'.codex','evolution')));
  assert.equal(readFileSync(path.join(task.candidateRoot!,'src/index.ts'),'utf8'),'original dirty source');
  for(const name of ['.runtime','node_modules','.env','dist'])assert.equal(existsSync(path.join(task.candidateRoot!,name)),false);
  assert.equal(f.service.inspect(task.id).changes?.length,0);
  assert.equal(readFileSync(path.join(f.source,'src/index.ts'),'utf8'),'original dirty source');
});
test('validation protects lifecycle/launcher, isolates credentials, and queues rather than activating',async t=>{
  const f=fixture(t);const task=f.service.create('scope','sakura','Change response');const candidate=task.candidateRoot!;
  f.write(path.join(candidate,'src/index.ts'),'new source');const validated=await f.service.validate(task.id);
  assert.equal(validated.phase,'validated');assert.deepEqual(f.commands,['dependencies','typecheck','test','test:python','build','check:release','test:native','test:lifecycle-native','pack']);
  assert.equal(f.service.inspect(task.id).changes?.[0].file,'src/index.ts');
  assert.equal(f.service.queueApply(task.id).phase,'queued');assert.equal(readFileSync(path.join(f.source,'src/index.ts'),'utf8'),'original dirty source');
  assert.throws(()=>f.service.queueRestart('scope','sakura'),/pending/);
});
test('protected file and post-validation source/artifact edits fail closed',async t=>{
  const f=fixture(t);const protectedTask=f.service.create('scope','sakura','bad');f.write(path.join(protectedTask.candidateRoot!,'scripts/build.mjs'),'skip validation');
  await assert.rejects(f.service.validate(protectedTask.id),/Protected/);
  const task=f.service.create('scope','sakura','good');await f.service.validate(task.id);
  f.write(path.join(task.candidateRoot!,'src/index.ts'),'modified afterwards');assert.throws(()=>f.service.queueApply(task.id),/changed/);
  await f.service.validate(task.id);f.write(f.service.inspect(task.id).artifact!.path,'corrupt');assert.throws(()=>f.service.queueApply(task.id),/hash mismatch/);
});
test('validation failure and cancellation retain evidence without queueing',async t=>{
  const f=fixture(t);const abort=new AbortController();abort.abort(Error('Stopped'));
  const task=f.service.create('scope','sakura','cancel');await assert.rejects(f.service.validate(task.id,abort.signal),/Stopped/);
  assert.equal(f.service.inspect(task.id).phase,'failed');assert.throws(()=>f.service.queueApply(task.id),/Validate/);
});
test('missing coordinator and metadata refuse self-modification; validation environment excludes provider secrets',t=>{
  const f=fixture(t);const service=new EvolutionService({home:f.home,put:()=>{}},f.source,{available:()=>false});
  assert.throws(()=>service.create('scope','sakura','feature'),/coordinator/);
  const env=cleanValidationEnv(path.join(f.root,'isolated'));assert.equal(env.DSH_HOME,env.BOT_HOME);assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.BOT_LAUNCH_TOKEN,undefined);
});
test('orphaned validation is recovered as failed with retained evidence and can be retried',async t=>{
  const f=fixture(t);const task=f.service.create('scope','sakura','resume');task.phase='validating';task.validation=[{name:'typecheck',status:'PASS',log:'retained.log'}];f.service.journal.write(task);
  const resumed=new EvolutionService({home:f.home,put:()=>{}},f.source,{available:()=>true,run:f.runner});assert.equal(resumed.inspect(task.id).phase,'failed');assert.equal(resumed.inspect(task.id).validation?.[0].log,'retained.log');
  assert.equal((await resumed.validate(task.id)).phase,'validated');
});
test('installer records the same complete source digest and shipped-file identity as runtime',async t=>{
  const f=fixture(t);const {recordInstallation,identity}=await import('../scripts/installation.mjs' as string);
  const archive={path:path.join(f.home,'old.tgz'),sha256:sha256(path.join(f.home,'old.tgz'))};
  await recordInstallation({home:f.home,sourceRoot:f.source,installedFrom:f.source,archive,installedRoot:f.source});
  const installed=JSON.parse(readFileSync(path.join(f.home,'installation.json'),'utf8'));assert.equal(installed.sourceDigest,sourceDigest(sourceFiles(f.source)));assert.equal(await identity(f.source),packageIdentity(f.source));
  f.write(path.join(f.source,'python/worker.py'),'old');f.write(path.join(f.source,'package.json'),JSON.stringify({name:'test-package',files:['dist/*.js','python/**/*.py','cordis.patch.yml']}));
  const before=packageIdentity(f.source);f.write(path.join(f.source,'python/worker.py'),'changed');assert.notEqual(packageIdentity(f.source),before);assert.equal(await identity(f.source),packageIdentity(f.source));
});
test('manual rollback retains both current and selected historical source identities',async t=>{
  const f=fixture(t);const task=f.service.create('scope','sakura','feature');f.write(path.join(task.candidateRoot!,'src/index.ts'),'new source');const validated=await f.service.validate(task.id);
  f.service.journal.phase(validated,'succeeded','Simulated completed installation');
  const metadata=JSON.parse(readFileSync(path.join(f.home,'installation.json'),'utf8'));atomicJson(path.join(f.home,'installation.json'),{...metadata,sourceRoot:validated.candidateRoot,sourceDigest:validated.validatedDigest,current:validated.artifact});
  const rollback=f.service.rollback(task.id);assert.equal(rollback.sourceDigest,validated.validatedDigest);assert.equal(rollback.validatedDigest,task.sourceDigest);assert.equal(rollback.sourceRoot,validated.candidateRoot);assert.equal(rollback.selectedSourceRoot,task.sourceRoot);assert.equal(rollback.projectRoot,f.source);
});
