import type {Store} from './store.js';
import type {Credentials} from './runtime-ports.js';
import type {Delivery} from './types.js';
import type {ChannelRegistry} from './channel-registry.js';
import {errorCauseCode,errorCauseMessage,RemoteError} from './network.js';
import {setTimeout as delay} from 'node:timers/promises';
import {abortable,PROGRESS_SEND_MS} from './progress.js';

export interface DeliveryWorkerActivity {activeLanes:number;inFlight:number}
export interface DeliveryWorker {
  flush(filter?:{botId?:string}):Promise<void>;
  /** Requeue an existing failed/unknown delivery without changing its ID. */
  retry(deliveryId:string):Promise<void>;
  cancelScope(scopeKey:string,reason?:string):void;
  cancelBot(botId:string,reason?:string):void;
  registerProgress(runId:string,active:()=>boolean):void;
  cancelProgress(runId:string):void;
  drain():Promise<void>;
  close():Promise<void>;
  activity():DeliveryWorkerActivity;
}

const AUTO_RETRY_LIMIT=2;
const AUTO_RETRY_DELAYS=[1000,2000] as const;
const SAFE_NOT_SENT_CAUSES=new Set(['EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','ECONNREFUSED','ENOTFOUND','UND_ERR_CONNECT_TIMEOUT','UND_ERR_DNS']);
const RETRYABLE_PRECOMMIT_STATUS=new Set([408,425,429,500,502,503,504]);
type DeliveryFailure={message:string;causeCode?:string;causeMessage?:string};
function failure(error:unknown):DeliveryFailure {
  const message=error instanceof Error?error.message:typeof error==='string'?error:'DELIVERY_UNKNOWN';
  const causeCode=errorCauseCode(error);const causeMessage=errorCauseMessage(error);
  return{message:causeCode?`${message} [cause.code=${causeCode}]`:message,causeCode,causeMessage};
}
function mayAutoRetry(error:unknown,delivery:Delivery):boolean {
  if(delivery.purpose==='progress')return false;
  const causeCode=errorCauseCode(error);
  if(causeCode&&SAFE_NOT_SENT_CAUSES.has(causeCode))return true;
  if(delivery.attempt?.phase==='commit')return false;
  return error instanceof RemoteError&&error.status!==undefined&&RETRYABLE_PRECOMMIT_STATUS.has(error.status);
}

/**
 * Durable outbox worker. The lane is per bot during this extraction; changing
 * that concurrency policy belongs to a separate performance slice.
 */
