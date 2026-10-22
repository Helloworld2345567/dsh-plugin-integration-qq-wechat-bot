import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,copyFile,stat,realpath} from 'node:fs/promises';
import {existsSync,globSync,lstatSync,readdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import path from 'node:path';

export const bundleName='dsh-plugin-integration-qq-wechat-bot';
export const hashFile=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
export async function identity(root){
  const manifest=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));const included=new Set(['package.json']);
  const add=relative=>{const normalized=relative.replaceAll('\\','/');if(normalized.split('/').some(part=>/^(?:node_modules|\.git|\.codex|__pycache__)$/.test(part))||/\.pyc$/.test(normalized))return;const info=lstatSync(path.join(root,relative));if(info.isSymbolicLink())throw Error('Shipped package files must not be symlinks');if(info.isDirectory())for(const name of readdirSync(path.join(root,relative)))add(path.join(relative,name));else if(info.isFile())included.add(normalized);};
  for(const pattern of manifest.files??['cordis.patch.yml','dist/*.js'])for(const entry of globSync(pattern,{cwd:root}))add(entry);
  const hash=createHash('sha256');for(const file of [...included].sort())hash.update(file).update('\0').update(await readFile(path.join(root,file))).update('\0');return hash.digest('hex');
}
export async function atomicJson(file,value){await mkdir(path.dirname(file),{recursive:true});const temporary=`${file}.${randomUUID()}.tmp`;await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600,flush:true});await rename(temporary,file);}
export async function archivePackage(source,home){
  const folder=path.join(home,'package-archives',randomUUID());await mkdir(folder,{recursive:true});let archive;
  if((await stat(source)).isDirectory()){
    const npm=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].find(p=>p&&path.basename(p)==='npm-cli.js'&&existsSync(p));
    if(!npm)throw Error('Cannot locate npm CLI beside Node');
    const output=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[npm,'pack','--json','--ignore-scripts','--pack-destination',folder],{cwd:source,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('exit',code=>code===0?resolve(stdout):reject(Error(stderr)));});
    const [packed]=JSON.parse(output);if(path.basename(packed.filename)!==packed.filename)throw Error('Unexpected npm pack filename');archive=path.join(folder,packed.filename);
  }else{if(!/\.tgz$/i.test(source))throw Error('Installation source must be a package directory or .tgz');archive=path.join(folder,path.basename(source));await copyFile(source,archive);}
  return{path:archive,sha256:await hashFile(archive)};
}
export async function recordInstallation({home,sourceRoot,installedFrom,archive,installedRoot}){
  const file=path.join(home,'installation.json');let previous;try{previous=JSON.parse(await readFile(file,'utf8')).current;}catch(error){if(error.code!=='ENOENT')throw error;}
  const root=await realpath(sourceRoot);const installedIdentity=await identity(installedRoot);
  if(existsSync(path.join(root,'src/index.ts'))&&await identity(root)!==installedIdentity)throw Error('Source release files differ from the installed archive; rebuild and install that source, or set BOT_SOURCE_ROOT to its exact checkout');
  const baseline={};const roots=new Set(['src','python','skills','tests','scripts','docs','examples','packages']);const files=new Set(['package.json','package-lock.json','tsconfig.json','requirements.txt','cordis.patch.yml','README.md','AGENTS.md','LICENSE','THIRD_PARTY_NOTICES.md','.gitignore','.gitattributes']);
  const walk=async(relative='')=>{for(const name of readdirSync(path.join(root,relative)).sort()){
    if(/^(?:node_modules|dist|\.codex|\.git|\.runtime|\.venv|__pycache__|coverage|data|artifacts)$/i.test(name)||/^\.env(?:\.|$)/.test(name)||/\.(?:sqlite|db|log|tgz|pyc)(?:-|$)/i.test(name))continue;
    if(!relative&&!roots.has(name)&&!files.has(name))continue;const rel=relative?`${relative}/${name}`:name;const info=lstatSync(path.join(root,rel));if(info.isSymbolicLink())throw Error('Source snapshot contains a symlink');if(info.isDirectory())await walk(rel);else if(info.isFile())baseline[rel]=await hashFile(path.join(root,rel));
  }};await walk();const sourceDigest=createHash('sha256').update(JSON.stringify(Object.entries(baseline).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
  await atomicJson(file,{schemaVersion:1,sourceRoot:root,projectRoot:root,sourceDigest,installedFrom,current:{...archive,identity:installedIdentity},previous,updatedAt:Date.now()});
}

/** Called only by the owning launcher after its child exited. No active profile is modified. */
export async function recoverFailedUpgrade(home,taskId,install){
  if(!/^[a-z0-9-]{1,80}$/i.test(taskId))throw Error('Invalid lifecycle task ID');
  const file=path.join(home,'evolution',`${taskId}.json`);const task=JSON.parse(await readFile(file,'utf8'));
  if(task.phase!=='restarting'||task.kind==='restart'||task.rollbackAttempted||!task.previous){task.phase='failed';task.error='Startup failed; no automatic package rollback is available';task.events.push({at:Date.now(),phase:task.phase,message:task.error});await atomicJson(file,task);throw Error(task.error);}
  if(await hashFile(task.previous.path)!==task.previous.sha256)throw Error('Previous archive hash mismatch');
  task.rollbackAttempted=true;task.phase='rolling-back';task.error='Supervised process failed before healthy activation';task.events.push({at:Date.now(),phase:task.phase,message:task.error});await atomicJson(file,task);
  await install(task.previous.path);
  task.phase='restarting';task.events.push({at:Date.now(),phase:task.phase,message:'Previous package installed offline; restart once'});await atomicJson(file,task);
}
