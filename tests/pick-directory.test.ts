import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {pickDirectory,type DirectoryPickerCommand} from '../src/harness/pick-directory.js';

async function fixture(t:any){
  const directory=await mkdtemp(path.resolve('.codex/pick-directory-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return directory;
}

test('Windows model directory picker returns the selected real directory and preserves initial path',async t=>{
  const directory=await fixture(t),expected=await realpath(directory);let calls=0;
  const run:DirectoryPickerCommand=async(command,args,options)=>{
    calls++;
    assert.equal(path.win32.basename(command),'powershell.exe');
    assert.ok(args.includes('-STA'));
    const script=Buffer.from(args[args.indexOf('-EncodedCommand')+1],'base64').toString('utf16le');
    assert.match(script,/FolderBrowserDialog/);
    assert.match(script,/ShowNewFolderButton=\$false/);
    assert.equal(options.env?.BOT_PICK_DIRECTORY_INITIAL,expected);
    assert.equal(options.windowsHide,true);
    return{stdout:JSON.stringify({path:expected})};
  };
  assert.equal(await pickDirectory(expected,run,'win32'),expected);assert.equal(calls,1);
});

test('cancelling the model directory picker leaves the draft unchanged',async()=>{
  const run:DirectoryPickerCommand=async()=>({stdout:JSON.stringify({path:null})});
  assert.equal(await pickDirectory(undefined,run,'win32'),undefined);
});

test('the native picker uses the requesting UI language independently of global bot language',async()=>{
  const run:DirectoryPickerCommand=async(_command,_args,options)=>{
    assert.equal(options.env?.BOT_PICK_DIRECTORY_TITLE,'Choose model directory');
    return{stdout:JSON.stringify({path:null})};
  };
  assert.equal(await pickDirectory(undefined,run,'win32','en'),undefined);
});

test('model directory picker rejects malformed or inaccessible selections',async t=>{
  const directory=await fixture(t);
  await assert.rejects(pickDirectory(undefined,async()=>({stdout:'not-json'}),'win32'),/无效结果/);
  await assert.rejects(pickDirectory(undefined,async()=>({stdout:JSON.stringify({path:path.join(directory,'missing')})}),'win32'),/不存在或无法访问/);
});
