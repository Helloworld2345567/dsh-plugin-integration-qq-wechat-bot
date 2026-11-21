import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pickDirectory as pickPlatformDirectory,type DirectoryPickerHost} from '../../../src/harness/pick-directory.js';
import {pickWindowsDirectory} from '../../../src/harness/windows-directory-picker.js';
import {Admin} from '../../../src/harness/admin.js';

async function fixture(t:any){
  const directory=await mkdtemp(path.resolve('.codex/pick-directory-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return directory;
}
const native=(pick:(signal:AbortSignal)=>Promise<string|null>):DirectoryPickerHost=>({capability:()=>({kind:'native',pick})});
const pickDirectory=(host:DirectoryPickerHost|undefined,signal?:AbortSignal)=>pickPlatformDirectory(host,signal,{},'linux');

test('host directory picker returns the real selected directory with Chinese characters and spaces',async t=>{
  const root=await fixture(t),directory=path.join(root,'中文 模型');await mkdir(directory);let calls=0;
  const host=native(async signal=>{calls++;assert.equal(signal.aborted,false);return directory;});
  assert.equal(await pickDirectory(host),await realpath(directory));assert.equal(calls,1);
});

test('cancelling the native directory picker leaves the draft unchanged',async()=>{
  assert.equal(await pickDirectory(native(async()=>null)),undefined);
});

test('other desktops require the host native directory capability',async()=>{
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

test('admin forwards the initial path, language and cancellation to its directory chooser',async()=>{
  const controller=new AbortController();let called=false;
  const host=native(async signal=>{called=true;controller.abort();assert.equal(signal.aborted,true);return null;});
  const admin=new Admin({} as any,{} as any,'fixture',undefined,undefined,undefined,(current,locale,signal)=>{
    assert.equal(current,'C:\\Models');assert.equal(locale,'en');assert.equal(signal,controller.signal);
    return pickDirectory(host,signal);
  });
  await assert.rejects(admin.command({version:1,kind:'command',name:'service.settings.pick-directory',input:{current:'C:\\Models',locale:'en'}},controller.signal),/DIRECTORY_PICKER_CANCELLED/);
  assert.equal(called,true);
});

test('Windows chooser sends paths as data and uses a cancellable PowerShell 7 STA process',async()=>{
  const signal=new AbortController().signal,initial='C:\\中文 models\\$(literal)';
  let calls=0;
  const selected=await pickWindowsDirectory(initial,'en',signal,async(command,args,request,options)=>{
    calls++;assert.equal(path.win32.basename(command),'pwsh.exe');assert.ok(args.includes('-STA'));
    assert.equal(args.some(value=>value.includes(initial)),false);
    assert.deepEqual(request,{kind:'directory',initial,title:'Choose directory'});assert.equal(options.signal,signal);
    assert.equal(options.maxOutputBytes,64*1024);
    return{path:initial};
  });
  assert.equal(selected,initial);assert.equal(calls,1);
  assert.equal(await pickWindowsDirectory(undefined,'zh',signal,async(_command,_args,request)=>{
    assert.deepEqual(request,{kind:'directory',initial:undefined,title:'选择目录'});return{path:null};
  }),null);
});

test('Windows chooser never opens or returns a selection after cancellation',async()=>{
  const controller=new AbortController();let calls=0;
  const run=async()=>{calls++;controller.abort();return{path:'C:\\late'};};
  await assert.rejects(pickWindowsDirectory(undefined,'en',controller.signal,run),{name:'AbortError'});
  await assert.rejects(pickWindowsDirectory(undefined,'en',controller.signal,run),{name:'AbortError'});
  assert.equal(calls,1);
  await assert.rejects(pickPlatformDirectory(undefined,controller.signal,{},'win32'),/DIRECTORY_PICKER_CANCELLED/);
});
