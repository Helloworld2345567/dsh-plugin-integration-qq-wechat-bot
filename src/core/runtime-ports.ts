import type {BotConfig,Credential,InboundMessage,Output,SessionBinding,TurnSnapshot} from './types.js';
export interface HarnessResult {turnId:string;outputs:Output[];snapshot:TurnSnapshot}
export interface HarnessPort {
  run(binding:SessionBinding,messages:InboundMessage[],signal:AbortSignal):Promise<HarnessResult>;
  cancel(sessionId:string):void;
  dispose(sessionId?:string):Promise<void>;
  validateModel(config:BotConfig):Promise<void>;
  recheckPermissions?():void;
  compact?(binding:SessionBinding,signal:AbortSignal):Promise<string>;
  models?():Promise<Array<{provider:string;model:string;inputModalities?:string[]}>>;
  inspectSession?(sessionId:string):Promise<void>;
  drain?():Promise<void>;
}
export interface Credentials {read(botId:string):Promise<Credential|undefined>;write(botId:string,value:Credential):Promise<void>;remove(botId:string):Promise<void>}
