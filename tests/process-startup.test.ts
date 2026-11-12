import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {EventEmitter} from 'node:events';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {test} from 'node:test';
import {OutputValidatorRegistry} from '../src/core/output-validator.js';
import {ServiceContractError} from '../src/core/service-errors.js';
import {runJsonProcess} from '../src/harness/json-process.js';

test('failed worker and probe spawns retain their error when Windows pipes also fail',async t=>{
  await mkdir(path.resolve('.codex'),{recursive:true});
  const root=await mkdtemp(path.resolve('.codex/process-startup-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  const failure=Object.assign(new Error('spawn missing executable ENOENT'),{code:'ENOENT'});
  t.mock.method(childProcess,'spawn',()=>{
    const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>false});
    process.nextTick(()=>{
      child.emit('error',failure);
      child.stdout.emit('error',Object.assign(new Error('read ENOTCONN'),{code:'ENOTCONN'}));
      child.stderr.emit('error',Object.assign(new Error('read ENOTCONN'),{code:'ENOTCONN'}));
      child.emit('exit',-1);child.emit('close',-1);
    });
    return child;
  });
  syncBuiltinESMExports();
  await assert.rejects(runJsonProcess('missing',[],{},{cwd:root,signal:new AbortController().signal}),error=>error===failure);
  const file=path.join(root,'image.png');
  await writeFile(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'));
  await assert.rejects(new OutputValidatorRegistry({ffmpeg:'missing'}).validate({kind:'image',jobDirectory:root,file}),error=>error instanceof ServiceContractError&&error.cause===failure);
});
