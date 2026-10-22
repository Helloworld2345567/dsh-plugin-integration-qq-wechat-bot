// Real packaged product + trusted installer + supervisor, in an empty disposable home.
// No bot is created, no platform is connected, and no provider credential is inherited.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {atomicJson,identity,bundleName} from './installation.mjs';

const root=process.cwd();const folder=path.join(root,'.codex',`install-smoke-${Date.now()}`);const home=path.join(folder,'home');await mkdir(home,{recursive:true});
const python=process.env.BOT_TEST_PYTHON||path.join(root,'.codex','venvs','media',process.platform==='win32'?'Scripts/python.exe':'bin/python');await access(python);
const env={};for(const [key,value] of Object.entries(process.env))if(/^(?:PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROCESSOR_ARCHITECTURE)$/i.test(key))env[key]=value;
Object.assign(env,{BOT_HOME:home,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),BOT_DATA_HOME:path.join(home,'storages','bot-integration'),BOT_WORKSPACE_ROOT:path.join(folder,'workspaces'),BOT_SOURCE_ROOT:root,BOT_PYTHON:python,npm_config_userconfig:path.join(home,'empty.npmrc')});await writeFile(env.npm_config_userconfig,'');
const run=(script,args=[],timeoutMs=300000)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[script,...args],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';
  child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);child.on('error',reject);
  const timer=setTimeout(()=>{child.kill();reject(Error(`${script} timed out`));},timeoutMs);timer.unref();
  child.on('close',async code=>{clearTimeout(timer);await writeFile(path.join(folder,`${path.basename(script,'.mjs')}.log`),logs);code===0?resolve(logs):reject(Error(`${script} exited ${code}; evidence ${folder}`));});
});
await run('scripts/build.mjs');
const sourceIdentity=await identity(root);
await run('scripts/install.mjs',[root]);
const installation=JSON.parse(await readFile(path.join(home,'installation.json'),'utf8'));
assert.equal(installation.current.identity,sourceIdentity);assert.equal(installation.sourceRoot,root);
const profile=JSON.parse(await readFile(path.join(home,'profiles','bots','package.json'),'utf8'));
assert.ok(profile.dsh.profile.bundles.includes('dsh-bot-lifecycle'));assert.ok(profile.dsh.profile.bundles.includes(bundleName));
assert.equal(await identity(path.join(home,'profiles','bots','node_modules',bundleName)),sourceIdentity);

