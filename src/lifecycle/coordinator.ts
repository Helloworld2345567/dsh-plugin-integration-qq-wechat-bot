import path from 'node:path';
import {atomicJson,LifecycleJournal,MUTABLE_BUNDLE,lifecycleRuntime,readInstallation,packageIdentity,verifyArtifact,type EvolutionTask,type LifecycleRuntime,type Artifact} from './protocol.js';
import {sourceFiles,sourceDigest} from './integrity.js';

export interface PackageResult {application:string;error?:{code:string;diagnostic?:string};restartReason?:string}
export interface PackageManager {listBundles():Promise<Array<{name:string;installed:boolean;enabled:boolean}>>;removeBundle(name:string):Promise<PackageResult>;installBundle(file:string,options:{enabled:true;saveExact:true}):Promise<PackageResult>}
export interface CoordinatorOptions {
  runtime?:()=>LifecycleRuntime|undefined;
  restart?:(task:EvolutionTask)=>Promise<void>;
  healthTimeoutMs?:number;
  now?:()=>number;
}
const inProgress=new Set(['queued','draining','applying','restarting','reconnecting','rolling-back']);
/** Owned by a separate bundle. It never injects or holds a Cordis dependency on the replaceable plugin. */
export class LifecycleCoordinator {
  readonly journal:LifecycleJournal;private busy=false;private disposed=false;private awaitingRestart=false;
  constructor(readonly home:string,readonly manager:PackageManager,readonly options:CoordinatorOptions={}){this.journal=new LifecycleJournal(home);}
  private runtime():LifecycleRuntime|undefined{return(this.options.runtime??lifecycleRuntime)();}
  dispose():void{this.disposed=true;}
  private restart(task:EvolutionTask):Promise<void>{
    if(this.options.restart)return this.options.restart(task).then(()=>{this.awaitingRestart=true;});
    return new Promise((resolve,reject)=>{
      if(!process.connected||!process.send||!process.env.BOT_LAUNCH_TOKEN){reject(Error('Restart requires the supervised scripts/start.mjs launcher'));return;}
      process.send({type:'bot-restart',nonce:process.env.BOT_LAUNCH_TOKEN,taskId:task.id},error=>{if(error)reject(error);else{this.awaitingRestart=true;resolve();}});
    });
  }
  private async ready(expected?:Artifact):Promise<LifecycleRuntime>{
    const deadline=Date.now()+(this.options.healthTimeoutMs??10000);
    while(Date.now()<deadline&&!this.disposed){
      const runtime=this.runtime();
      if(runtime?.health().ready&&(!expected||packageIdentity(runtime.packageRoot)===expected.identity))return runtime;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('Expected plugin failed its startup identity/health check');
  }
  private result(result:PackageResult):void{if(!['applied','restart-required'].includes(result.application))throw Error(`Plugin Manager ${result.application}: ${result.error?.code??''} ${result.error?.diagnostic??''}`);}
  private async replace(artifact:Artifact,task:EvolutionTask):Promise<boolean>{
    verifyArtifact(artifact);
    const present=(await this.manager.listBundles()).some(bundle=>bundle.name===MUTABLE_BUNDLE&&(bundle.installed||bundle.enabled));
    const record=(operation:string,result:PackageResult)=>this.journal.phase(task,task.phase,`${operation}: ${JSON.stringify({application:result.application,error:result.error,restartReason:result.restartReason})}`);
    if(!present){const installed=await this.manager.installBundle(artifact.path,{enabled:true,saveExact:true});record('install',installed);this.result(installed);return installed.application==='restart-required';}
    const removed=await this.manager.removeBundle(MUTABLE_BUNDLE);
    record('remove',removed);
    // Startup-only profiles cannot remove a running bundle. A tarball install updates the saved package and requires restart.
    if(removed.application==='failed'&&removed.error?.code==='stop-profile'){
      const installed=await this.manager.installBundle(artifact.path,{enabled:true,saveExact:true});record('install',installed);this.result(installed);return true;
    }
    this.result(removed);
    const installed=await this.manager.installBundle(artifact.path,{enabled:true,saveExact:true});record('install',installed);this.result(installed);
    return removed.application==='restart-required'||installed.application==='restart-required';
  }
  private commit(task:EvolutionTask,artifact:Artifact,rollback:boolean):void{
    const installation=readInstallation(this.home);
    atomicJson(path.join(this.home,'installation.json'),{...installation,projectRoot:installation.projectRoot??task.projectRoot??installation.sourceRoot,sourceRoot:rollback?task.sourceRoot??installation.sourceRoot:task.selectedSourceRoot??task.candidateRoot??installation.sourceRoot,sourceDigest:(rollback?task.sourceDigest:task.validatedDigest)??installation.sourceDigest,current:artifact,previous:rollback?task.artifact:task.previous,updatedAt:Date.now()});
    this.journal.phase(task,rollback?'rolled-back':'succeeded',rollback?'Previous package restored; all runtime data preserved':'New package healthy; channels reconnect with their existing configuration');
    this.runtime()?.resumeProcessing();
  }
  private async activate(task:EvolutionTask,artifact:Artifact,rollback:boolean):Promise<void>{
    this.journal.phase(task,'reconnecting',rollback?'Checking previous plugin activation':'Checking new plugin identity and activation');
    try{await this.ready(artifact);this.commit(task,artifact,rollback);}
    catch(error){
      if(task.activationRestarts?.includes(artifact.sha256))throw error;
      (task.activationRestarts??=[]).push(artifact.sha256);
      this.journal.phase(task,'restarting','Hot activation did not produce a healthy runtime; restarting the verified package once');await this.restart(task);
    }
  }
  private async rollback(task:EvolutionTask,cause:unknown):Promise<void>{
    task.error=String(cause);
    if(task.rollbackAttempted||!task.previous){this.journal.phase(task,'failed',`Automatic recovery exhausted: ${task.error}`);this.runtime()?.resumeProcessing();return;}
    task.rollbackAttempted=true;this.journal.phase(task,'rolling-back',`Restoring previous archive after ${task.error}`);
    try{
      if(await this.replace(task.previous,task)){this.journal.phase(task,'restarting','Restarting once with the previous archive');await this.restart(task);return;}
      await this.activate(task,task.previous,true);
    }catch(error){task.error=String(error);this.journal.phase(task,'failed',`Rollback failed: ${task.error}`);this.runtime()?.resumeProcessing();}
  }
  /** Polling starts independently of a bot turn. The active tool can return before quiesce waits for it. */
  async tick():Promise<void>{
    if(this.busy||this.disposed||this.awaitingRestart)return;const task=this.journal.list().reverse().find(t=>inProgress.has(t.phase));if(!task)return;
    this.busy=true;
    try{
      if(task.phase==='restarting'||task.phase==='reconnecting'){
        const expected=task.rollbackAttempted?task.previous:task.artifact;
        await this.ready(expected);
        if(task.kind==='restart'){this.journal.phase(task,'succeeded','Supervised restart healthy');this.runtime()?.resumeProcessing();}
        else this.commit(task,expected!,Boolean(task.rollbackAttempted));
        return;
      }
      if(task.phase==='applying'||task.phase==='rolling-back'){
        // A crash may have occurred between remove and install. Never guess which archive activated.
        if(task.phase==='rolling-back')task.rollbackAttempted=false;
        await this.rollback(task,'Interrupted lifecycle transaction recovered at startup');return;
      }
      const runtime=await this.ready();this.journal.phase(task,'draining','Waiting for active turns, children, media and delivery acknowledgements');
      await runtime.quiesce();if(this.disposed)return;
      if(task.kind==='restart'){this.journal.phase(task,'restarting','Drain complete; supervised restart requested');await this.restart(task);return;}
      if(!task.artifact||!task.previous)throw Error('Lifecycle task lacks package identity');
      verifyArtifact(task.artifact);verifyArtifact(task.previous);
      const installation=readInstallation(this.home);if(installation.current.sha256!==task.previous.sha256)throw Error('Installed baseline changed before activation');
      if(task.candidateRoot&&(packageIdentity(task.candidateRoot)!==task.artifact.identity||sourceDigest(sourceFiles(task.candidateRoot))!==task.validatedDigest))throw Error('Candidate changed after validation');
      this.journal.phase(task,'applying','Installing verified archive through Harness Plugin Manager');
      if(await this.replace(task.artifact,task)){this.journal.phase(task,'restarting','Harness requires restart to activate this package');await this.restart(task);return;}
      await this.activate(task,task.artifact,false);
    }catch(error){
      if(task.kind==='restart'){task.error=String(error);this.journal.phase(task,'failed',task.error);this.runtime()?.resumeProcessing();}
      else if(['draining','queued'].includes(task.phase)){task.error=String(error);this.journal.phase(task,'failed',task.error);this.runtime()?.resumeProcessing();}
      else await this.rollback(task,error);
    }finally{this.busy=false;}
  }
}
