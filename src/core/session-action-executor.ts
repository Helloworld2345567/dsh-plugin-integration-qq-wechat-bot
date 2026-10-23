import type {CallerScope,SessionBinding,TurnSnapshot} from './types.js';
import type {DeferredSessionAction,SessionActionRecord} from './session-actions.js';
export interface SessionActionExecutor {
  queue(binding:SessionBinding,snapshot:TurnSnapshot,action:DeferredSessionAction,signal:AbortSignal):{status:'queued';actionId:string;action:string};
  resume(scopeKey?:string):void;
  cancelScope(scopeKey:string,reason:string,exceptId?:string):void;
  active(scopeKey:string):boolean;
  drain():Promise<void>;
}
/** Compatibility seam; Runtime remains the durable implementation in this extraction. */
export class RuntimeSessionActionExecutor implements SessionActionExecutor {
  constructor(readonly runtime:{queueSessionAction(binding:SessionBinding,snapshot:TurnSnapshot,action:DeferredSessionAction,signal:AbortSignal):{status:'queued';actionId:string;action:string};resumeSessionActions(scopeKey?:string):void;cancelSessionActions(scopeKey:string,reason:string,exceptId?:string):void;sessionActionActive(scopeKey:string):boolean;drainControls():Promise<void>}){}
  queue(binding:SessionBinding,snapshot:TurnSnapshot,action:DeferredSessionAction,signal:AbortSignal){return this.runtime.queueSessionAction(binding,snapshot,action,signal);}
  resume(scopeKey?:string):void{this.runtime.resumeSessionActions(scopeKey);}
  cancelScope(scopeKey:string,reason:string,exceptId?:string):void{this.runtime.cancelSessionActions(scopeKey,reason,exceptId);}
  active(scopeKey:string):boolean{return this.runtime.sessionActionActive(scopeKey);}
  drain():Promise<void>{return this.runtime.drainControls();}
}