const database=path.join(env.BOT_DATA_HOME,'bots.sqlite');
const runtimeState=()=>{const db=new DatabaseSync(database,{readOnly:true});try{return{owner:JSON.parse(db.prepare("SELECT json FROM records WHERE kind='runtime' AND id='owner'").get()?.json??'null'),bots:Number(db.prepare("SELECT COUNT(*) AS count FROM records WHERE kind='bot'").get().count)};}finally{db.close();}};
const host=spawn(process.execPath,['scripts/start.mjs','--port','0'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';host.stdout.on('data',data=>logs+=data);host.stderr.on('data',data=>logs+=data);const hostExit=new Promise(resolve=>host.once('exit',(code,signal)=>resolve({code,signal})));
const wait=async(check,timeoutMs=90000)=>{const deadline=Date.now()+timeoutMs;let last;while(Date.now()<deadline){try{const value=await check();if(value)return value;}catch(error){last=error;}if(host.exitCode!==null)throw Error(`Host exited before acceptance: ${host.exitCode}`);await new Promise(resolve=>setTimeout(resolve,100));}throw Error(`Acceptance timeout: ${last??'condition not met'}`);};
const api=async()=>{
  const urls=[...logs.matchAll(/dsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/g)];const url=urls.at(-1)?.[1];if(!url)return;
  // Node fetch does not retain the cookie issued by Harness's launch-token redirect.
  const ticket=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(5000)});const cookie=ticket.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ');
  const page=ticket.status===303?await fetch(new URL(ticket.headers.get('location'),url),{headers:{cookie},signal:AbortSignal.timeout(5000)}):ticket;const html=await page.text();
  const match=html.match(/globalThis\["__BOT_INTEGRATION__"\]\s*=\s*(\{[^<]+\})<\/script>/);if(!match){await writeFile(path.join(folder,'bootstrap-response.html'),html);throw Error(`Bot bootstrap not found in HTTP ${page.status} response`);}
  const bootstrap=JSON.parse(match[1]);const response=await fetch(new URL(bootstrap.endpoint,url),{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${bootstrap.token}`,cookie},body:JSON.stringify({action:'state',input:{}}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error(`Admin health request returned ${response.status}`);return{state:(await response.json()).result,url};
};
let first,second,task,result;
try{
  first=await wait(async()=>{const admin=await api();const current=runtimeState();return admin&&current.owner?{...current,configs:admin.state.configs.length,port:new URL(admin.url).port}:undefined;});assert.equal(first.bots,0);
  task={id:'install-smoke-restart',kind:'restart',scopeKey:'local-smoke',configId:'sakura',goal:'Verify supervised restart of the actual installed root package with zero bots',phase:'queued',createdAt:Date.now(),updatedAt:Date.now(),events:[]};await atomicJson(path.join(home,'evolution',`${task.id}.json`),task);
  second=await wait(async()=>{const journal=JSON.parse(await readFile(path.join(home,'evolution',`${task.id}.json`),'utf8'));if(journal.phase==='failed')throw Error(journal.error);if(journal.phase!=='succeeded')return;const admin=await api();const current=runtimeState();return admin&&current.owner&&current.owner.pid!==first.owner.pid?{...current,configs:admin.state.configs.length,port:new URL(admin.url).port,phase:journal.phase}:undefined;},120000);
  assert.equal(second.bots,0);assert.notEqual(second.owner.pid,first.owner.pid);assert.equal(second.phase,'succeeded');
  result={status:'PASS',packageVersion:JSON.parse(await readFile(path.join(root,'package.json'),'utf8')).version,artifactSha256:installation.current.sha256,shippedIdentity:sourceIdentity,bots:0,initialPid:first.owner.pid,restartedPid:second.owner.pid,restart:second.phase,adminHealthBefore:true,adminHealthAfter:true,sourceRoot:installation.sourceRoot,evidence:folder};
}catch(error){result={status:'FAIL',error:String(error),initial:first,restarted:second,evidence:folder};process.exitCode=1;}
finally{
  await writeFile(path.join(folder,'host.log'),logs);
  try{const state=JSON.parse(await readFile(path.join(home,'launcher.json'),'utf8'));await fetch(`http://127.0.0.1:${state.port}/stop`,{method:'POST',headers:{authorization:`Bearer ${state.token}`},signal:AbortSignal.timeout(5000)});}catch(error){result??={status:'FAIL',evidence:folder};result.stopError=String(error);process.exitCode=1;}
  let stopTimer;const exited=await Promise.race([hostExit,new Promise(resolve=>{stopTimer=setTimeout(()=>resolve(undefined),25000);})]);clearTimeout(stopTimer);
  if(!exited){result.stop='FAIL';process.exitCode=1;if(process.platform==='win32')spawn('taskkill',['/PID',String(host.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else host.kill('SIGTERM');}
  else{result.stop=exited.code===0?'PASS':'FAIL';result.launcherExit=exited;if(exited.code!==0)process.exitCode=1;}
  try{await access(path.join(home,'launcher.json'));result.launcherStateRemoved=false;process.exitCode=1;}catch(error){if(error.code==='ENOENT')result.launcherStateRemoved=true;else throw error;}
  if(first){result.runtimeReleased=runtimeState().owner===null;if(!result.runtimeReleased)process.exitCode=1;}
  if(process.exitCode)result.status='FAIL';await atomicJson(path.join(folder,'result.json'),result);console.log(JSON.stringify(result,null,2));
}