export class DurableDeliveryWorker implements DeliveryWorker {
  private readonly lanes=new Map<string,Promise<void>>();
  private readonly outbound=new Map<string,{botId:string;scopeKey:string;runId?:string;controller:AbortController}>();
  private readonly progressRuns=new Map<string,()=>boolean>();
  private closed=false;
  constructor(readonly store:Store,readonly channels:ChannelRegistry,readonly credentials:Credentials,readonly wait:(milliseconds:number,signal:AbortSignal)=>Promise<void>=async(milliseconds,signal)=>{await delay(milliseconds,undefined,{signal});}){}
  async flush(filter?:{botId?:string}):Promise<void>{
    if(this.closed)return;
    const ids=filter?.botId?[filter.botId]:this.store.deliveryRepository().pendingBotIds();
    await Promise.all(ids.map(botId=>this.startLane(botId)));
  }
  async retry(deliveryId:string):Promise<void>{
    if(this.closed)return;
    const delivery=this.store.retryDelivery(deliveryId);
    if(delivery)await this.flush({botId:delivery.botId});
  }
  cancelScope(scopeKey:string,_reason='任务已取消'):void{for(const item of this.outbound.values())if(item.scopeKey===scopeKey)item.controller.abort();}
  cancelBot(botId:string,_reason='机器人已停用'):void{for(const item of this.outbound.values())if(item.botId===botId)item.controller.abort();}
  registerProgress(runId:string,active:()=>boolean):void{this.progressRuns.set(runId,active);}
  cancelProgress(runId:string):void{
    this.progressRuns.delete(runId);
    for(const item of this.outbound.values())if(item.runId===runId)item.controller.abort();
    for(const delivery of this.store.deliveries(['pending']))if(delivery.purpose==='progress'&&delivery.progress?.runId===runId)this.store.deliveryState(delivery,'cancelled');
  }
  private progressActive(delivery:Delivery):boolean{
    if(delivery.purpose!=='progress')return true;
    const progress=delivery.progress,binding=this.store.findBinding(delivery.scopeKey);
    return !!progress&&progress.expiresAt>Date.now()&&binding?.sessionId===delivery.sessionId&&binding.generation===progress.generation&&this.progressRuns.get(progress.runId)?.()===true;
  }
  activity():DeliveryWorkerActivity{return{activeLanes:this.lanes.size,inFlight:this.outbound.size};}
  private startLane(botId:string):Promise<void>{const active=this.lanes.get(botId);if(active)return active;const task=this.flushBot(botId).finally(()=>{if(this.lanes.get(botId)===task)this.lanes.delete(botId);});this.lanes.set(botId,task);return task;}
  private async flushBot(botId:string):Promise<void>{
    while(!this.closed){
      const repository=this.store.deliveryRepository();const batch=repository.nextSendable(botId,100);if(!batch.length)return;
      for(const delivery of batch){
        if(this.closed)return;
        if(repository.hasEarlierBlocker(delivery))continue;
        const current=repository.find(delivery.id,'pending');if(!current)continue;
        if(!this.progressActive(delivery)){this.store.deliveryState(delivery,'cancelled');continue;}
        const controller=new AbortController();
        const progressTimer=delivery.purpose==='progress'?setTimeout(()=>controller.abort(new Error('PROGRESS_SEND_TIMEOUT')),Math.min(PROGRESS_SEND_MS,delivery.progress!.expiresAt-Date.now())):undefined;
        this.outbound.set(delivery.id,{botId,scopeKey:delivery.scopeKey,runId:delivery.progress?.runId,controller});
        try{
          const bot=this.store.bot(delivery.botId);if(!bot.enabled||bot.archived)return;
          const binding=this.store.findBinding(delivery.scopeKey);if(!binding||binding.sessionId!==delivery.sessionId){this.store.deliveryState(delivery,'cancelled');continue;}
          const credentialRead=this.credentials.read(bot.id);
          const rawCredential=await (delivery.purpose==='progress'?abortable(credentialRead,controller.signal):credentialRead);if(!rawCredential)return;
          const definition=this.channels.require(bot.channel);const normalized=definition.normalizeCredential?.(rawCredential);const credential=normalized?.credential as any??rawCredential;
          if((normalized?.accountId??credential.accountId)!==bot.accountId)throw Error('CHANNEL_CREDENTIAL_ACCOUNT_MISMATCH');
          if(this.closed||!repository.find(delivery.id,'pending'))continue;
          const currentBot=this.store.bot(delivery.botId);if(!currentBot.enabled||currentBot.archived)return;
          if(this.store.findBinding(delivery.scopeKey)?.sessionId!==delivery.sessionId){this.store.deliveryState(delivery,'cancelled');continue;}
          if(!this.progressActive(delivery)||controller.signal.aborted){this.store.deliveryState(delivery,'cancelled');continue;}
          const asset=delivery.output.type==='asset'?this.store.asset(delivery.scopeKey,delivery.output.assetId!):undefined;
          const envelope=definition.normalizeReply?.(delivery.replyEnvelope??delivery.reply);
          let sending:Delivery={...delivery,...(envelope?{replyEnvelope:envelope,reply:envelope.payload}: {})};
          const resultDelivery=delivery.purpose!=='progress';
          const metricId=`inbox:${delivery.scopeKey}:${delivery.sourceId}`;if(resultDelivery&&this.store.findTurnMetric(metricId))this.store.updateTurnMetric(metricId,{deliveryStartedAt:Date.now()});
          while(true){
            const attempt:NonNullable<Delivery['attempt']>={...sending.attempt,number:(sending.attempt?.number??0)+1,phase:'prepare',assetId:asset?.id,startedAt:Date.now()};
            sending={...sending,attempt};this.store.deliveryState(sending,'sending');
            try{
              const sendSignal=resultDelivery?AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]):controller.signal;
              const send=definition.adapter.send(bot,credential,sending,asset,sendSignal);
              const receipt=await (resultDelivery?send:abortable(send,sendSignal));
              this.store.deliveryState(sending,'sent',receipt);if(resultDelivery){if(this.store.findTurnMetric(metricId))this.store.updateTurnMetric(metricId,{sentAt:Date.now()});this.store.updateTurnMetricsByTurn(delivery.scopeKey,delivery.turnId,{sentAt:Date.now()});}break;
            }catch(error){
              const detail=failure(error);attempt.lastError=detail.message;attempt.causeCode=detail.causeCode;attempt.causeMessage=detail.causeMessage;
              const retryCount=attempt.autoRetryCount??0;
              if(retryCount<AUTO_RETRY_LIMIT&&mayAutoRetry(error,sending)){
                attempt.autoRetryCount=retryCount+1;this.store.deliveryState(sending,'sending',undefined,attempt.lastError);
                try{await this.wait(AUTO_RETRY_DELAYS[retryCount]??AUTO_RETRY_DELAYS.at(-1)!,controller.signal);}catch{this.store.deliveryState(sending,'unknown',undefined,attempt.lastError);}
                if(this.store.deliveryRepository().find(delivery.id,'unknown'))break;
                continue;
              }
              this.store.deliveryState(sending,'unknown',undefined,attempt.lastError);break;
            }
          }
        }catch(error){
          const pending=repository.find(delivery.id,'pending');if(!pending)continue;
          this.store.deliveryState(pending,'failed',undefined,error instanceof Error?error.message:'DELIVERY_PREPARATION_FAILED');
        }finally{if(progressTimer)clearTimeout(progressTimer);this.outbound.delete(delivery.id);}
      }
    }
  }
  async drain():Promise<void>{while(this.lanes.size)await Promise.all([...this.lanes.values()]);}
  async close():Promise<void>{this.closed=true;this.progressRuns.clear();for(const item of this.outbound.values())item.controller.abort();await this.drain();}
}
