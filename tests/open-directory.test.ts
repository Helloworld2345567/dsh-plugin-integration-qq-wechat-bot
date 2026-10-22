import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {openDirectory,type DirectoryCommand} from '../src/harness/open-directory.js';

async function fixture(t:any){
  const directory=await mkdtemp(path.resolve('.codex/open-directory-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return directory;
}

test('Windows directory opener explicitly shows Explorer and requires a visible matching folder',async t=>{
  const directory=await fixture(t);let calls=0;
  const run:DirectoryCommand=async(command,args,options)=>{
    calls++;
    assert.equal(path.win32.basename(command),'powershell.exe');
    assert.ok(args.includes('-STA'));
    const script=Buffer.from(args[args.indexOf('-EncodedCommand')+1],'base64').toString('utf16le');
    assert.match(script,/-WindowStyle Normal/);
    assert.match(script,/\.Visible/);
    assert.match(script,/\.Document\.Folder\.Self\.Path/);
    assert.equal(options.env?.BOT_OPEN_DIRECTORY,await realpath(directory));
    assert.equal(options.windowsHide,true,'only the console helper is hidden');
    assert.ok(options.timeout&&options.timeout<=15000);
    return{stdout:JSON.stringify({opened:true,directory:options.env?.BOT_OPEN_DIRECTORY})};
  };
  await openDirectory(directory,run,'win32');assert.equal(calls,1);
});

test('directory opener propagates launch failures and never reports unconfirmed or wrong windows as opened',async t=>{
  const directory=await fixture(t);
  await assert.rejects(openDirectory(directory,async()=>{throw Error('Explorer timed out');},'win32'),/Explorer timed out/);
  for(const stdout of ['',JSON.stringify({opened:false}),JSON.stringify({opened:true,directory:directory+'-wrong'})]){
    await assert.rejects(openDirectory(directory,async()=>({stdout}),'win32'),/未确认配置目录窗口/);
  }
});

test('directory opener rejects files and missing directories before invoking any system command',async t=>{
  const directory=await fixture(t);const file=path.join(directory,'file.txt');await writeFile(file,'fixture');let calls=0;
  const run:DirectoryCommand=async()=>{calls++;return{stdout:''};};
  await assert.rejects(openDirectory(file,run),/配置目录不存在/);
  await assert.rejects(openDirectory(path.join(directory,'missing'),run));assert.equal(calls,0);
});

test('other desktop openers wait for command completion and propagate errors',async t=>{
  const directory=await fixture(t);
  for(const [platform,command] of [['darwin','open'],['linux','xdg-open']] as const){
    await openDirectory(directory,async(file,args)=>{assert.equal(file,command);assert.deepEqual(args,[await realpath(directory)]);return{stdout:''};},platform);
    await assert.rejects(openDirectory(directory,async()=>{throw Error('no desktop');},platform),/no desktop/);
  }
});
