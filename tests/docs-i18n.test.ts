import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('documentation gate requires paired pages and reciprocal top navigation without duplicating runtime skills',async()=>{
  const {safeSubprocessEnv}=await import('../scripts/test-environment.mjs' as string);
  const temporaryRoot=path.resolve(process.env.BOT_TEST_TMP??'.codex');
  mkdirSync(temporaryRoot,{recursive:true});
  const directory=mkdtempSync(path.join(temporaryRoot,'docs-i18n-'));
  const script=path.resolve('scripts/check-docs.mjs');
  const write=(file:string,content:string)=>{const target=path.join(directory,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,content);};
  const check=()=>{
    const result=spawnSync(process.execPath,[script],{cwd:directory,env:safeSubprocessEnv({HOME:directory,TEMP:directory,TMP:directory}),encoding:'utf8',timeout:15_000,windowsHide:true});
    assert.equal(result.error,undefined);
    return {exit:result.status,...JSON.parse(result.stdout) as {status:string;languagePairs:number;failures:string[]}};
  };
  try{
    write('docs/guide.md','# 指南\n\n简体中文 | [English](en/guide.md)\n');
    assert.ok(check().failures.some(value=>value.includes('missing language counterpart docs/en/guide.md')));
    write('docs/en/guide.md','# Guide\n\nEnglish only\n');
    assert.ok(check().failures.some(value=>value.includes('missing top language navigation to docs/guide.md')));
    write('docs/en/guide.md','# Guide\n\n[简体中文](../guide.md) | English\n');
    write('skills/sample/SKILL.md','# Runtime instructions\n\nA single English runtime source.\n');
    assert.deepEqual(check(),{exit:0,status:'PASS',markdownFiles:3,languagePairs:1,yamlFiles:0,failures:[]});
    write('docs/en/orphan.md','# Orphan\n\n[简体中文](../orphan.md) | English\n');
    assert.ok(check().failures.some(value=>value.includes('missing language counterpart docs/orphan.md')));
  }finally{rmSync(directory,{recursive:true,force:true});}
});
