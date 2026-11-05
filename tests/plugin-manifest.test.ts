import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {Config} from '../src/index.js';
import {chinese,zh} from '../src/client/locale.js';

test('Host Config validates deployment settings and supplies the debounce default',()=>{
  assert.deepEqual(Config({}),{debounceMs:2000});
  assert.deepEqual(Config({dataDir:'runtime',python:'python3',debounceMs:0}),{dataDir:'runtime',python:'python3',debounceMs:0});
  assert.deepEqual(Config({unknown:true} as any),{debounceMs:2000,unknown:true});
  for(const input of [{dataDir:1},{python:1},{dataDir:''},{python:''},{debounceMs:-1},{debounceMs:60001},{debounceMs:1.5}])assert.throws(()=>Config(input as any),JSON.stringify(input));
  const schemaJson=JSON.stringify(Config.toJSON());assert.match(schemaJson,/数据目录/);assert.match(schemaJson,/Python/);assert.match(schemaJson,/毫秒/);
});

test('Chinese client locale resolves every declared key and parameter',()=>{
  for(const key of Object.keys(zh) as Array<keyof typeof zh>){const text=chinese(key);assert.notEqual(text,key);assert.ok(text.length>0);}
  assert.equal(chinese('botCount',{count:3}),'3 个机器人');
  assert.equal(chinese('deleteBotLabel',{name:'小樱',id:'sakura'}),'删除机器人 小樱（sakura）');
});

test('plugin manifests export localized metadata and bounded original SVG icons',async()=>{
  for(const directory of ['.','packages/bot-lifecycle']){
    const manifest=JSON.parse(await readFile(path.resolve(directory,'package.json'),'utf8'));
    assert.equal(manifest.engines.dsh,'0.2.1-rc.5');assert.equal(manifest.exports['./locale/*.json'],'./locale/*.json');assert.equal(manifest.exports['./icon'],'./icon.svg');
    assert.ok(manifest.files.includes('locale/*.json'));assert.ok(manifest.files.includes('icon.svg'));
    const locale=JSON.parse(await readFile(path.resolve(directory,'locale/zh.json'),'utf8'));assert.ok(locale.meta.title);assert.ok(locale.meta.description);
    const icon=await readFile(path.resolve(directory,'icon.svg'),'utf8');assert.ok(Buffer.byteLength(icon)<=256*1024);assert.match(icon,/^<svg\b/);assert.match(icon,/viewBox="0 0 64 64"/);assert.doesNotMatch(icon,/<script|(?:xlink:)?href=/i);
  }
});

test('client copy is centralized and styles use only live Harness theme tokens',async()=>{
  const files=['index.ts','automation.ts','statistics.ts','music.ts','singing.ts','voice-models.ts','ui.ts'];
  for(const file of files){const source=await readFile(path.resolve('src/client',file),'utf8');assert.doesNotMatch(source,/\p{Script=Han}/u,`${file} contains non-localized Chinese copy`);}
  const index=await readFile(path.resolve('src/client/index.ts'),'utf8');assert.match(index,/inject:\['slots','locale'\]/);assert.match(index,/ctx\.locale\.register/);assert.match(index,/ctx\.locale\.bind/);
  const styles=await readFile(path.resolve('src/client/styles.ts'),'utf8');assert.doesNotMatch(styles,/(?:#[0-9a-f]{3,8}|rgba?\()/i);for(const token of ['--dsw-alias-bg-base','--dsw-alias-bg-layer-1','--dsw-alias-label-primary','--dsw-alias-label-secondary','--dsw-alias-border-l1','--dsw-alias-brand-primary','--dsw-alias-state-error-primary'])assert.match(styles,new RegExp(token));
});
