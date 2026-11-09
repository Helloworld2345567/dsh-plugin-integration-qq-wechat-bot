import type {DeliveryWorkerRepositories} from './ports/application.js';
import type {Credentials} from './runtime-ports.js';
import type {BotConfig,Delivery,TurnSnapshot} from './types.js';
import type {ProfileStore} from './profile-store.js';
import {permissionsRevoked} from './policy.js';
import type {ChannelRegistry} from './channel-registry.js';
import {errorCauseCode,errorCauseMessage,RemoteError,sanitizeRemoteMessage} from './network.js';
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
// A returned rejection establishes that this request did not commit. Timeouts,
// duplicate/conflict replies and server errors can follow an earlier commit.
const REJECTED_COMMIT_STATUS=new Set([400,401,403,404,405,410,413,415,422,429]);
const REJECTED_QQ_CODES=new Set(['850018','850019','850026','850031','10000','40093001','40093002']);
type DeliveryFailure={message:string;causeCode?:string;causeMessage?:string;httpStatus?:number;platformCode?:string;platformMessage?:string;platformTraceId?:string};
function failure(error:unknown):DeliveryFailure {
  const message=sanitizeRemoteMessage(error instanceof Error?error.message:error)??'DELIVERY_UNKNOWN';
  const causeCode=sanitizeRemoteMessage(errorCauseCode(error)),causeMessage=sanitizeRemoteMessage(errorCauseMessage(error));
  return{message:causeCode?`${message} [cause.code=${causeCode}]`:message,causeCode,causeMessage,
    httpStatus:error instanceof RemoteError?error.status:undefined,platformCode:error instanceof RemoteError?error.platformCode:undefined,
    platformMessage:error instanceof RemoteError?error.platformMessage:undefined,platformTraceId:error instanceof RemoteError?error.platformTraceId:undefined};
}
function terminalState(error:unknown,delivery:Delivery):'failed'|'unknown'{
  if(delivery.attempt?.phase!=='commit')return 'failed';
  if(SAFE_NOT_SENT_CAUSES.has(errorCauseCode(error)??''))return 'failed';
  if(error instanceof RemoteError&&error.platformCode==='850027')return 'unknown';
  if(error instanceof RemoteError&&error.code==='QQ_API_REJECTED'&&REJECTED_QQ_CODES.has(error.platformCode??''))return 'failed';
  if(error instanceof RemoteError&&error.status!==undefined&&REJECTED_COMMIT_STATUS.has(error.status))return 'failed';
  return 'unknown';
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
  constructor(readonly repos:DeliveryWorkerRepositories,readonly channels:ChannelRegistry,readonly credentials:Credentials,readonly wait:(milliseconds:number,signal:AbortSignal)=>Promise<void>=async(milliseconds,signal)=>{await delay(milliseconds,undefined,{signal});},readonly profiles?:ProfileStore,readonly accepting:()=>boolean=()=>true){}
  async flush(filter?:{botId?:string}):Promise<void>{
    if(this.closed||!this.accepting())return;
    const ids=filter?.botId?[filter.botId]:this.repos.deliveries.pendingBotIds();
    await Promise.all(ids.map(botId=>this.startLane(botId)));
  }
  async retry(deliveryId:string):Promise<void>{
    if(this.closed||!this.accepting())return;
    const delivery=this.repos.deliveries.retry(deliveryId);
    if(delivery)await this.flush({botId:delivery.botId});
  }
  cancelScope(scopeKey:string,_reason='任务已取消'):void{for(const item of this.outbound.values())if(item.scopeKey===scopeKey)item.controller.abort();}
  cancelBot(botId:string,_reason='机器人已停用'):void{for(const item of this.outbound.values())if(item.botId===botId)item.controller.abort();}
  registerProgress(runId:string,active:()=>boolean):void{this.progressRuns.set(runId,active);}
  cancelProgress(runId:string):void{
    this.progressRuns.delete(runId);
    for(const item of this.outbound.values())if(item.runId===runId)item.controller.abort();
    for(const delivery of this.repos.deliveries.deliveries(['pending']))if(delivery.purpose==='progress'&&delivery.progress?.runId===runId)this.repos.deliveries.deliveryState(delivery,'cancelled');
  }
  private progressActive(delivery:Delivery):boolean{
    if(delivery.purpose!=='progress')return true;
    const progress=delivery.progress,binding=this.repos.sessions.findBinding(delivery.scopeKey);
    return !!progress&&progress.expiresAt>Date.now()&&binding?.sessionId===delivery.sessionId&&binding.generation===progress.generation&&this.progressRuns.get(progress.runId)?.()===true;
  }
  private contextActive(delivery:Delivery):boolean {
    const binding=this.repos.sessions.findBinding(delivery.scopeKey);if(!binding||binding.sessionId!==delivery.sessionId||delivery.sessionGeneration!==undefined&&binding.generation!==delivery.sessionGeneration)return false;
    if(delivery.turnContext){const frozen=this.repos.personas.configVersion(delivery.turnContext.personaId,delivery.turnContext.personaRevision);let current:BotConfig|undefined;try{current=this.repos.personas.effectiveConfig(binding);}catch{}if(!frozen||!current||permissionsRevoked({config:frozen,personaId:delivery.turnContext.personaId,personaRevision:delivery.turnContext.personaRevision,services:{},botId:delivery.botId,trusted:delivery.turnContext.trusted,sourceIds:[delivery.sourceId],startedAt:delivery.createdAt??0} satisfies TurnSnapshot,current,this.repos.bots.bot(delivery.botId),binding.scope,this.profiles))return false;}
    const snapshots=[...(delivery.turnContext?.serviceSnapshots??[])];if(delivery.output.type==='asset'){const asset=this.repos.media.assets.asset(delivery.scopeKey,delivery.output.assetId!);if(asset.serviceSnapshot&&!snapshots.some(item=>item.serviceId===asset.serviceSnapshot!.serviceId&&item.profileId===asset.serviceSnapshot!.profileId&&item.profileRevision===asset.serviceSnapshot!.profileRevision&&item.profileContentHash===asset.serviceSnapshot!.profileContentHash))snapshots.push(asset.serviceSnapshot);}
    return !this.profiles||snapshots.every(snapshot=>['ready','partial'].includes(this.profiles!.snapshotStatus(snapshot).state));
  }
  activity():DeliveryWorkerActivity{return{activeLanes:this.lanes.size,inFlight:this.outbound.size};}
  private startLane(botId:string):Promise<void>{const active=this.lanes.get(botId);if(active)return active;const task=this.flushBot(botId).finally(()=>{if(this.lanes.get(botId)===task)this.lanes.delete(botId);});this.lanes.set(botId,task);return task;}
  private async flushBot(botId:string):Promise<void>{
    while(!this.closed&&this.accepting()){
      const repository=this.repos.deliveries;const batch=repository.nextSendable(botId,100);if(!batch.length)return;
      for(const delivery of batch){
        if(this.closed||!this.accepting())return;
        if(repository.hasEarlierBlocker(delivery))continue;
        const current=repository.find(delivery.id,'pending');if(!current)continue;
        if(!this.progressActive(delivery)){this.repos.deliveries.deliveryState(delivery,'cancelled');continue;}
        const controller=new AbortController();
        const progressTimer=delivery.purpose==='progress'?setTimeout(()=>controller.abort(new Error('PROGRESS_SEND_TIMEOUT')),Math.min(PROGRESS_SEND_MS,delivery.progress!.expiresAt-Date.now())):undefined;
        this.outbound.set(delivery.id,{botId,scopeKey:delivery.scopeKey,runId:delivery.progress?.runId,controller});
        try{
          const bot=this.repos.bots.bot(delivery.botId);if(!bot.enabled||bot.archived){for(const item of batch){const pending=repository.find(item.id,'pending');if(pending)this.repos.deliveries.deliveryState(pending,'cancelled');}return;}
          if(!this.contextActive(delivery)){this.repos.deliveries.deliveryState(delivery,'cancelled');continue;}
          const credentialRead=this.credentials.read(bot.id);
          const rawCredential=await (delivery.purpose==='progress'?abortable(credentialRead,controller.signal):credentialRead);if(!rawCredential)return;
          const definition=this.channels.require(bot.channel);const normalized=definition.normalizeCredential?.(rawCredential);const credential=normalized?.credential as any??rawCredential;
          if((normalized?.accountId??credential.accountId)!==bot.accountId)throw Error('CHANNEL_CREDENTIAL_ACCOUNT_MISMATCH');
          if(this.closed||!this.accepting())return;
          if(!repository.find(delivery.id,'pending'))continue;
          const currentBot=this.repos.bots.bot(delivery.botId);if(!currentBot.enabled||currentBot.archived){this.repos.deliveries.deliveryState(delivery,'cancelled');for(const item of batch){const pending=repository.find(item.id,'pending');if(pending)this.repos.deliveries.deliveryState(pending,'cancelled');}return;}
          if(!this.contextActive(delivery)){this.repos.deliveries.deliveryState(delivery,'cancelled');continue;}
          if(!this.progressActive(delivery)||controller.signal.aborted){this.repos.deliveries.deliveryState(delivery,'cancelled');continue;}
          const asset=delivery.output.type==='asset'?this.repos.media.assets.asset(delivery.scopeKey,delivery.output.assetId!):undefined;
          const envelope=definition.normalizeReply?.(delivery.replyEnvelope??delivery.reply);
          let sending:Delivery={...delivery,...(envelope?{replyEnvelope:envelope,reply:envelope.payload}: {}),...(delivery.attempt?{attempt:{...delivery.attempt,autoRetryCount:undefined}}:{})};
          const resultDelivery=delivery.purpose!=='progress';
          const metricId=`inbox:${delivery.scopeKey}:${delivery.sourceId}`;if(resultDelivery&&this.repos.telemetry.metrics.findTurnMetric(metricId))this.repos.telemetry.metrics.updateTurnMetric(metricId,{deliveryStartedAt:Date.now()});
          while(true){
            if(this.closed||!this.accepting())return;
            const attempt:NonNullable<Delivery['attempt']>={...sending.attempt,number:(sending.attempt?.number??0)+1,phase:'prepare',assetId:asset?.id,startedAt:Date.now()};
            sending={...sending,attempt};this.repos.deliveries.deliveryState(sending,'sending');
            try{
              // Multipart media can exceed 90 seconds at normal upload speeds.
              // Each adapter request still has its own shorter network timeout.
              const sendTimeout=asset?15*60_000:90_000;
              const sendSignal=resultDelivery?AbortSignal.any([controller.signal,AbortSignal.timeout(sendTimeout)]):controller.signal;
              if(this.closed||!this.accepting())return;
              if(!this.contextActive(delivery))throw Error('DELIVERY_CONTEXT_REVOKED');
              const send=definition.adapter.send(bot,credential,sending,asset,sendSignal);
              const receipt=await (resultDelivery?send:abortable(send,sendSignal));
              this.repos.deliveries.deliveryState(sending,'sent',receipt);if(resultDelivery){if(this.repos.telemetry.metrics.findTurnMetric(metricId))this.repos.telemetry.metrics.updateTurnMetric(metricId,{sentAt:Date.now()});this.repos.telemetry.metrics.updateTurnMetricsByTurn(delivery.scopeKey,delivery.turnId,{sentAt:Date.now()});}break;
            }catch(error){
              const {message,...detail}=failure(error);attempt.lastError=message;Object.assign(attempt,detail);
              const retryCount=attempt.autoRetryCount??0;
              if(!controller.signal.aborted&&!this.closed&&this.accepting()&&retryCount<AUTO_RETRY_LIMIT&&mayAutoRetry(error,sending)){
                attempt.autoRetryCount=retryCount+1;this.repos.deliveries.deliveryState(sending,'sending',undefined,attempt.lastError);
                try{await this.wait(AUTO_RETRY_DELAYS[retryCount]??AUTO_RETRY_DELAYS.at(-1)!,controller.signal);}catch{this.repos.deliveries.deliveryState(sending,terminalState(error,sending),undefined,attempt.lastError);break;}
                continue;
              }
              this.repos.deliveries.deliveryState(sending,terminalState(error,sending),undefined,attempt.lastError);break;
            }
          }
        }catch(error){
          const pending=repository.find(delivery.id,'pending');if(!pending)continue;
          this.repos.deliveries.deliveryState(pending,'failed',undefined,failure(error).message);
        }finally{if(progressTimer)clearTimeout(progressTimer);this.outbound.delete(delivery.id);}
      }
    }
  }
  async drain():Promise<void>{while(this.lanes.size)await Promise.all([...this.lanes.values()]);}
  async close():Promise<void>{this.closed=true;this.progressRuns.clear();for(const item of this.outbound.values())item.controller.abort();await this.drain();}
}
