export type RuntimeState='new'|'initializing'|'running'|'quiescing'|'closed';
export interface RuntimeLifecycle {initialize():Promise<void>;pause(reason:string):void;quiesce(operationId:string):Promise<void>;resume(operationId?:string):void;close():Promise<void>;state():RuntimeState;}
/** Lifecycle facade for the extraction; BotRuntime remains the compatibility implementation. */
export class RuntimeLifecycleFacade implements RuntimeLifecycle {
  private currentState:RuntimeState='new';
  constructor(readonly runtime:{initialize():Promise<void>;pauseProcessing():void;quiesce():Promise<void>;resumeProcessing():void;close():Promise<void>}){}
  async initialize():Promise<void>{if(this.currentState==='closed')throw Error('RUNTIME_CLOSED');if(this.currentState==='running')return;this.currentState='initializing';try{await this.runtime.initialize();this.currentState='running';}catch(error){this.currentState='new';throw error;}}
  pause(_reason:string):void{if(this.currentState==='running'){this.runtime.pauseProcessing();this.currentState='quiescing';}}
  async quiesce(_operationId:string):Promise<void>{if(this.currentState==='closed')return;if(this.currentState==='running')this.pause('quiesce');if(this.currentState==='quiescing')await this.runtime.quiesce();}
  resume(_operationId?:string):void{if(this.currentState==='quiescing'){this.runtime.resumeProcessing();this.currentState='running';}}
  async close():Promise<void>{if(this.currentState==='closed')return;this.currentState='closed';await this.runtime.close();}
  state():RuntimeState{return this.currentState;}
}
