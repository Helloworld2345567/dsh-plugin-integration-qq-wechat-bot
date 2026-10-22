import {mkdir,writeFile,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {archivePackage,identity,atomicJson} from './installation.mjs';

const root=process.cwd();const folder=path.join(root,'.codex',`lifecycle-native-${Date.now()}`);const home=path.join(folder,'home');const profile=path.join(home,'profiles','bots');await mkdir(profile,{recursive:true});
await build({entryPoints:['src/lifecycle/index.ts'],outfile:'packages/bot-lifecycle/dist/index.js',bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
const make=async(name,broken=false)=>{
  const source=path.join(folder,name);await mkdir(path.join(source,'dist'),{recursive:true});
  await atomicJson(path.join(source,'package.json'),{name:'dsh-plugin-integration-qq-wechat-bot',version:`0.0.${name==='old'?1:name==='next'?2:3}`,type:'module',exports:'./dist/index.js',files:['dist/*.js','cordis.patch.yml'],dsh:{bundle:{patch:'./cordis.patch.yml'}}});
  await writeFile(path.join(source,'cordis.patch.yml'),'- insert:\n    - id: bot-integration\n      name: dsh-plugin-integration-qq-wechat-bot\n');
  await writeFile(path.join(source,'dist/client.js'),'// fixture');
  await writeFile(path.join(source,'dist/index.js'),broken?`throw Error('INJECTED_ACTIVATION_FAILURE');`:`import {fileURLToPath} from 'node:url';import path from 'node:path';import {appendFileSync} from 'node:fs';
export const name='bot-integration';export function apply(ctx){const key=Symbol.for('sakura.lifecycle.runtime');const trace=value=>appendFileSync(path.join(process.env.LIFECYCLE_NATIVE_FOLDER,'trace.txt'),'${name}:'+value+'\\n');const runtime={packageRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),quiesce:async()=>trace('drain'),resumeProcessing:()=>trace('resume'),health:()=>({ready:true})};globalThis[key]=runtime;trace('ready');ctx.effect(()=>()=>{trace('dispose');if(globalThis[key]===runtime)delete globalThis[key];});}`);
  return{source,artifact:{...await archivePackage(source,home),identity:await identity(source)}};
};
const old=await make('old'),next=await make('next'),broken=await make('broken',true);const observer=path.join(folder,'observer');await mkdir(observer,{recursive:true});
await build({entryPoints:['tests/lifecycle-native-plugin.ts'],outfile:path.join(observer,'index.js'),bundle:true,platform:'node',format:'esm',target:'node24',packages:'external'});
await atomicJson(path.join(observer,'package.json'),{name:'dsh-lifecycle-native-fixture',version:'0.0.0',type:'module',exports:'./index.js',dsh:{bundle:{patch:'./cordis.patch.yml'}}});
await writeFile(path.join(observer,'cordis.patch.yml'),'- insert:\n    - id: bot-lifecycle-native-fixture\n      name: dsh-lifecycle-native-fixture\n');
await atomicJson(path.join(profile,'package.json'),{name:'lifecycle-native-profile',private:true,type:'module',dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}});
await writeFile(path.join(profile,'cordis.patch.yml'),'- id: skill-filesystem\n  disabled: true\n- id: session-log-deepseek\n  disabled: true\n');
await atomicJson(path.join(home,'installation.json'),{schemaVersion:1,sourceRoot:old.source,projectRoot:old.source,sourceDigest:'native-fixture',installedFrom:old.artifact.path,current:old.artifact,updatedAt:Date.now()});
await atomicJson(path.join(home,'evolution','native-upgrade.json'),{id:'native-upgrade',kind:'upgrade',scopeKey:'fixture',configId:'fixture',goal:'Real isolated native upgrade',phase:'queued',createdAt:Date.now(),updatedAt:Date.now(),artifact:next.artifact,previous:old.artifact,events:[]});
await atomicJson(path.join(folder,'fixture.json'),{home,old:old.artifact,next:next.artifact,broken:broken.artifact});
const env={};for(const [key,value] of Object.entries(process.env))if(/^(?:PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROCESSOR_ARCHITECTURE)$/i.test(key))env[key]=value;
Object.assign(env,{BOT_HOME:home,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),BOT_DATA_HOME:path.join(home,'storages','bot-integration'),BOT_WORKSPACE_ROOT:path.join(folder,'workspaces'),LIFECYCLE_NATIVE_FOLDER:folder,npm_config_userconfig:path.join(home,'empty.npmrc')});await writeFile(env.npm_config_userconfig,'');
const cli=path.join(path.dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')),'lib','bin.js');
const run=args=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,...args],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(logs)));});
await run(['plugin','--profile','bots','add',path.join(root,'packages','bot-lifecycle')]);await run(['plugin','--profile','bots','add',old.artifact.path]);await run(['plugin','--profile','bots','add',observer]);
const manifest=JSON.parse(await readFile(path.join(profile,'package.json'),'utf8'));manifest.dsh.profile.bundles=[...new Set([...manifest.dsh.profile.bundles,'dsh-bot-lifecycle','dsh-plugin-integration-qq-wechat-bot','dsh-lifecycle-native-fixture'])];await atomicJson(path.join(profile,'package.json'),manifest);
const host=spawn(process.execPath,['scripts/start.mjs','--port','0'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';host.stdout.on('data',data=>logs+=data);host.stderr.on('data',data=>logs+=data);let result;
try{
  const deadline=Date.now()+180000;while(Date.now()<deadline){try{result=JSON.parse(await readFile(path.join(folder,'result.json'),'utf8'));break;}catch{}if(host.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,250));}
  await writeFile(path.join(folder,'host.log'),logs);if(!result)throw Error(`Native lifecycle test did not finish; evidence: ${folder}`);console.log(JSON.stringify({...result,evidence:folder},null,2));if(result.status!=='PASS')process.exitCode=1;
}finally{
  try{const state=JSON.parse(await readFile(path.join(home,'launcher.json'),'utf8'));await fetch(`http://127.0.0.1:${state.port}/stop`,{method:'POST',headers:{authorization:`Bearer ${state.token}`}});}catch{}
  if(host.exitCode===null){await Promise.race([new Promise(resolve=>host.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,20000))]);if(host.exitCode===null){if(process.platform==='win32')spawn('taskkill',['/PID',String(host.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else host.kill('SIGTERM');}}
}
