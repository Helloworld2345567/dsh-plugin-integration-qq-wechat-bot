#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {readFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {bootstrapGithub,sha256File,validateBootstrapInput} from './github-bootstrap.mjs';
import {identity} from './installation.mjs';

const scriptRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function argumentsObject(values){const result={};for(const value of values){const match=/^--([a-z-]+)=(.*)$/.exec(value);if(!match)throw Error('BOOTSTRAP_ARGUMENT_INVALID');const key=({repository:'repository',ref:'ref',asset:'asset',sha256:'sha256',home:'home','source-dir':'sourceDir'}[match[1]]);if(!key||Object.hasOwn(result,key))throw Error('BOOTSTRAP_ARGUMENT_INVALID');result[key]=match[2];}return result;}
const input=validateBootstrapInput(argumentsObject(process.argv.slice(2)));
const cleanEnv=()=>{const env={};for(const [key,value] of Object.entries(process.env))if(/^(?:PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROCESSOR_ARCHITECTURE|BOT_WORKSPACE_ROOT|BOT_PYTHON)$/i.test(key))env[key]=value;return{...env,BOT_HOME:input.home,...input.sourceDir?{BOT_SOURCE_ROOT:input.sourceDir}:{}};};
const install=(archive,options={})=>new Promise((resolve,reject)=>{const layers=(options.layers??['core','basic-media']).join(','),environment=cleanEnv();if(options.rollback)delete environment.BOT_SOURCE_ROOT;const child=spawn(process.execPath,[path.join(scriptRoot,'scripts','install.mjs'),archive,`--layers=${layers}`],{cwd:scriptRoot,env:environment,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('BOOTSTRAP_INSTALL_FAILED')));});
const verifyHealth=async()=>{const installation=JSON.parse(await readFile(path.join(input.home,'installation.json'),'utf8')),current=installation.current;if(!current||await sha256File(current.path)!==current.sha256)throw Error('BOOTSTRAP_INSTALLED_ARCHIVE_INVALID');const installedRoot=await realpath(path.join(input.home,'profiles','bots','node_modules','dsh-plugin-integration-qq-wechat-bot'));if(await identity(installedRoot)!==current.identity)throw Error('BOOTSTRAP_INSTALLED_IDENTITY_INVALID');};
const result=await bootstrapGithub(input,{install,verifyHealth,layers:['core','basic-media']});console.log(JSON.stringify({status:'PASS',state:result.state,sha256:result.sha256,journal:result.journal},null,2));
