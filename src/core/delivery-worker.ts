import type {Store} from './store.js';
import type {Credentials} from './runtime-ports.js';
import type {Asset,Delivery,SessionBinding} from './types.js';
import type {ChannelRegistry} from './channel-registry.js';

export interface DeliveryWorkerActivity {activeLanes:number;inFlight:number}
export interface DeliveryWorker {
  flush(filter?:{botId?:string}):Promise<void>;
  cancelScope(scopeKey:string,reason?:string):void;
  cancelBot(botId:string,reason?:string):void;
  drain():Promise<void>;
  close():Promise<void>;
  activity():DeliveryWorkerActivity;
}

/**
 * Durable outbox worker. The lane is per bot during this extraction; changing
 * that concurrency policy belongs to a separate performance slice.
 */
export class DurableDeliveryWorker implements DeliveryWorker {
  private readonly lanes=new Map<string,Promise<void>>();
  private readonly outbound=new Map<string,{botId:string;scopeKey:string;controller:AbortController}>();
  private closed=false;
  constructor(readonly store:Store,readonly channels:ChannelRegistry,readonly credentials:Credentials){}
  async flush(filter?:{botId?:string}):Promise<void>{
    if(this.closed)return;
    const ids=filter?.botId?[filter.botId]:this.store.deliveryRepository().pendingBotIds();
    await Promise.all(ids.map(botId=>this.startLane(botId)));
  }
  cancelScope(scopeKey:string,_reason='任务已取消'):void{for(const item of this.outbound.values())if(item.scopeKey===scopeKey)item.controller.abort();}
  cancelBot(botId:string,_reason='机器人已停用'):void{for(const item of this.outbound.values())if(item.botId===botId)item.controller.abort();}
  activity():DeliveryWorkerActivity{return{activeLanes:this.lanes.size,inFlight:this.outbound.size};}
  private startLane(botId:string):Promise<void>{const active=this.lanes.get(botId);if(active)return active;const task=this.flushBot(botId).finally(()=>{if(this.lanes.get(botId)===task)this.lanes.delete(botId);});this.lanes.set(botId,task);return task;}
  private async flushBot(botId:string):Promise<void>{
    while(!this.closed){
      const repository=this.store.deliveryRepository();const batch=repository.nextSendable(botId,100);if(!batch.length)return;
      for(const delivery of batch){
        if(this.closed)return;
        if(repository.hasEarlierBlocker(delivery))continue;
        const current=repository.find(delivery.id,'pending');if(!current)continue;
        try{
          const bot=this.store.bot(delivery.botId);if(!bot.enabled||bot.archived)continue;
          const binding=this.store.findBinding(delivery.scopeKey);if(!binding||binding.sessionId!==delivery.sessionId){this.store.deliveryState(delivery,'cancelled');continue;}
          const rawCredential=await this.credentials.read(bot.id);if(!rawCredential)return;
          const definition=this.channels.require(bot.channel);const normalized=definition.normalizeCredential?.(rawCredential);const credential=normalized?.credential as any??rawCredential;
          if((normalized?.accountId??credential.accountId)!==bot.accountId)throw Error('CHANNEL_CREDENTIAL_ACCOUNT_MISMATCH');
          if(this.closed||!repository.find(delivery.id,'pending'))continue;
          const currentBot=this.store.bot(delivery.botId);if(!currentBot.enabled||currentBot.archived)continue;
          if(this.store.findBinding(delivery.scopeKey)?.sessionId!==delivery.sessionId){this.store.deliveryState(delivery,'cancelled');continue;}
          const asset=delivery.output.type==='asset'?this.store.asset(delivery.scopeKey,delivery.output.assetId!):undefined;
          const envelope=definition.normalizeReply?.(delivery.replyEnvelope??delivery.reply);const normalizedDelivery=envelope?{...delivery,replyEnvelope:envelope,reply:envelope.payload}:delivery;
          this.store.deliveryState(delivery,'sending');const controller=new AbortController();this.outbound.set(delivery.id,{botId,scopeKey:delivery.scopeKey,controller});
          try{
            const metricId=`inbox:${delivery.scopeKey}:${delivery.sourceId}`;if(this.store.findTurnMetric(metricId))this.store.updateTurnMetric(metricId,{deliveryStartedAt:Date.now()});
            const receipt=await definition.adapter.send(bot,credential,normalizedDelivery,asset,AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]));
            this.store.deliveryState(delivery,'sent',receipt);if(this.store.findTurnMetric(metricId))this.store.updateTurnMetric(metricId,{sentAt:Date.now()});this.store.updateTurnMetricsByTurn(delivery.scopeKey,delivery.turnId,{sentAt:Date.now()});
          }catch(error){this.store.deliveryState(delivery,'unknown',undefined,error instanceof Error?error.message:'DELIVERY_UNKNOWN');}
          finally{this.outbound.delete(delivery.id);}
        }catch(error){
          const pending=repository.find(delivery.id,'pending');if(!pending)continue;
          this.store.deliveryState(pending,'failed',undefined,error instanceof Error?error.message:'DELIVERY_PREPARATION_FAILED');
        }
      }
    }
  }
  async drain():Promise<void>{while(this.lanes.size)await Promise.all([...this.lanes.values()]);}
  async close():Promise<void>{this.closed=true;for(const item of this.outbound.values())item.controller.abort();await this.drain();}
}
