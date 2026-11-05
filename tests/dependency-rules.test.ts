import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {analyzeModules,analyzePythonModules,formatArchitectureResult,normalizeRepoPath} from '../scripts/check-architecture.mjs';

const analyze=(entries:Array<{path:string;source:string}>)=>analyzeModules(entries);

test('architecture graph accepts inward dependencies and composition root wiring',()=>{
  const result=analyze([
    {path:'src/core/contract.ts',source:'export interface Port { run(): void }'},
    {path:'src/harness/adapter.ts',source:"import type {Port} from '../core/contract.js'; export const value=1;"},
    {path:'src/channels/qq.ts',source:"import type {Port} from '../core/contract.js'; export const channel=1;"},
    {path:'src/index.ts',source:"import './harness/adapter.js'; import './channels/qq.js';"},
  ]);
  assert.deepEqual(result.violations,[]);assert.deepEqual(result.cycles,[]);
});

test('architecture graph rejects client server imports, core client imports and production test imports',()=>{
  const result=analyze([
    {path:'src/core/domain.ts',source:"import '../client/view.js'; export const domain=1;"},
    {path:'src/client/view.ts',source:"import '../harness/admin.js'; import path from 'node:path'; export const view=path.sep;"},
    {path:'src/harness/admin.ts',source:"import '../../tests/fixture.js'; export const admin=1;"},
    {path:'tests/fixture.ts',source:'export const fixture=1;'},
  ]);
  assert.deepEqual(new Set(result.violations.map(item=>item.rule)),new Set(['client-node','client-server','core-direction','production-isolation']));
});

test('architecture graph detects runtime cycles but ignores type-only cycles',()=>{
  const runtime=analyze([
    {path:'src/core/a.ts',source:"import {b} from './b.js'; export const a=b;"},
    {path:'src/core/b.ts',source:"import {a} from './a.js'; export const b=a;"},
  ]);
  assert.deepEqual(runtime.cycles,[['src/core/a.ts','src/core/b.ts']]);assert.ok(runtime.violations.some(item=>item.rule==='typescript-cycle'));
  const types=analyze([
    {path:'src/core/a.ts',source:"import type {B} from './b.js'; export {type B} from './b.js'; export interface A {b:B}"},
    {path:'src/core/b.ts',source:"import type {A} from './a.js'; export {type A} from './a.js'; export interface B {a:A}"},
  ]);
  assert.deepEqual(types.cycles,[]);assert.deepEqual(types.violations,[]);
});

test('only the SQLite infrastructure adapter owns the database and generic records',()=>{
  const result=analyze([
    {path:'src/core/runtime.ts',source:"import {DatabaseSync} from 'node:sqlite'; export const db=new DatabaseSync('x');"},
    {path:'src/core/leak.ts',source:"export const read=(store:any)=>store.database.records; export const write=(db:any)=>db.prepare('select 1');"},
    {path:'src/infrastructure/sqlite/database.ts',source:"import {DatabaseSync} from 'node:sqlite'; export const open=(file:string)=>new DatabaseSync(file);"},
    {path:'src/infrastructure/sqlite/bot-repository.ts',source:"export const read=(database:any)=>database.records.get('bot','id');"},
    {path:'src/channels/qq.ts',source:"import '../infrastructure/sqlite/database.js'; export const channel=1;"},
    {path:'src/harness/admin.ts',source:"import '../infrastructure/sqlite/bot-repository.js'; export const admin=1;"},
    {path:'src/client/index.ts',source:"import '../infrastructure/sqlite/database.js'; export const view=1;"},
  ]);
  const rules=new Set(result.violations.map(item=>item.rule));
  for(const rule of ['sqlite-import','database-ownership','record-access','channel-repository','harness-repository','client-repository'])assert.ok(rules.has(rule),rule);
  assert.ok(!result.violations.some(item=>item.file.startsWith('src/infrastructure/')),'infrastructure adapters own SQL and records');
});
test('business layers depend on ports while adapters remain infrastructure-owned',()=>{
  const result=analyze([
    {path:'src/core/ports/asset.ts',source:"import type {Asset} from '../types.js'; export interface AssetRepository {asset(scope:string,id:string):Asset|undefined}"},
    {path:'src/core/media.ts',source:"import type {AssetRepository} from './ports/asset.js'; export const use=(repository:AssetRepository)=>repository;"},
    {path:'src/core/leak.ts',source:"import '../infrastructure/sqlite/database.js'; export const leak=1;"},
    {path:'src/core/new-service-adapter.ts',source:"import '../infrastructure/sqlite/database.js'; import 'node:sqlite'; export class Adapter implements ServiceAdapter {}"},
    {path:'src/core/provider.ts',source:'export class Provider implements ServiceAdapter {}'},
    {path:'src/channels/fixture.ts',source:"import '../infrastructure/sqlite/database.js'; export const channel=1"},
    {path:'src/infrastructure/sqlite/database.ts',source:'export const database=1'},
    {path:'src/index.ts',source:"import './infrastructure/sqlite/database.js'; import './core/runtime.js';"},
  ]);
  assert.ok(result.violations.some(item=>item.rule==='core-repository'&&item.file==='src/core/leak.ts'));
  assert.ok(result.violations.some(item=>item.rule==='service-adapter-isolation'&&item.file==='src/core/new-service-adapter.ts'));
  assert.ok(result.violations.some(item=>item.rule==='service-adapter-location'&&item.file==='src/core/provider.ts'));
  assert.ok(result.violations.some(item=>item.rule==='channel-repository'&&item.file==='src/channels/fixture.ts'));
  assert.ok(!result.violations.some(item=>item.file==='src/core/media.ts'));
  assert.ok(!result.violations.some(item=>item.file==='src/index.ts'),'composition root may create adapters');
});

