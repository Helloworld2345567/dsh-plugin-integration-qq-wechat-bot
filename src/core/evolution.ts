import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,copyFileSync,realpathSync,writeFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import type {Store} from './store.js';
import {LifecycleJournal,defaultProductHome,readInstallation,packageIdentity,sha256,verifyArtifact,type EvolutionTask,type Artifact} from './evolution-contract.js';
import type {EvolutionJournalPort,LifecyclePort} from './runtime-ports.js';
import {sourceFiles,sourceDigest} from './source-integrity.js';
export {sourceFiles,sourceDigest} from './source-integrity.js';

const protectedFile=(file:string)=>/^(?:scripts\/|src\/lifecycle\/|packages\/bot-lifecycle\/|tests\/(?:native-plugin|lifecycle-native-plugin|evolution\.test|lifecycle\.test)\.ts$|package(?:-lock)?\.json$|tsconfig\.json$|requirements\.txt$|cordis\.patch\.yml$)/.test(file);
export function cleanValidationEnv(home:string):NodeJS.ProcessEnv{
  const env:NodeJS.ProcessEnv={};for(const [key,value] of Object.entries(process.env))if(/^(?:PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROCESSOR_ARCHITECTURE)$/i.test(key))env[key]=value;
  return{...env,HOME:home,USERPROFILE:home,APPDATA:path.join(home,'appdata'),LOCALAPPDATA:path.join(home,'localappdata'),BOT_HOME:home,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),BOT_DATA_HOME:path.join(home,'storages','bot-integration'),BOT_WORKSPACE_ROOT:path.join(home,'workspaces'),CI:'1',npm_config_userconfig:path.join(home,'empty.npmrc'),npm_config_audit:'false',npm_config_fund:'false'};
}
export interface ValidationCommand {name:string;file:string;args:string[]}
export interface EvolutionOptions {productHome?:string;run?:(command:ValidationCommand,cwd:string,env:NodeJS.ProcessEnv,signal?:AbortSignal)=>Promise<string>;available?:()=>boolean;lifecycle?:LifecyclePort}
function npmCli():string{
  const candidates=[process.env.npm_execpath,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
  const found=candidates.find(p=>p&&path.basename(p)==='npm-cli.js'&&existsSync(p));if(!found)throw Error('npm CLI not found beside Node; launch via npm or install npm for this Node runtime');return found;
}
async function run(command:ValidationCommand,cwd:string,env:NodeJS.ProcessEnv,signal?:AbortSignal):Promise<string>{
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    const child=spawn(command.file,command.args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
    const capture=(data:Buffer)=>{output=(output+String(data)).slice(-2*1024*1024);};child.stdout.on('data',capture);child.stderr.on('data',capture);
    const terminate=()=>{if(process.platform==='win32'&&child.pid)spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGTERM');};
    let failure:unknown;
    const abort=()=>{failure=signal?.reason??Error('Validation cancelled');terminate();};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timeout=setTimeout(()=>{failure=Error(`${command.name}: timeout\n${output}`);terminate();},15*60*1000);timeout.unref();
    const clear=()=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);};
    child.once('error',error=>{clear();reject(error);});child.once('close',code=>{clear();if(failure)reject(failure);else if(code===0)resolve(output);else reject(Error(`${command.name}: exit ${code}\n${output}`));});
  });
}
export class EvolutionService {
  readonly journal:EvolutionJournalPort;readonly productHome:string;
  private validating=new Set<string>();
  constructor(readonly store:Pick<Store,'home'|'saveEvolutionTask'>,readonly installedPackageRoot:string,readonly options:EvolutionOptions={}){
    this.productHome=options.productHome??defaultProductHome(store.home);this.journal=options.lifecycle?.journal?.(this.productHome)??new LifecycleJournal(this.productHome);
    for(const task of this.journal.list())if(task.phase==='validating'){
      let alive=false;if(task.validationPid)try{process.kill(task.validationPid,0);alive=true;}catch{}
      if(!alive){task.error='Validation interrupted before a complete verdict; rerun validation';this.journal.phase(task,'failed',task.error);}
    }
  }
  private available():void{
    const available=this.options.lifecycle?.available??this.options.available??(()=>false);
    if(!available())throw Error('Independent lifecycle coordinator is unavailable or protocol-incompatible; reinstall with scripts/install.mjs and start with scripts/start.mjs');
    if(this.options.lifecycle){
      const handshake=this.options.lifecycle.handshake();
      if(!handshake||handshake.protocol!=='dsh.lifecycle'||handshake.version!==1||!handshake.capabilities.includes('runtime.quiesce')||!handshake.capabilities.includes('runtime.health')||!handshake.capabilities.includes('runtime.resume'))throw Error('LIFECYCLE_HANDSHAKE_UNAVAILABLE');
    }
  }
  history():EvolutionTask[]{return this.journal.list();}
  inspect(id:string):EvolutionTask{const task=this.journal.read(id);if(task.candidateRoot&&task.baseline){const current=sourceFiles(task.candidateRoot);task.changes=[...new Set([...Object.keys(task.baseline),...Object.keys(current)])].filter(file=>task.baseline![file]!==current[file]).map(file=>({file,change:!task.baseline![file]?'added':!current[file]?'deleted':'modified'}));}return task;}
  private save(task:EvolutionTask):EvolutionTask{this.store.saveEvolutionTask(task.id,task);return this.journal.write(task);}
  create(scopeKey:string,configId:string,goal:string):EvolutionTask{
    this.available();if(!goal.trim()||goal.length>20000)throw Error('Evolution goal must be 1–20000 characters');
    const installation=readInstallation(this.productHome);const sourceRoot=realpathSync(installation.sourceRoot);const projectRoot=realpathSync(installation.projectRoot??sourceRoot);
    if(packageIdentity(this.installedPackageRoot)!==installation.current.identity)throw Error('Loaded package differs from trusted installation metadata');
    if(!existsSync(path.join(sourceRoot,'src/index.ts')))throw Error('Installation source checkout is unavailable');
    const id=randomUUID();const candidateRoot=path.join(projectRoot,'.codex','evolution',id,'candidate');
    for(const relative of ['.codex','.codex/evolution']){const parent=path.join(projectRoot,relative);if(existsSync(parent)&&(lstatSync(parent).isSymbolicLink()||!lstatSync(parent).isDirectory()))throw Error('Evolution parent must be a normal project-local directory');}
    mkdirSync(candidateRoot,{recursive:true});if(realpathSync(candidateRoot)!==candidateRoot)throw Error('Evolution candidate escaped source project');
    const baseline=sourceFiles(sourceRoot);
    for(const file of Object.keys(baseline)){const target=path.join(candidateRoot,file);mkdirSync(path.dirname(target),{recursive:true});copyFileSync(path.join(sourceRoot,file),target);}
    if(sourceDigest(sourceFiles(sourceRoot))!==sourceDigest(baseline))throw Error('Source changed while creating candidate; retry');
    const task:EvolutionTask={id,kind:'upgrade',scopeKey,configId,goal:goal.trim(),phase:'draft',createdAt:Date.now(),updatedAt:Date.now(),candidateRoot,sourceRoot,projectRoot,baseline,protectedFiles:Object.fromEntries(Object.entries(baseline).filter(([file])=>protectedFile(file))),sourceDigest:sourceDigest(baseline),previous:installation.current,events:[]};
    return this.save(task);
  }
  private assertCandidate(task:EvolutionTask):Record<string,string>{
    if(!task.candidateRoot||!task.sourceRoot||!task.baseline)throw Error('Task has no source candidate');
    const expected=path.join(realpathSync(task.projectRoot??task.sourceRoot),'.codex','evolution',task.id,'candidate');
    if(realpathSync(task.candidateRoot)!==expected)throw Error('Candidate path is not owned by this task');
    const current=sourceFiles(task.candidateRoot);
    for(const file of new Set([...Object.keys(task.protectedFiles??{}),...Object.keys(current).filter(protectedFile)]))if(current[file]!==task.protectedFiles?.[file])throw Error(`Protected lifecycle/validation file changed: ${file}`);
    return current;
  }
  async validate(id:string,signal?:AbortSignal):Promise<EvolutionTask>{
    const task=this.journal.read(id);if(!['draft','validated','failed'].includes(task.phase)||this.validating.has(id))throw Error('Task cannot be validated in its current phase');
    this.assertCandidate(task);this.validating.add(id);task.validation=[];task.validationPid=process.pid;this.journal.phase(task,'validating','Validating isolated candidate with no live credentials');
    try{
      const cwd=task.candidateRoot!;const logRoot=path.join(path.dirname(cwd),'validation');mkdirSync(logRoot,{recursive:true});
      const env=cleanValidationEnv(path.join(logRoot,'home'));mkdirSync(env.BOT_HOME!,{recursive:true});writeFileSync(env.npm_config_userconfig!,'');const npm=npmCli();
      const commands:ValidationCommand[]=[{name:'dependencies',file:process.execPath,args:[npm,'ci','--ignore-scripts']},...['typecheck','test','test:python','build','check:release','test:native','test:lifecycle-native'].map(name=>({name,file:process.execPath,args:[npm,'run',name]}))];
      // Python uses the established shared interpreter, but receives the isolated environment.
      const python=path.join(this.productHome,'media-venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
      if(existsSync(python)){env.BOT_PYTHON=python;env.PATH=path.dirname(python)+path.delimiter+(env.PATH??env.Path??'');}
      const before=sourceDigest(this.assertCandidate(task));
      for(const command of commands){
        const log=path.join(logRoot,`${command.name.replaceAll(':','-')}.log`);
        try{signal?.throwIfAborted();writeFileSync(log,await(this.options.run??run)(command,cwd,env,signal));task.validation.push({name:command.name,status:'PASS',log});}
        catch(error){writeFileSync(log,String(error));task.validation.push({name:command.name,status:'FAIL',log});throw error;}
        this.journal.write(task);
      }
      if(before!==sourceDigest(this.assertCandidate(task)))throw Error('Candidate source changed during validation');
      signal?.throwIfAborted();const output=await(this.options.run??run)({name:'pack',file:process.execPath,args:[npm,'pack','--ignore-scripts','--json','--pack-destination',path.dirname(cwd)]},cwd,env,signal);
      const packed=JSON.parse(output);if(!Array.isArray(packed)||packed.length!==1||path.basename(packed[0].filename)!==packed[0].filename)throw Error('Invalid npm pack result');
      const archive=path.join(path.dirname(cwd),packed[0].filename);task.artifact={path:archive,sha256:sha256(archive),identity:packageIdentity(cwd)};
      task.validatedDigest=before;if(before!==sourceDigest(this.assertCandidate(task)))throw Error('Candidate changed while packing');
      task.error=undefined;return this.journal.phase(task,'validated','All required checks passed; immutable package archived');
    }catch(error){task.error=error instanceof Error?error.message:String(error);this.journal.phase(task,'failed',task.error);throw error;}finally{this.validating.delete(id);}
  }
  queueApply(id:string):EvolutionTask{
    this.available();const task=this.journal.read(id);if(task.phase!=='validated'||!task.artifact||!task.validatedDigest)throw Error('Validate candidate before applying');
    if(sourceDigest(this.assertCandidate(task))!==task.validatedDigest||packageIdentity(task.candidateRoot!)!==task.artifact.identity)throw Error('Validated candidate changed; validate again');
    verifyArtifact(task.artifact);verifyArtifact(task.previous!);
    if(readInstallation(this.productHome).current.sha256!==task.previous!.sha256)throw Error('Installed baseline changed; create a new candidate');
    this.rejectPending();return this.journal.phase(task,'queued','Apply queued; coordinator will drain after the current tool returns');
  }
  private rejectPending():void{if(this.journal.list().some(t=>['queued','draining','applying','restarting','reconnecting','rolling-back'].includes(t.phase)))throw Error('Another lifecycle operation is pending');}
  queueRestart(scopeKey:string,configId:string):EvolutionTask{
    this.available();this.rejectPending();const now=Date.now();return this.save({id:randomUUID(),kind:'restart',scopeKey,configId,goal:'Restart instance and reconnect',phase:'queued',createdAt:now,updatedAt:now,events:[{at:now,phase:'queued',message:'Restart queued after current turn'}]});
  }
  rollback(id:string):EvolutionTask{
    this.available();this.rejectPending();const target=this.journal.read(id);if(!target.previous||!['succeeded','failed'].includes(target.phase))throw Error('No completed upgrade with a previous package to roll back');
    verifyArtifact(target.previous);const installation=readInstallation(this.productHome);const now=Date.now();
    return this.save({id:randomUUID(),kind:'rollback',scopeKey:target.scopeKey,configId:target.configId,goal:`Rollback ${id}`,rollbackOf:id,phase:'queued',createdAt:now,updatedAt:now,artifact:target.previous,previous:installation.current,sourceRoot:installation.sourceRoot,sourceDigest:installation.sourceDigest,validatedDigest:target.sourceDigest,projectRoot:installation.projectRoot??installation.sourceRoot,selectedSourceRoot:target.sourceRoot,events:[{at:now,phase:'queued',message:'Manual rollback queued; runtime data is preserved'}]});
  }
}
