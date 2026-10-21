import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
const require=createRequire(import.meta.url);
export const HARNESS_VERSION='0.2.1-rc.2';
export const productHome=path.resolve(process.env.BOT_HOME||path.join(os.homedir(),'.dsh-bots'));
export const runtimeEnv={...process.env,DSH_HOME:productHome,DSH_AGENTS_HOME:path.join(productHome,'agents'),BOT_DATA_HOME:path.join(productHome,'storages','bot-integration'),BOT_PYTHON:process.env.BOT_PYTHON||path.join(productHome,'media-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python')};
export function launcher(args,options={}){
  let cli;
  try{cli=path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')),'lib','bin.js');}catch{}
  if(cli)return spawn(process.execPath,[cli,...args],{env:runtimeEnv,windowsHide:true,...options});
  throw new Error(`Install dependencies first (npm install). Required Harness: ${HARNESS_VERSION}`);
}
export function run(args){return new Promise((resolve,reject)=>{const child=launcher(args,{stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Harness command exited ${code}`)));});}
