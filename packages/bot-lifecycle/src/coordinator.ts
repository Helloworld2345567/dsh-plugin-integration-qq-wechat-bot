import path from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {atomicJson,LifecycleJournal,MUTABLE_BUNDLE,lifecycleRuntime,lifecycleHandshake,lifecycleCompatibility,coordinatorHandshake,readInstallation,packageIdentity,verifyArtifact,planMainReplacement,COMPATIBILITY_CODES,type EvolutionTask,type LifecycleRuntime,type Artifact,type MainLifecycleDeclaration} from './contract/protocol.js';
import {sourceFiles,sourceDigest} from './contract/source-integrity.js';

export interface PackageResult {application:string;error?:{code:string;diagnostic?:string};restartReason?:string}
export interface PackageManager {listBundles():Promise<Array<{name:string;installed:boolean;enabled:boolean}>>;removeBundle(name:string):Promise<PackageResult>;installBundle(file:string,options:{enabled:true;saveExact:true}):Promise<PackageResult>}
export interface CoordinatorOptions {
  runtime?:()=>LifecycleRuntime|undefined;
  restart?:(task:EvolutionTask)=>Promise<void>;
  healthTimeoutMs?:number;
  now?:()=>number;
  coordinatorDeclaration?:()=>ReturnType<typeof coordinatorHandshake>;
  handshake?:()=>ReturnType<typeof lifecycleHandshake>;
  compatibility?:()=>ReturnType<typeof lifecycleCompatibility>;
}
const inProgress=new Set(['queued','draining','applying','restarting','reconnecting','rolling-back']);
function mainDeclaration(artifact:Artifact):MainLifecycleDeclaration {if(!artifact.lifecycle||artifact.lifecycle.role!=='main'||artifact.packageVersion!==artifact.lifecycle.packageVersion)throw Error(`${COMPATIBILITY_CODES.METADATA_MISSING}: main artifact compatibility metadata is missing`);return artifact.lifecycle;}
function handshakeMatchesArtifact(handshake:ReturnType<typeof lifecycleHandshake>,artifact:Artifact):boolean {if(!handshake||!artifact.lifecycle)return false;const expected=artifact.lifecycle;return handshake.artifactIdentity===artifact.identity&&handshake.packageVersion===artifact.packageVersion&&handshake.packageName===expected.packageName&&handshake.runtimeProtocol===expected.runtimeProtocol&&handshake.coordinatorApiRange===expected.coordinatorApiRange&&JSON.stringify(handshake.capabilities)===JSON.stringify(expected.capabilities)&&JSON.stringify(handshake.requiredCoordinatorCapabilities)===JSON.stringify(expected.requiredCoordinatorCapabilities);}
/** Owned by a separate bundle. It never injects or holds a Cordis dependency on the replaceable plugin. */
export class LifecycleCoordinator {
  readonly journal:LifecycleJournal;private busy=false;private disposed=false;private awaitingRestart=false;
  constructor(readonly home:string,readonly manager:PackageManager,readonly options:CoordinatorOptions={}){this.journal=new LifecycleJournal(home);}
  private runtime():LifecycleRuntime|undefined{return(this.options.runtime??lifecycleRuntime)();}
  dispose():void{this.disposed=true;}
  private assertHotReplacement(artifact:Artifact):void {
    const coordinator=(this.options.coordinatorDeclaration??coordinatorHandshake)();if(!coordinator)throw Error(`${COMPATIBILITY_CODES.METADATA_MISSING}: coordinator declaration is unavailable`);
    const plan=planMainReplacement(mainDeclaration(artifact),coordinator);if(plan.mode!=='main-hot')throw Error(`${plan.code}: ${plan.cause??plan.diagnostic}`);
  }
  private restart(task:EvolutionTask):Promise<void>{
    if(this.options.restart)return this.options.restart(task).then(()=>{this.awaitingRestart=true;});
    return new Promise((resolve,reject)=>{
      if(!process.connected||!process.send||!process.env.BOT_LAUNCH_TOKEN){reject(Error('Restart requires the supervised scripts/start.mjs launcher'));return;}
      process.send({type:'bot-restart',nonce:process.env.BOT_LAUNCH_TOKEN,taskId:task.id},error=>{if(error)reject(error);else{this.awaitingRestart=true;resolve();}});
    });
  }
  private async ready(expected?:Artifact):Promise<LifecycleRuntime>{
    const deadline=(this.options.now??Date.now)()+(this.options.healthTimeoutMs??10000);
    while((this.options.now??Date.now)()<deadline&&!this.disposed){
      const runtime=this.runtime(),handshake=(this.options.handshake??lifecycleHandshake)(),compatibility=(this.options.compatibility??lifecycleCompatibility)();
      if(runtime?.health().ready&&handshake?.runtime===runtime&&compatibility.compatible&&(!expected||handshakeMatchesArtifact(handshake,expected)))return runtime;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    throw Error('Expected plugin failed its startup identity/health/compatibility check');
  }
  private result(result:PackageResult):void{if(!['applied','restart-required'].includes(result.application))throw Error(`Plugin Manager ${result.application}: ${result.error?.code??''} ${result.error?.diagnostic??''}`);}
  private async replace(artifact:Artifact,task:EvolutionTask):Promise<boolean>{
    verifyArtifact(artifact);this.assertHotReplacement(artifact);
    const present=(await this.manager.listBundles()).some(bundle=>bundle.name===MUTABLE_BUNDLE&&(bundle.installed||bundle.enabled));
    const record=(operation:string,result:PackageResult)=>this.journal.phase(task,task.phase,`${operation}: ${JSON.stringify({application:result.application,error:result.error,restartReason:result.restartReason})}`);
    if(!present){const installed=await this.manager.installBundle(artifact.path,{enabled:true,saveExact:true});record('install',installed);this.result(installed);return installed.application==='restart-required';}
    const removed=await this.manager.removeBundle(MUTABLE_BUNDLE);record('remove',removed);
    if(removed.application==='failed'&&removed.error?.code==='stop-profile'){
      const installed=await this.manager.installBundle(artifact.path,{enabled:true,saveExact:true});record('install',installed);this.result(installed);return true;
    }
    this.result(removed);const installed=await this.manager.installBundle(artifact.path,{enabled:true,saveExact:true});record('install',installed);this.result(installed);
    return removed.application==='restart-required'||installed.application==='restart-required';
  }
  private commit(task:EvolutionTask,artifact:Artifact,rollback:boolean):void{
    const installation=readInstallation(this.home),lifecycleFile=path.join(this.home,'lifecycle-installation.json');if(!existsSync(lifecycleFile))throw Error(`${COMPATIBILITY_CODES.METADATA_MISSING}: lifecycle installation state is missing`);
    const lifecycleInstallation=JSON.parse(readFileSync(lifecycleFile,'utf8')),allowed=new Set([task.artifact?.sha256,task.previous?.sha256].filter(Boolean));if(lifecycleInstallation.schemaVersion!==1||!allowed.has(installation.current.sha256)||!allowed.has(lifecycleInstallation.current?.main?.sha256)||!lifecycleInstallation.current?.coordinator)throw Error(`${COMPATIBILITY_CODES.METADATA_INVALID}: lifecycle installation state changed outside this durable transaction`);
    const priorCurrent=lifecycleInstallation.current,previousPair=priorCurrent.main?.sha256===artifact.sha256?lifecycleInstallation.previous:priorCurrent,currentPair={main:artifact,coordinator:priorCurrent.coordinator};
    atomicJson(path.join(this.home,'installation.json'),{...installation,projectRoot:installation.projectRoot??task.projectRoot??installation.sourceRoot,sourceRoot:rollback?task.sourceRoot??installation.sourceRoot:task.selectedSourceRoot??task.candidateRoot??installation.sourceRoot,sourceDigest:(rollback?task.sourceDigest:task.validatedDigest)??installation.sourceDigest,current:artifact,previous:rollback?task.artifact:task.previous,updatedAt:Date.now()});
    atomicJson(lifecycleFile,{...lifecycleInstallation,current:currentPair,previous:previousPair,updatedAt:Date.now()});
    this.journal.phase(task,rollback?'rolled-back':'succeeded',rollback?'Previous package restored; all runtime data preserved':'New package healthy; channels reconnect with their existing configuration');this.runtime()?.resumeProcessing();
  }
  private async activate(task:EvolutionTask,artifact:Artifact,rollback:boolean):Promise<void>{
    this.journal.phase(task,'reconnecting',rollback?'Checking previous plugin activation':'Checking new plugin identity and activation');
    try{await this.ready(artifact);this.commit(task,artifact,rollback);}
    catch(error){if(task.activationRestarts?.includes(artifact.sha256))throw error;(task.activationRestarts??=[]).push(artifact.sha256);this.journal.phase(task,'restarting','Hot activation did not produce a healthy runtime; restarting the verified package once');await this.restart(task);}
  }
  private async rollback(task:EvolutionTask,cause:unknown):Promise<void>{
    task.error=String(cause);if(task.rollbackAttempted||!task.previous){this.journal.phase(task,'failed',`Automatic recovery exhausted: ${task.error}`);this.runtime()?.resumeProcessing();return;}
    task.rollbackAttempted=true;task.rollbackStep='requested';this.journal.phase(task,'rolling-back',`Restoring previous archive once after ${task.error}`);
    try{task.rollbackStep='install-started';this.journal.write(task);if(await this.replace(task.previous,task)){task.rollbackStep='installed';this.journal.phase(task,'restarting','Restarting once with the previous archive');await this.restart(task);return;}task.rollbackStep='installed';this.journal.write(task);await this.activate(task,task.previous,true);}
    catch(error){task.error=String(error);this.journal.phase(task,'failed',`Rollback failed: ${task.error}`);this.runtime()?.resumeProcessing();}
  }
  /** Polling starts independently of a bot turn. The active tool can return before quiesce waits for it. */
  async tick():Promise<void>{
    if(this.busy||this.disposed||this.awaitingRestart)return;const task=this.journal.list().reverse().find(t=>inProgress.has(t.phase));if(!task)return;this.busy=true;
    try{
      if(task.phase==='restarting'||task.phase==='reconnecting'){
        const expected=task.rollbackAttempted?task.previous:task.artifact;await this.ready(expected);
        if(task.kind==='restart'){this.journal.phase(task,'succeeded','Supervised restart healthy');this.runtime()?.resumeProcessing();}else this.commit(task,expected!,Boolean(task.rollbackAttempted));return;
      }
      if(task.phase==='applying'){await this.rollback(task,'Interrupted lifecycle transaction recovered at startup');return;}
      if(task.phase==='rolling-back'){task.error='Rollback outcome became unknown before a durable installed marker; refusing to replay';this.journal.phase(task,'failed',task.error);this.runtime()?.resumeProcessing();return;}
      if(task.kind!=='restart'){if(!task.artifact||!task.previous)throw Error('Lifecycle task lacks package identity');verifyArtifact(task.artifact);verifyArtifact(task.previous);this.assertHotReplacement(task.artifact);this.assertHotReplacement(task.previous);}
      const runtime=await this.ready();this.journal.phase(task,'draining','Waiting for active turns, children, media and delivery acknowledgements');await runtime.quiesce();if(this.disposed)return;
      if(task.kind==='restart'){this.journal.phase(task,'restarting','Drain complete; supervised restart requested');await this.restart(task);return;}
      const installation=readInstallation(this.home);if(installation.current.sha256!==task.previous!.sha256)throw Error('Installed baseline changed before activation');
      if(task.candidateRoot&&(packageIdentity(task.candidateRoot)!==task.artifact!.identity||sourceDigest(sourceFiles(task.candidateRoot))!==task.validatedDigest))throw Error('Candidate changed after validation');
      this.journal.phase(task,'applying','Installing verified compatible main archive through Harness Plugin Manager');if(await this.replace(task.artifact!,task)){this.journal.phase(task,'restarting','Harness requires restart to activate this package');await this.restart(task);return;}await this.activate(task,task.artifact!,false);
    }catch(error){if(task.kind==='restart'){task.error=String(error);this.journal.phase(task,'failed',task.error);this.runtime()?.resumeProcessing();}else if(['draining','queued'].includes(task.phase)){task.error=String(error);this.journal.phase(task,'failed',task.error);this.runtime()?.resumeProcessing();}else await this.rollback(task,error);}
    finally{this.busy=false;}
  }
}
