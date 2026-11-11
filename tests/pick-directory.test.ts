import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pickDirectory,type DirectoryPickerHost} from '../src/harness/pick-directory.js';
import {Admin} from '../src/harness/admin.js';

async function fixture(t:any){
  const directory=await mkdtemp(path.resolve('.codex/pick-directory-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return directory;
}
const native=(pick:(signal:AbortSignal)=>Promise<string|null>):DirectoryPickerHost=>({capability:()=>({kind:'native',pick})});

test('host directory picker returns the real selected directory with Chinese characters and spaces',async t=>{
  const root=await fixture(t),directory=path.join(root,'中文 模型');await mkdir(directory);let calls=0;
  const host=native(async signal=>{calls++;assert.equal(signal.aborted,false);return directory;});
  assert.equal(await pickDirectory(host),await realpath(directory));assert.equal(calls,1);
});

test('cancelling the native directory picker leaves the draft unchanged',async()=>{
  assert.equal(await pickDirectory(native(async()=>null)),undefined);
});

test('directory picking requires the host native capability instead of starting a separate shell',async()=>{
  await assert.rejects(pickDirectory(undefined),/不支持/);
  const host={capability:()=>({kind:'browse'})} as DirectoryPickerHost;
  await assert.rejects(pickDirectory(host),/不支持/);
});

test('native selections must be absolute, accessible directories',async t=>{
  const directory=await fixture(t),file=path.join(directory,'file.txt');await writeFile(file,'fixture');
  await assert.rejects(pickDirectory(native(async()=> 'relative')),/路径无效/);
  await assert.rejects(pickDirectory(native(async()=>path.join(directory,'missing'))),/不存在或无法访问/);
  await assert.rejects(pickDirectory(native(async()=>file)),/不是文件夹/);
});

test('native picker errors expose only a stable diagnostic',async()=>{
  const host=native(async()=>{throw Error('#< CLIXML\nprivate backend failure');});
  await assert.rejects(pickDirectory(host),error=>{
    assert.match(String(error),/DIRECTORY_PICKER_FAILED/);
    assert.doesNotMatch(String(error),/CLIXML|private backend/);return true;
  });
});

test('request cancellation reaches the native chooser and cannot return a stale selection',async()=>{
  const controller=new AbortController();let received:AbortSignal|undefined;
  const host=native(async signal=>{received=signal;controller.abort(Error('private cancellation reason'));return null;});
  await assert.rejects(pickDirectory(host,controller.signal),/DIRECTORY_PICKER_CANCELLED/);
  assert.equal(received?.aborted,true);
  let opened=false;
  await assert.rejects(pickDirectory(native(async()=>{opened=true;return null;}),controller.signal),/DIRECTORY_PICKER_CANCELLED/);
  assert.equal(opened,false);
});

test('admin uses the composed host picker and forwards request cancellation',async()=>{
  const controller=new AbortController();let called=false;
  const host=native(async signal=>{called=true;controller.abort();assert.equal(signal.aborted,true);return null;});
  const ctx={get:(name:string)=>{assert.equal(name,'directoryPicker');return host;}};
  const admin=new Admin(ctx as any,{} as any,'fixture');
  await assert.rejects(admin.command({version:1,kind:'command',name:'service.settings.pick-directory',input:{current:'unused',locale:'en'}},controller.signal),/DIRECTORY_PICKER_CANCELLED/);
  assert.equal(called,true);
});
