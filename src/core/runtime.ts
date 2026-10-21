import { Store, scopeKey } from './store.js';
import { Assets, MediaService } from './media.js';
import type { BotConfig, BotInstance, ChannelAdapter, Credential, InboundMessage, SessionBinding, Output, TurnSnapshot } from './types.js';
import {randomUUID} from 'node:crypto';
import {permissionsRevoked} from './policy.js';

export interface HarnessResult { turnId:string; outputs:Output[]; snapshot:TurnSnapshot }
export interface HarnessPort {
  run(binding:SessionBinding,messages:InboundMessage[],signal:AbortSignal):Promise<HarnessResult>;
  cancel(sessionId:string):void;
  dispose(sessionId?:string):Promise<void>;
  validateModel(config:BotConfig):Promise<void>;
  recheckPermissions?():void;
}
export interface Credentials { read(botId:string):Promise<Credential|undefined>; write(botId:string,value:Credential):Promise<void>; remove(botId:string):Promise<void> }
export class BotRuntime {
  readonly states=new Map<string,string>();
  private readonly connections=new Map<string,{controller:AbortController;done:Promise<void>}>();
  private readonly timers=new Map<string,ReturnType<typeof setTimeout>>();
  private readonly processing=new Map<string,{controller:AbortController;sessionId:string;done:Promise<void>}>();
  private readonly senders=new Map<string,Promise<void>>();
  private readonly outbound=new Map<string,{botId:string;controller:AbortController}>();
  private closed=false;
  private readonly owner=randomUUID();
  private claimed=false;
  activeSessions(botId:string):number {return [...this.processing.keys()].filter(key=>this.store.get<SessionBinding>('binding',key)?.scope.botId===botId).length;}
  constructor(readonly store:Store,readonly assets:Assets,readonly media:MediaService,readonly harness:HarnessPort,readonly adapters:Record<'qq'|'weixin',ChannelAdapter>,readonly credentials:Credentials,readonly debounceMs=2000){}
  async initialize():Promise<void>{
    this.store.claimRuntime(this.owner);this.claimed=true;this.store.recover();
    for(const job of this.store.list<any>('job'))if(job.state==='running')this.store.put('job',job.id,{...job,state:'interrupted'});
    for(const bot of this.store.bots())if(bot.enabled&&!bot.archived)void this.start(bot.id).catch(()=>this.states.set(bot.id,'error'));
    for(const key of this.store.scopesWithPending())this.schedule(key);
    void this.flushDeliveries();
  }
  async saveConfig(input:unknown,expectedRevision?:number):Promise<BotConfig>{
    const {configSchema}=await import('./types.js');const parsed=configSchema.parse(input);if(!parsed.archived)await this.harness.validateModel(parsed);
    const saved=this.store.saveConfig(parsed,expectedRevision);this.recheckPermissions();return saved;
  }
  saveBot(input:unknown):BotInstance{const previous=(input&&typeof input==='object'&&'id' in input)?this.store.get<BotInstance>('bot',String(input.id)):undefined;if(previous&&input&&typeof input==='object'&&(('accountId' in input&&previous.accountId!==input.accountId)||('channel' in input&&previous.channel!==input.channel)))throw new Error('已有机器人的渠道身份不可修改；请创建新机器人');const next=this.store.saveBot(input);this.recheckPermissions();return next;}
  private recheckPermissions():void{
    this.harness.recheckPermissions?.();
    // A changed policy cancels in-flight work; new privileges still wait for the next frozen turn.
    for(const [key,task] of this.processing){const binding=this.store.get<SessionBinding>('binding',key);if(!binding)continue;const before=this.store.get<TurnSnapshot>('turn-snapshot',task.sessionId);if(!before)continue;const bot=this.store.bot(binding.scope.botId);const current=this.store.get<BotConfig>('config',bot.configId);if(!current||permissionsRevoked(before,current,bot,binding.scope)){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}}
  }
  async start(botId:string):Promise<void>{
    const bot=this.store.bot(botId);if(bot.archived)throw new Error('机器人已归档');if(this.connections.has(botId))return;
    const credential=await this.credentials.read(botId);if(!credential||credential.accountId!==bot.accountId)throw new Error('请先完成账号授权');
    if(this.connections.has(botId))return;
    if(this.store.bots().some(b=>b.id!==bot.id&&b.enabled&&!b.archived&&b.channel===bot.channel&&b.accountId===bot.accountId))throw new Error('该平台账号已有活动连接');
    this.store.saveBot({...bot,enabled:true});const controller=new AbortController();
    const done=this.adapters[bot.channel].connect({...bot,enabled:true},credential,m=>this.receive(m),controller.signal,state=>this.states.set(botId,state)).catch(()=>{if(!controller.signal.aborted)this.states.set(botId,'error');}).finally(()=>{if(this.connections.get(botId)?.controller===controller)this.connections.delete(botId);});
    this.connections.set(botId,{controller,done});
  }
  async stop(botId:string):Promise<void>{
    const bot=this.store.bot(botId);this.store.saveBot({...bot,enabled:false});
    this.recheckPermissions();
    const connection=this.connections.get(botId);connection?.controller.abort();if(connection)await connection.done;
    for(const item of this.outbound.values())if(item.botId===botId)item.controller.abort();
    for(const [key,timer] of this.timers){const binding=this.store.get<SessionBinding>('binding',key);if(binding?.scope.botId===botId){clearTimeout(timer);this.timers.delete(key);}}
    for(const [key,task] of this.processing){const binding=this.store.get<SessionBinding>('binding',key);if(binding?.scope.botId===botId){task.controller.abort();this.harness.cancel(task.sessionId);this.media.cancelScope(key);}}
    for(const key of this.store.scopesWithPending(['pending','deferred'])){const messages=this.store.messages(key,['pending','deferred']);if(messages[0]?.scope.botId===botId)this.store.mark(key,messages.map(m=>m.id),'cancelled');}
    for(const d of this.store.deliveries(['pending']))if(d.botId===botId)this.store.deliveryState(d,'cancelled');
    await Promise.all([...this.processing.entries()].filter(([key])=>this.store.get<SessionBinding>('binding',key)?.scope.botId===botId).map(([,p])=>p.done));this.states.set(botId,'stopped');
  }
  async receive(message:InboundMessage):Promise<void>{
    const bot=this.store.bot(message.scope.botId);if(!bot.enabled||bot.archived||bot.channel!==message.scope.platform||bot.accountId!==message.scope.accountId)return;
    if(!message.id||!message.scope.senderId||!message.scope.channelId)throw new Error('INVALID_CHANNEL_IDENTITY');
    const key=scopeKey(message.scope);if(!this.store.accept(message))return;
    const command=message.text.trim().replace(/^\[(.*)\]$/s,'$1').toLowerCase();
    if(['/stop','/new','/reset'].includes(command)){
      const timer=this.timers.get(key);if(timer)clearTimeout(timer);this.timers.delete(key);
      const binding=this.store.binding(message.scope);const active=this.processing.get(key);active?.controller.abort();this.harness.cancel(binding.sessionId);this.media.cancelScope(key);
      this.store.mark(key,this.store.messages(key,['pending','deferred']).map(m=>m.id),'cancelled');
      for(const delivery of this.store.deliveries(['pending']))if(delivery.scopeKey===key)this.store.deliveryState(delivery,'cancelled');
      if(command!=='/stop'){if(active)await active.done;await this.harness.dispose(binding.sessionId);this.store.reset(message.scope);}return;
    }
    const stripped=message.text.trim();const onlyUrl=/^https?:\/\/\S+$/.test(stripped);const hold=/(?:先别|不要|暂不|等我).*(?:分析|处理|指令)/.test(stripped);
    if(hold||onlyUrl||(!stripped&&message.attachments.length>0&&message.attachments.every(a=>a.kind==='video'||a.kind==='file'))){this.store.mark(key,[message.id],'deferred');return;}
    this.schedule(key);
  }
  private schedule(key:string):void{if(this.closed)return;const previous=this.timers.get(key);if(previous)clearTimeout(previous);this.timers.set(key,setTimeout(()=>{this.timers.delete(key);void this.process(key);},this.debounceMs));}
  async process(key:string):Promise<void>{
    if(this.closed||this.processing.has(key))return;
    const pending=this.store.messages(key);if(!pending.length)return;
    const bot=this.store.bot(pending[0].scope.botId);if(!bot.enabled||bot.archived)return;
    const deferred=this.store.messages(key,['deferred']).filter(m=>m.timestamp>Date.now()-600000).slice(-8);
    const messages=[...deferred,...pending];const binding=this.store.binding(pending[0].scope);const controller=new AbortController();
    this.store.mark(key,messages.map(m=>m.id),'processing');
    const done=(async()=>{
      try{
        for(const message of messages){
          if(message.quoted?.id){const quoted=this.store.source(key,message.quoted.id);if(quoted)message.quoted={id:quoted.id,text:quoted.text,attachments:quoted.attachments};}
          for(const input of [...message.attachments,...(message.quoted?.attachments??[])]){
            if(input.handle){this.store.asset(key,input.handle);continue;}
            const bytes=input.bytes?Buffer.from(input.bytes,'base64'):await this.adapters[bot.channel].materialize(input,controller.signal);
            const asset=await this.assets.save(key,input,bytes);input.handle=asset.id;delete input.bytes;
          }
          this.store.updateMessage(key,message);
        }
        const result=await this.harness.run(binding,messages,controller.signal);
        if(controller.signal.aborted||this.store.binding(binding.scope).sessionId!==binding.sessionId){this.store.mark(key,messages.map(m=>m.id),'cancelled');return;}
        const outputs:Output[]=[];for(const output of result.outputs){if(output.type==='text'&&output.text){for(let index=0;index<output.text.length;index+=1800)outputs.push({type:'text',text:output.text.slice(index,index+1800)});}else if(output.type==='asset'){this.store.asset(key,output.assetId!);outputs.push(output);}}
        this.store.transaction(()=>{this.store.enqueue(binding,pending.at(-1)!.id,result.turnId,outputs,pending.at(-1)!.reply);this.store.mark(key,messages.map(m=>m.id),'complete');});
        await this.flushDeliveries();
      }catch(error){const state=controller.signal.aborted?'cancelled':'failed';this.store.mark(key,messages.map(m=>m.id),state);this.store.put('failure',`${binding.sessionId}:${Date.now()}`,{sessionId:binding.sessionId,scope:key,code:error instanceof Error?error.message:'PROCESS_FAILED',state});}
      finally{this.processing.delete(key);if(this.store.messages(key).length)this.schedule(key);}
    })();
    this.processing.set(key,{controller,sessionId:binding.sessionId,done});await done;
  }
  async flushDeliveries():Promise<void>{
    if(this.closed)return;
    const botIds=new Set(this.store.deliveries(['pending']).map(d=>d.botId));
    await Promise.all([...botIds].map(id=>{const active=this.senders.get(id);if(active)return active;const task=this.flushBot(id).finally(()=>this.senders.delete(id));this.senders.set(id,task);return task;}));
  }
  private async flushBot(botId:string):Promise<void>{
    while(!this.closed){
    const batch=this.store.deliveries(['pending']).filter(d=>d.botId===botId&&!this.store.deliveries(['unknown','failed']).some(old=>old.scopeKey===d.scopeKey&&old.turnId===d.turnId&&old.index<d.index));if(!batch.length)return;
    for(const d of batch){
      // An unknown earlier receipt freezes this turn, including attachments. Never replay it.
      if(this.store.deliveries(['unknown','failed']).some(old=>old.scopeKey===d.scopeKey&&old.turnId===d.turnId&&old.index<d.index))continue;
      const bot=this.store.bot(d.botId);if(!bot.enabled||bot.archived)return;const binding=this.store.get<SessionBinding>('binding',d.scopeKey);if(!binding||binding.sessionId!==d.sessionId){this.store.deliveryState(d,'cancelled');continue;}
      const credential=await this.credentials.read(bot.id);if(!credential)return;
      const asset=d.output.type==='asset'?this.store.asset(d.scopeKey,d.output.assetId!):undefined;
      this.store.deliveryState(d,'sending');
      const controller=new AbortController();this.outbound.set(d.id,{botId:bot.id,controller});
      try{const receipt=await this.adapters[bot.channel].send(bot,credential,d,asset,AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]));this.store.deliveryState(d,'sent',receipt);}catch(error){this.store.deliveryState(d,'unknown',undefined,error instanceof Error?error.message:'DELIVERY_UNKNOWN');}finally{this.outbound.delete(d.id);}
    }
    }
  }
  async close():Promise<void>{this.closed=true;for(const timer of this.timers.values())clearTimeout(timer);for(const item of this.outbound.values())item.controller.abort();for(const task of this.processing.values()){task.controller.abort();this.harness.cancel(task.sessionId);}for(const c of this.connections.values())c.controller.abort();await Promise.all([...this.connections.values()].map(c=>c.done));await Promise.all([...this.processing.values()].map(p=>p.done));await Promise.all(this.senders.values());await this.harness.dispose();if(this.claimed)this.store.releaseRuntime(this.owner);}
}
