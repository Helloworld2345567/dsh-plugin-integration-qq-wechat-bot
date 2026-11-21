import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pickFile} from '../../../src/harness/pick-file.js';
import {pickWindowsFile} from '../../../src/harness/windows-file-picker.js';
import {Admin} from '../../../src/harness/admin.js';

async function fixture(t:TestContext){
  await mkdir(path.resolve('.codex'),{recursive:true});
  const directory=await mkdtemp(path.resolve('.codex/pick-file-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(path.join(directory,'folder.json'));
  for(const name of ['中文 工作流.json','UPPER.JSON','notes.txt'])await writeFile(path.join(directory,name),'{}');
  return await realpath(directory);
}

const select=(selected:unknown,signal?:AbortSignal)=>pickFile(undefined,'en',signal,'win32',async()=>selected);

test('native workflow selection resolves accessible JSON files with Chinese, spaces and uppercase extensions',async t=>{
  const directory=await fixture(t);
  for(const name of ['中文 工作流.json','UPPER.JSON']){
    const selected=path.join(directory,name);
    assert.equal(await select(selected),await realpath(selected));
  }
});

test('cancelling the native workflow chooser returns no selection',async()=>{
  assert.equal(await select(null),undefined);
});

test('workflow selections must be absolute accessible JSON files',async t=>{
  const directory=await fixture(t);
  for(const invalid of ['relative.json',path.join(directory,'notes.txt'),undefined,{},123]){
    await assert.rejects(select(invalid),/路径无效/);
  }
  await assert.rejects(select(path.join(directory,'missing.json')), /不存在或无法访问/);
  await assert.rejects(select(path.join(directory,'folder.json')), /不是文件/);
});

test('request cancellation prevents opening the file chooser and discards a late selection',async t=>{
  const directory=await fixture(t),controller=new AbortController();let calls=0,received:AbortSignal|undefined;
  const choose:typeof pickWindowsFile=async(_initial,_locale,signal)=>{
    calls++;received=signal;controller.abort(Error('private request cancellation'));
    return path.join(directory,'中文 工作流.json');
  };
  await assert.rejects(pickFile(undefined,'en',controller.signal,'win32',choose),error=>{
    assert.match(String(error),/FILE_PICKER_CANCELLED/);
    assert.doesNotMatch(String(error),/private request/);return true;
  });
  assert.equal(received?.aborted,true);
  await assert.rejects(pickFile(undefined,'en',controller.signal,'win32',choose),/FILE_PICKER_CANCELLED/);
  assert.equal(calls,1);
});

test('native file chooser failures expose only a stable diagnostic',async()=>{
  await assert.rejects(pickFile(undefined,'en',undefined,'win32',async()=>{throw Error('#< CLIXML private backend failure');}),error=>{
    assert.match(String(error),/FILE_PICKER_FAILED/);
    assert.doesNotMatch(String(error),/CLIXML|private backend/);return true;
  });
});

test('file chooser times out after five minutes without exposing the underlying reason',async t=>{
  let opened=false;
  t.mock.method(AbortSignal,'timeout',(milliseconds:number)=>{
    assert.equal(milliseconds,300000);
    return AbortSignal.abort(new DOMException('private timeout details','TimeoutError'));
  });
  await assert.rejects(pickFile(undefined,'en',undefined,'win32',async()=>{opened=true;return null;}),error=>{
    assert.match(String(error),/FILE_PICKER_TIMEOUT/);
    assert.doesNotMatch(String(error),/private timeout/);return true;
  });
  assert.equal(opened,false);
});

test('admin forwards the current file, locale and cancellation and always returns a path envelope',async()=>{
  const controller=new AbortController(),current='C:\\Workflows\\current.json';let calls=0,saves=0;
  const admin=new Admin({} as any,{} as any,'fixture',undefined,undefined,{saveSettings:async()=>{saves++;}} as any,undefined,async(initial,locale,signal)=>{
    assert.equal(initial,current);assert.equal(locale,'en');assert.equal(signal,controller.signal);
    return calls++===0?current:undefined;
  });
  const request={version:1,kind:'command',name:'service.settings.pick-file',input:{current,locale:'en'}};
  assert.deepEqual(await admin.command(request,controller.signal),{path:current});
  const cancelled=await admin.command(request,controller.signal);
  assert.deepEqual(cancelled,{path:undefined});assert.equal(JSON.stringify(cancelled),'{}');
  assert.equal(calls,2);assert.equal(saves,0);
});

test('admin file chooser failures propagate without saving settings',async()=>{
  let saves=0;
  const failure=Error('FILE_PICKER_FAILED');
  const admin=new Admin({} as any,{} as any,'fixture',undefined,undefined,{saveSettings:async()=>{saves++;}} as any,undefined,async()=>{throw failure;});
  await assert.rejects(admin.command({version:1,kind:'command',name:'service.settings.pick-file',input:{}}),error=>error===failure);
  assert.equal(saves,0);
});

test('Windows file chooser sends its kind and current path as data to the cancellable PowerShell 7 STA runner',async()=>{
  const signal=new AbortController().signal,initial='C:\\中文 workflows\\$(literal).json';let calls=0;
  const selected=await pickWindowsFile(initial,'zh',signal,async(command,args,request,options)=>{
    calls++;assert.equal(path.win32.basename(command),'pwsh.exe');assert.ok(args.includes('-STA'));
    assert.equal(args.some(value=>value.includes(initial)),false);
    assert.deepEqual(request,{kind:'file',initial,title:'选择工作流文件'});assert.equal(options.signal,signal);assert.equal(options.maxOutputBytes,64*1024);
    return{path:initial};
  });
  assert.equal(selected,initial);assert.equal(calls,1);
  assert.equal(await pickWindowsFile(undefined,'en',signal,async(_command,_args,request)=>{
    assert.deepEqual(request,{kind:'file',initial:undefined,title:'Choose workflow file'});return{path:null};
  }),null);
});

test('Windows file runner cannot open or return a selection after cancellation',async()=>{
  const controller=new AbortController();let calls=0;
  const run=async()=>{calls++;controller.abort();return{path:'C:\\late.json'};};
  await assert.rejects(pickWindowsFile(undefined,'en',controller.signal,run),{name:'AbortError'});
  await assert.rejects(pickWindowsFile(undefined,'en',controller.signal,run),{name:'AbortError'});
  assert.equal(calls,1);
});

test('non-Windows file selection reports unsupported without invoking a chooser',async()=>{
  let opened=false;
  await assert.rejects(pickFile(undefined,'en',undefined,'linux',async()=>{opened=true;return null;}),/不支持|not supported/);
  assert.equal(opened,false);
});
