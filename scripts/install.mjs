import { mkdir, readFile, writeFile, access,stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { productHome,run,workspaceRoot,runtimeEnv } from './runtime.mjs';
import {configureWorkspaceStorage} from './workspace-storage.mjs';
import YAML from 'yaml';
import {archivePackage,recordInstallation,bundleName} from './installation.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await mkdir(productHome,{recursive:true});
try{await writeFile(path.join(productHome,'workspace.json'),JSON.stringify({root:workspaceRoot},null,2)+'\n',{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
await mkdir(workspaceRoot,{recursive:true});
const command=(file,args,options={})=>new Promise((resolve,reject)=>{const child=spawn(file,args,{stdio:'inherit',windowsHide:true,...options});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${file} exited ${code}`)));});
const mediaEnv=path.join(productHome,'media-venv');
const python=process.env.BOT_PYTHON||path.join(mediaEnv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
if(!process.env.BOT_PYTHON){
  try{await access(python);}catch{try{await command('uv',['venv','--python','3.12',mediaEnv]);}catch(error){if(error.code!=='ENOENT')throw error;await command(process.platform==='win32'?'python':'python3',['-m','venv',mediaEnv]);}}
}
try{await command('uv',['pip','install','--python',python,'-r',path.join(root,'requirements.txt')]);}catch(error){if(error.code!=='ENOENT')throw error;await command(python,['-m','pip','install','-r',path.join(root,'requirements.txt')]);}
const profile=path.join(productHome,'profiles','bots');await mkdir(profile,{recursive:true});await mkdir(path.join(productHome,'agents'),{recursive:true});
const manifest=path.join(profile,'package.json');
let profilePackage;
try{profilePackage=JSON.parse(await readFile(manifest,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;profilePackage={name:'dsh-profile-bots',version:'1.0.0',private:true,type:'module'};}
profilePackage.dependencies??={};profilePackage.dsh??={};profilePackage.dsh.profile??={};
const requiredBundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app'];
for(const bundle of requiredBundles){const existing=profilePackage.dependencies[bundle];if(existing&&existing!=='0.2.1-rc.2')throw new Error(`Profile requires ${bundle}@0.2.1-rc.2; found ${existing}`);profilePackage.dependencies[bundle]='0.2.1-rc.2';}
profilePackage.dsh.profile.bundles=[...new Set([...(profilePackage.dsh.profile.bundles??[]),...requiredBundles])];
await writeFile(manifest,JSON.stringify(profilePackage,null,2)+'\n');
const workspaceFile=path.join(profile,'pnpm-workspace.yaml');let workspace={};try{workspace=YAML.parse(await readFile(workspaceFile,'utf8'))||{};}catch(error){if(error.code!=='ENOENT')throw error;}
workspace.allowBuilds??={};
// Fixed native/runtime dependencies of the pinned Harness. Never approve arbitrary plugin scripts.
for(const id of ['@deepseek-ai/dsh-subprocess-local@0.2.1-rc.2','@google/genai@2.21.0','koffi@3.1.1','node-pty@1.2.0-beta.15','protobufjs@7.6.6'])if(!(id in workspace.allowBuilds))workspace.allowBuilds[id]=true;
await writeFile(workspaceFile,YAML.stringify(workspace));
const patch=path.join(profile,'cordis.patch.yml');
try{await access(patch);}catch{await writeFile(patch,`# Product-owned initial composition. Upgrades never replace this document.
- id: skill-filesystem
  disabled: true
- id: session-log-deepseek
  disabled: true
`);}
const patchEntries=YAML.parse(await readFile(patch,'utf8'))??[];
await configureWorkspaceStorage(productHome,workspaceRoot,patchEntries);
await writeFile(patch,YAML.stringify(patchEntries));
await mkdir(runtimeEnv.TEMP,{recursive:true});
// pnpm requires a reinstall when an existing profile changes its store location.
let oldStore;try{oldStore=YAML.parse(await readFile(path.join(profile,'node_modules','.modules.yaml'),'utf8')).storeDir;}catch(error){if(error.code!=='ENOENT')throw error;}
if(oldStore){const relative=path.relative(runtimeEnv.npm_config_store_dir,oldStore);if(relative.startsWith('..')||path.isAbsolute(relative))await command(process.platform==='win32'?'pnpm.cmd':'pnpm',['install','--force','--frozen-lockfile'],{cwd:profile,env:{...runtimeEnv,CI:'1'},shell:process.platform==='win32'});}
const source=path.resolve(process.argv[2]||root);await access(source);
const archive=await archivePackage(source,productHome);
const lifecycleArchive=await archivePackage(path.join(root,'packages','bot-lifecycle'),productHome);
await run(['plugin','--profile','bots','add',lifecycleArchive.path]);
await run(['plugin','--profile','bots','add',archive.path]);
// Native discovery does not always add a local tarball's bundle to the ordered profile.
const installedProfile=JSON.parse(await readFile(manifest,'utf8'));
installedProfile.dsh??={};installedProfile.dsh.profile??={};
installedProfile.dsh.profile.bundles=[...new Set([...(installedProfile.dsh.profile.bundles??[]),'dsh-bot-lifecycle',bundleName])];
await writeFile(manifest,JSON.stringify(installedProfile,null,2)+'\n');
await recordInstallation({home:productHome,sourceRoot:path.resolve(process.env.BOT_SOURCE_ROOT||((await stat(source)).isDirectory()?source:root)),installedFrom:source,archive,installedRoot:path.join(profile,'node_modules',bundleName)});
console.log(`Installed. Runtime home: ${productHome}. Start with node scripts/start.mjs`);
