import type {InboundMessage} from './types.js';
import type {ParsedCommand} from './commands.js';
export interface CommandDispatcher {
  dispatch(message:InboundMessage,command:ParsedCommand):Promise<void>;
  recover():void;
  pauseAdmission():void;
  resumeAdmission():void;
  drain():Promise<void>;
  active(scopeKey:string):boolean;
}
/** Queue facade for the first extraction; Runtime supplies the durable command implementation. */
export class RuntimeCommandDispatcher implements CommandDispatcher {
  constructor(readonly runtime:{dispatchCommand(message:InboundMessage,command:ParsedCommand):Promise<void>;resumeCommands():void;pauseProcessing():void;resumeProcessing():void;drainControls():Promise<void>;controlActive(scopeKey:string):boolean}){}
  dispatch(message:InboundMessage,command:ParsedCommand):Promise<void>{return this.runtime.dispatchCommand(message,command);}
  recover():void{this.runtime.resumeCommands();}
  pauseAdmission():void{this.runtime.pauseProcessing();}
  resumeAdmission():void{this.runtime.resumeProcessing();}
  drain():Promise<void>{return this.runtime.drainControls();}
  active(scopeKey:string):boolean{return this.runtime.controlActive(scopeKey);}
}