test('lifecycle source is package-owned and cannot import or send QQ or WeChat messages',()=>{
  const entries=[
    {path:'packages/bot-lifecycle/src/index.ts',source:readFileSync(path.resolve('packages/bot-lifecycle/src/index.ts'),'utf8')},
    {path:'packages/bot-lifecycle/src/coordinator.ts',source:readFileSync(path.resolve('packages/bot-lifecycle/src/coordinator.ts'),'utf8')},
  ];const result=analyze(entries);assert.deepEqual(result.violations,[]);for(const entry of entries){assert.doesNotMatch(entry.source,/QQAdapter|WeixinAdapter|sendMessage|send_file|deliveryWorker/);assert.doesNotMatch(entry.source,/\.\.\/\.\.\/\.\.\/src\//);}
});

test('architecture graph rejects package escapes and unknown dynamic import or require targets',()=>{
  const result=analyze([
    {path:'packages/example/src/index.ts',source:"import '../../../src/core/types.js'; const target='./runtime.js'; void import(target);"},
    {path:'src/client/view.ts',source:"const target='../harness/admin.js'; void import(target); require('node:fs');"},
    {path:'src/core/types.ts',source:'export interface Value {}'},
  ]);
  assert.ok(result.violations.some(item=>item.rule==='package-isolation'));
  assert.equal(result.violations.filter(item=>item.rule==='dynamic-import-target').length,2);
  assert.ok(result.violations.some(item=>item.rule==='client-node'));
  assert.deepEqual(result.skippedDynamicImports,[{file:'packages/example/src/index.ts',line:1},{file:'src/client/view.ts',line:1}]);
});

test('Windows path normalization is stable and architecture output never leaks an absolute path',()=>{
  assert.equal(normalizeRepoPath('src\\client\\index.ts'),'src/client/index.ts');
  assert.equal(normalizeRepoPath('.\\src\\core\\types.ts'),'src/core/types.ts');
  const absolute=path.resolve('private-fixture');
  const fileUrl='file:///C:/Users/private/secret.js';
  const result=analyze([{path:'src/client/view.ts',source:`import ${JSON.stringify(absolute)}; import ${JSON.stringify(fileUrl)};`}]);
  const output=formatArchitectureResult(result);
  assert.doesNotMatch(output,new RegExp(absolute.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  assert.doesNotMatch(output,/Users|private|secret\.js/i);assert.match(output,/<absolute-import>/);
});

test('Python inventory includes relative imports and rejects nested import-time effects',()=>{
  const result=analyzePythonModules([
    {path:'python/package/module.py',source:'from .models import Value\nfrom ..network import open_url\n'},
    {path:'python/unsafe.py',source:'try:\n    subprocess.run(["provider"])\nexcept Exception:\n    pass\nif __name__ == "__main__":\n    subprocess.run(["allowed-cli"])\ndef execute():\n    subprocess.run(["allowed-runtime"])\n'},
  ]);
  assert.deepEqual(result.imports.map(item=>item.module),['.models','..network']);
  assert.deepEqual(result.importSideEffects,[{file:'python/unsafe.py',line:2}]);
  assert.ok(result.violations.some(item=>item.rule==='python-namespace-layout'&&item.file==='python/package/module.py'));
});

test('production skill registry is generated and module import does not scan manifests',()=>{
  const source=readFileSync(path.resolve('src/core/skill-operations.ts'),'utf8');
  assert.match(source,/PUBLISHED_SKILL_OPERATIONS/);
  assert.doesNotMatch(source,/skillOperationManifests\s*=\s*loadSkillOperations\s*\(/);
});

test('Python architecture rejects path mutation, bare internal imports, dynamic file modules and skill scripts',()=>{
  const result=analyzePythonModules([
    {path:'python/dsh_bot_runtime/good.py',source:'from dsh_bot_runtime.audio_output import encode_delivery_mp3\n'},
    {path:'python/dsh_bot_runtime/model_usage.py',source:'def journal(): pass\n'},
    {path:'python/dsh_bot_runtime/unsafe.py',source:'import sys\nsys.path.insert(0,"python")\nfrom model_usage import journal\nimport importlib.util\nimportlib.util.spec_from_file_location("same", "worker.py")\n'},
    {path:'skills/example/scripts/entry.py',source:'def execute(job): return job\n'},
  ]);
  assert.deepEqual(new Set(result.violations.map(item=>item.rule)),new Set(['python-path-mutation','python-bare-internal-import','python-dynamic-module-key','python-namespace-layout']));
});
