import {createRequire} from 'node:module';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {readFileSync,mkdirSync} from 'node:fs';

const require=createRequire(import.meta.url);
export const HARNESS_VERSION='0.2.1-rc.5';

function savedWorkspace(home){
  try{
    const value=JSON.parse(readFileSync(path.join(home,'workspace.json'),'utf8')).root;
    if(typeof value!=='string'||!path.isAbsolute(value))throw Error('Invalid saved workspace root');
    return value;
  }catch(error){if(error.code!=='ENOENT')throw error;}
}

/** Resolve paths and environment without creating runtime data. */
export function resolveRuntimeConfig({env=process.env,cwd=process.cwd(),savedRoot}={}){
  const productHome=path.resolve(env.BOT_HOME||path.join(cwd,'.runtime','bot-data'));
  const workspaceRoot=path.resolve(env.BOT_WORKSPACE_ROOT||savedRoot||savedWorkspace(productHome)||path.join(cwd,'.runtime','workspaces'));
  const workspaceRuntime=path.join(workspaceRoot,'.runtime');
  const processHome=path.join(workspaceRuntime,'home'),temporary=path.join(workspaceRuntime,'tmp');
  const runtimeEnv={...env,HOME:processHome,USERPROFILE:processHome,APPDATA:path.join(processHome,'appdata'),LOCALAPPDATA:path.join(processHome,'localappdata'),TEMP:temporary,TMP:temporary,npm_config_store_dir:path.join(processHome,'localappdata','pnpm','store'),BOT_HOME:productHome,BOT_WORKSPACE_ROOT:workspaceRoot,DSH_HOME:productHome,DSH_AGENTS_HOME:path.join(productHome,'agents'),BOT_PERSONAS_ROOT:path.join(productHome,'personas'),BOT_DATA_HOME:path.join(workspaceRuntime,'storages','bot-integration'),BOT_PYTHON:env.BOT_PYTHON||path.join(productHome,'media-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python')};
  return{productHome,workspaceRoot,workspaceRuntime,processHome,temporary,runtimeEnv};
}

const runtime=resolveRuntimeConfig();
export const {productHome,workspaceRoot,workspaceRuntime,runtimeEnv}=runtime;

/** Start/install call this explicitly; importing runtime configuration stays read-only. */
export function prepareRuntimeDirectories(config=runtime){
  for(const directory of [config.processHome,config.temporary,config.runtimeEnv.APPDATA,config.runtimeEnv.LOCALAPPDATA])mkdirSync(directory,{recursive:true});
  // Windows folder dialogs resolve Desktop beneath the redirected profile.
  if(process.platform==='win32')mkdirSync(path.join(config.processHome,'Desktop'),{recursive:true});
  return config;
}

export function launcher(args,options={}){
  let cli;
  try{cli=path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')),'lib','bin.js');}catch{}
  if(cli)return spawn(process.execPath,[cli,...args],{env:runtimeEnv,windowsHide:true,...options});
  throw new Error(`Install dependencies first (npm install). Required Harness: ${HARNESS_VERSION}`);
}
export function run(args){return new Promise((resolve,reject)=>{const child=launcher(args,{stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Harness command exited ${code}`)));});}
