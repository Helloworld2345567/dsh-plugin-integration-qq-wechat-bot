import { createRequire } from 'node:module';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {readFileSync,mkdirSync} from 'node:fs';
const require=createRequire(import.meta.url);
export const HARNESS_VERSION='0.2.1-rc.2';
export const productHome=path.resolve(process.env.BOT_HOME||path.join(process.cwd(),'.runtime','bot-data'));
let savedWorkspaceRoot;try{savedWorkspaceRoot=JSON.parse(readFileSync(path.join(productHome,'workspace.json'),'utf8')).root;if(typeof savedWorkspaceRoot!=='string'||!path.isAbsolute(savedWorkspaceRoot))throw new Error('Invalid saved workspace root');}catch(error){if(error.code!=='ENOENT')throw error;}
export const workspaceRoot=path.resolve(process.env.BOT_WORKSPACE_ROOT||savedWorkspaceRoot||path.join(process.cwd(),'.runtime','workspaces'));
export const workspaceRuntime=path.join(workspaceRoot,'.runtime');
const processHome=path.join(workspaceRuntime,'home'),temporary=path.join(workspaceRuntime,'tmp');
for(const directory of [processHome,temporary,path.join(processHome,'appdata'),path.join(processHome,'localappdata')])mkdirSync(directory,{recursive:true});
export const runtimeEnv={...process.env,HOME:processHome,USERPROFILE:processHome,APPDATA:path.join(processHome,'appdata'),LOCALAPPDATA:path.join(processHome,'localappdata'),TEMP:temporary,TMP:temporary,npm_config_store_dir:path.join(processHome,'localappdata','pnpm','store'),BOT_HOME:productHome,BOT_WORKSPACE_ROOT:workspaceRoot,DSH_HOME:productHome,DSH_AGENTS_HOME:path.join(productHome,'agents'),BOT_PERSONAS_ROOT:path.join(productHome,'personas'),BOT_DATA_HOME:path.join(workspaceRuntime,'storages','bot-integration'),BOT_PYTHON:process.env.BOT_PYTHON||path.join(productHome,'media-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python')};
export function launcher(args,options={}){
  let cli;
  try{cli=path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')),'lib','bin.js');}catch{}
  if(cli)return spawn(process.execPath,[cli,...args],{env:runtimeEnv,windowsHide:true,...options});
  throw new Error(`Install dependencies first (npm install). Required Harness: ${HARNESS_VERSION}`);
}
export function run(args){return new Promise((resolve,reject)=>{const child=launcher(args,{stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Harness command exited ${code}`)));});}
