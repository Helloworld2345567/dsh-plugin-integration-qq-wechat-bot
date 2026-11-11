import type {Credential} from './types.js';
import type {ChannelRegistry} from './channel-registry.js';
import type {Credentials} from './runtime-ports.js';
import type {BotRepository} from './ports/bot.js';
import {localizedError} from './errors.js';

export interface ConnectionStatus {phase:string;changedAt:number}
export interface ConnectionSupervisor {
  start(botId:string):Promise<void>;
  disconnect(botId:string):Promise<void>;
  disconnectAll():Promise<void>;
  status(botId:string):string;
  snapshot():ReadonlyMap<string,string>;
}

/** Owns bot-level connection tasks; platform retry loops remain inside adapters. */
export class DurableConnectionSupervisor implements ConnectionSupervisor {
  private readonly connections=new Map<string,{controller:AbortController;done:Promise<void>}>();
  constructor(readonly bots:BotRepository,readonly channels:ChannelRegistry,readonly credentials:Credentials,readonly states:Map<string,string>,readonly receive:(message:any)=>Promise<void>){ }
  status(botId:string):string{return this.states.get(botId)??'stopped';}
  snapshot():ReadonlyMap<string,string>{return new Map(this.states);}
  async start(botId:string):Promise<void>{
    const bot=this.bots.bot(botId);const definition=this.channels.require(bot.channel);if(bot.archived)throw localizedError('botArchived');if(this.connections.has(botId))return;
    const raw=await this.credentials.read(botId);if(!raw)throw localizedError('authorizationRequired');const normalized=definition.normalizeCredential?.(raw);const credential=(normalized?.credential??raw) as Credential;if((normalized?.accountId??credential.accountId)!==bot.accountId)throw localizedError('authorizationRequired');
    if(this.bots.bot(botId).archived)throw Error('机器人已删除');
    if(this.bots.bots().some(other=>other.id!==bot.id&&other.enabled&&!other.archived&&other.channel===bot.channel&&other.accountId===bot.accountId))throw localizedError('activePlatformConnection');
    this.bots.saveBot({...bot,enabled:true});const controller=new AbortController();this.states.set(botId,'connecting');
    const done=definition.adapter.connect({...bot,enabled:true},credential,message=>this.receive(message),controller.signal,state=>this.states.set(botId,state)).catch(error=>{if(!controller.signal.aborted)this.states.set(botId,'error');throw error;}).finally(()=>{if(this.connections.get(botId)?.controller===controller){this.connections.delete(botId);if(!controller.signal.aborted&&this.states.get(botId)!=='error')this.states.set(botId,'disconnected');}});
    this.connections.set(botId,{controller,done});
    void done.catch(()=>{});
  }
  async disconnect(botId:string):Promise<void>{const connection=this.connections.get(botId);if(!connection){this.states.set(botId,'stopped');return;}connection.controller.abort();await connection.done.catch(()=>{});this.states.set(botId,'stopped');}
  async disconnectAll():Promise<void>{await Promise.all([...this.connections.keys()].map(botId=>this.disconnect(botId)));}
}
