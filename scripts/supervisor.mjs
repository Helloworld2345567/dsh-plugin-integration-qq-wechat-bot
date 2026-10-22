/** Child ownership and authenticated restart protocol, separately testable without launching Harness. */
export class Supervisor {
  constructor({spawn,token,onExit=()=>{},recover=async()=>{},onError=()=>{},readTask=async()=>{},timeoutMs=90000,stopTimeoutMs=15000,forceKill=child=>child.kill('SIGKILL')}){
    Object.assign(this,{spawn,token,onExit,recover,onError,readTask,timeoutMs,stopTimeoutMs,forceKill});this.stopping=false;this.restarting=false;this.recoveryAttempted=false;this.child=undefined;this.taskId=undefined;this.generation=0;
  }
  start(){
    this.generation++;const generation=this.generation;const child=this.spawn();this.child=child;this.restarting=false;this.healthy=false;
    this.healthTimer=setTimeout(()=>{if(this.child===child&&!this.healthy){this.onError(Error('Harness startup health timeout'));this.terminate(child);}},this.timeoutMs);this.healthTimer.unref?.();
    child.on('message',message=>{void this.message(child,message).catch(this.onError);});
    child.on('error',error=>{this.onError(error);void this.exited(child,1,generation).catch(failure=>{this.onError(failure);this.onExit(1);});});
    child.on('exit',(code)=>{void this.exited(child,code,generation).catch(error=>{this.onError(error);this.onExit(1);});});
    return child;
  }
  async message(child,message){
    if(child!==this.child||!message||message.nonce!==this.token)return;
    if(message.type==='bot-ready'){
      if(this.taskId){const task=await this.readTask(this.taskId);const expected=task.rollbackAttempted?task.previous:task.artifact;if(expected&&message.identity!==expected.identity)return;}
      this.healthy=true;clearTimeout(this.healthTimer);return;
    }
    if(message.type!=='bot-restart'||this.stopping||this.restarting)return;
    const task=await this.readTask(message.taskId);if(task.id!==message.taskId||task.phase!=='restarting')throw Error('Restart request has no durable drained transaction');
    if(this.taskId!==task.id)this.recoveryAttempted=false;
    this.taskId=task.id;this.restarting=true;this.terminate(child);
  }
  terminate(child){
    clearTimeout(this.healthTimer);
    if(child.connected)child.send({type:'bot-stop',nonce:this.token});else child.kill('SIGTERM');
    clearTimeout(this.killTimer);this.killTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)this.forceKill(child);},this.stopTimeoutMs);this.killTimer.unref?.();
  }
  stop(){this.stopping=true;if(this.child)this.terminate(this.child);else this.onExit(0);}
  async exited(child,code,generation){
    if(child!==this.child||generation!==this.generation)return;clearTimeout(this.healthTimer);clearTimeout(this.killTimer);this.child=undefined;
    if(this.stopping){this.onExit(code??0);return;}
    if(this.restarting){this.start();return;}
    if(!this.healthy&&this.taskId&&!this.recoveryAttempted){this.recoveryAttempted=true;await this.recover(this.taskId);this.start();return;}
    this.onExit(code??1);
  }
}
