export interface TurnCoordinatorActivity {active:number;maintenance:number;pendingTimers:number}
export interface TurnCoordinator {
  notify(scopeKey:string):void;
  runNow(scopeKey:string):Promise<void>;
  cancel(scopeKey:string):void;
  pauseAdmission():void;
  resumeAdmission():void;
  drain():Promise<void>;
  close():Promise<void>;
  busy(scopeKey:string):boolean;
  activity():TurnCoordinatorActivity;
}
/** Thin seam for the first extraction; Runtime remains the implementation owner of turn semantics. */
export class RuntimeTurnCoordinator implements TurnCoordinator {
  constructor(readonly runtime:{notifyTurn(scopeKey:string):void;runTurn(scopeKey:string):Promise<void>;cancelTurn(scopeKey:string):void;pauseProcessing():void;resumeProcessing():void;drainTurns():Promise<void>;closeTurns():Promise<void>;turnBusy(scopeKey:string):boolean;turnActivity():TurnCoordinatorActivity}){}
  notify(scopeKey:string):void{this.runtime.notifyTurn(scopeKey);}
  runNow(scopeKey:string):Promise<void>{return this.runtime.runTurn(scopeKey);}
  cancel(scopeKey:string):void{this.runtime.cancelTurn(scopeKey);}
  pauseAdmission():void{this.runtime.pauseProcessing();}
  resumeAdmission():void{this.runtime.resumeProcessing();}
  drain():Promise<void>{return this.runtime.drainTurns();}
  close():Promise<void>{return this.runtime.closeTurns();}
  busy(scopeKey:string):boolean{return this.runtime.turnBusy(scopeKey);}
  activity():TurnCoordinatorActivity{return this.runtime.turnActivity();}
}
