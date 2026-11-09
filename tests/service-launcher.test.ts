import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {ExternalServiceLauncher} from '../src/core/service-launcher.js';

test('external launcher starts Breeze with the fixed project script and waits for health',async t=>{
  await mkdir(path.resolve('.codex'),{recursive:true});
  const root=await mkdtemp(path.resolve('.codex/service-launcher-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(path.join(root,'Start-Breeze.ps1'),'');
  const calls:any[]=[];let healthy=false;
  const launcher=new ExternalServiceLauncher(async(serviceId,baseUrl)=>{calls.push(['health',serviceId,baseUrl]);return healthy;},async(file,args,cwd)=>{calls.push(['spawn',file,args,cwd]);healthy=true;return 42;},1,30);
  const result=await launcher.start({serviceId:'breeze-tts',baseUrl:'http://127.0.0.1:8080',projectRoot:root},new AbortController().signal);
  assert.equal(result.state,'ready');assert.equal(result.pid,42);assert.equal(calls[1][0],'spawn');assert.equal(calls[1][3],root);assert.equal(calls[1][2].at(-1),path.join(root,'Start-Breeze.ps1'));
});

test('external launcher does not spawn an already healthy service',async t=>{
  await mkdir(path.resolve('.codex'),{recursive:true});
  const root=await mkdtemp(path.resolve('.codex/service-launcher-running-'));t.after(()=>rm(root,{recursive:true,force:true}));let spawned=false;
  const launcher=new ExternalServiceLauncher(async()=>true,async()=>{spawned=true;return 1;});
  const result=await launcher.start({serviceId:'breeze-tts',baseUrl:'http://127.0.0.1:8080',projectRoot:root},new AbortController().signal);
  assert.equal(result.state,'already-running');assert.equal(spawned,false);
});

test('GPT-SoVITS launcher validates its fixed runtime and config before spawning',async t=>{
  await mkdir(path.resolve('.codex'),{recursive:true});
  const root=await mkdtemp(path.resolve('.codex/service-launcher-gpt-'));t.after(()=>rm(root,{recursive:true,force:true}));const serviceRoot=path.join(root,'GPT-SoVITS'),pythonDirectory=process.platform==='win32'?'Scripts':'bin',python=path.join(root,'.codex','venv',pythonDirectory);await mkdir(path.join(serviceRoot,'GPT_SoVITS','configs'),{recursive:true});await mkdir(python,{recursive:true});
  await Promise.all([writeFile(path.join(python,process.platform==='win32'?'python.exe':'python'),''),writeFile(path.join(serviceRoot,'api_v2.py'),''),writeFile(path.join(serviceRoot,'GPT_SoVITS','configs','tts_local.yaml'),'')]);
  let args:readonly string[]=[];let healthy=false;const launcher=new ExternalServiceLauncher(async()=>healthy,async(_file,value)=>{args=value;healthy=true;return 9;},1,30);
  const result=await launcher.start({serviceId:'gpt-sovits',baseUrl:'http://127.0.0.1:9880',projectRoot:root},new AbortController().signal);
  assert.equal(result.state,'ready');assert.deepEqual(args,['-B','api_v2.py','-a','127.0.0.1','-p','9880','-c','GPT_SoVITS/configs/tts_local.yaml']);
});

test('external launcher bounds a health probe that ignores cancellation',async t=>{
  await mkdir(path.resolve('.codex'),{recursive:true});
  const root=await mkdtemp(path.resolve('.codex/service-launcher-health-timeout-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(path.join(root,'Start-Breeze.ps1'),'');
  const launcher=new ExternalServiceLauncher(async()=>new Promise<boolean>(()=>{}),async()=>42,1,30,5);
  await assert.rejects(launcher.start({serviceId:'breeze-tts',baseUrl:'http://127.0.0.1:8080',projectRoot:root},new AbortController().signal),/SERVICE_START_TIMEOUT/);
});

test('external launcher propagates cancellation while probing health',async t=>{
  await mkdir(path.resolve('.codex'),{recursive:true});
  const root=await mkdtemp(path.resolve('.codex/service-launcher-health-abort-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(path.join(root,'Start-Breeze.ps1'),'');
  const controller=new AbortController();const launcher=new ExternalServiceLauncher(async()=>new Promise<boolean>(()=>{}),async()=>42,1,30_000,30_000);
  const pending=launcher.start({serviceId:'breeze-tts',baseUrl:'http://127.0.0.1:8080',projectRoot:root},controller.signal);setTimeout(()=>controller.abort(new Error('cancelled')),5);
  await assert.rejects(pending,/cancelled/);
});
