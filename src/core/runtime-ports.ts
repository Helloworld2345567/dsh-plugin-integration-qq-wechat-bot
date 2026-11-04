import type {BotConfig,Credential,InboundMessage,Output,SessionBinding,TurnSnapshot} from './types.js';
import type {EvolutionTask} from '../../packages/bot-lifecycle/src/contract/evolution-contract.js';
import type {CoordinatorLifecycleDeclaration,LifecycleCompatibility} from '../../packages/bot-lifecycle/src/contract/compatibility.mjs';
import type {ProgressFacts,ProgressStage} from './progress.js';
export interface HarnessRunOptions {snapshot?:TurnSnapshot;onProgress?:(stage:ProgressStage)=>void;onEnd?:()=>void}
export interface HarnessResult {turnId:string;outputs:Output[];snapshot:TurnSnapshot;voiceAttempted?:boolean;singingAttempted?:boolean}
export interface LifecycleHandshake {protocol:'dsh.lifecycle';schemaVersion:1;role:'main';packageName:string;packageVersion:string;runtimeProtocol:string;coordinatorApiRange:string;instance:string;artifactIdentity:string;capabilities:readonly string[];requiredCoordinatorCapabilities:readonly string[]}
/** Core depends on this neutral, serializable port; the lifecycle bundle supplies the implementation. */
export interface EvolutionJournalPort {
  list(): EvolutionTask[];
  read(id:string): EvolutionTask;
  write(task:EvolutionTask): EvolutionTask;
  phase(task:EvolutionTask, phase:EvolutionTask['phase'], message:string): EvolutionTask;
}
export interface SessionHistoryPort {
  readSession(id:string): Promise<{events: ReadonlyArray<{seq:number;time:number;type:string;data:unknown}>}>;
}
export interface LifecyclePort {
  available():boolean;
  handshake():LifecycleHandshake|undefined;
  compatibility():LifecycleCompatibility&{coordinator?:CoordinatorLifecycleDeclaration&{artifactIdentity?:string}};
  /** Persistence is owned by the independent lifecycle bundle when present. */
  journal?(home:string): EvolutionJournalPort;
}
export interface HarnessPort {
  run(binding:SessionBinding,messages:InboundMessage[],signal:AbortSignal,options?:HarnessRunOptions):Promise<HarnessResult>;
  formatProgress?(binding:SessionBinding,snapshot:TurnSnapshot,facts:ProgressFacts,signal:AbortSignal):Promise<string>;
  cancel(sessionId:string):void;
  dispose(sessionId?:string):Promise<void>;
  deleteSessions(sessionIds:readonly string[]):Promise<void>;
  validateModel(config:BotConfig):Promise<void>;
  recheckPermissions?():void;
  compact?(binding:SessionBinding,signal:AbortSignal):Promise<string>;
  models?():Promise<Array<{provider:string;model:string;inputModalities?:string[];reasoning?:{supported:boolean;efforts:string[]}}>>;
  inspectSession?(sessionId:string):Promise<void>;
  drain?():Promise<void>;
}
export interface Credentials {read(botId:string):Promise<Credential|undefined>;write(botId:string,value:Credential):Promise<void>;remove(botId:string):Promise<void>}
