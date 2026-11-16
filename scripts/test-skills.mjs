#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cli=fileURLToPath(import.meta.resolve('tsx/cli'));

function run(command,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:root,stdio:'inherit',windowsHide:true});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${command} ${args.join(' ')} exited ${code}`)));
  });
}

await run(process.execPath,['scripts/check-skills.mjs']);
await run(process.execPath,['scripts/generate-skill-registry.mjs','--check']);
await run(process.execPath,[cli,'--test','--test-concurrency=1','tests/skills.test.ts','tests/skill-operations.test.ts']);
