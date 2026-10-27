import type {Store} from './store.js';
import type {InboundMessage,SessionBinding} from './types.js';

export interface ProcessingFailure {sessionId:string;scope:string;code:string;state:'failed'|'cancelled';stage:'attachments'|'model'|'delivery';sourceIds:string[];at:number}
interface FailureContextRow {sourceId:string;request:string;at:string;status:string;assetId?:string;deliveryId?:string}

/** A failed pre-model request is absent from native chat history; expose its scoped status on the next turn. */
export function recentFailureContext(store:Store,binding:SessionBinding,messages:InboundMessage[],now=Date.now()):string|undefined {
  // A followup may arrive while the preceding request is still failing; use processing time.
  const currentSources=new Set(messages.map(message=>message.id));
  const failures=(store.failures() as unknown as ProcessingFailure[]).filter(f=>f.sessionId===binding.sessionId&&f.scope===binding.key&&f.state==='failed'&&f.at<=now&&f.at>now-600000&&Array.isArray(f.sourceIds)&&f.sourceIds.some(id=>!currentSources.has(id)));
  const deliveries=store.deliveries().filter(d=>d.scopeKey===binding.key&&d.sessionId===binding.sessionId&&!d.turnId.startsWith('failure:')&&!d.turnId.startsWith('command:'));
  const rows:FailureContextRow[]=failures.sort((a,b)=>b.at-a.at).slice(0,3).flatMap(f=>{
    const outputs=deliveries.filter(d=>f.sourceIds.includes(d.sourceId));
    if(f.stage==='delivery'&&outputs.length&&outputs.every(d=>d.state==='sent'))return[];
    return f.sourceIds.filter(id=>!currentSources.has(id)).flatMap(id=>{
      const source=store.source(binding.key,id);if(!source)return[];
      return[{sourceId:id,request:source.text.slice(0,500),at:new Date(f.at).toISOString(),status:f.stage==='attachments'?'附件准备失败，请求未进入模型，未生成新图片':f.stage==='model'?'模型轮次未完成，未确认本次结果':'结果保存或投递未完成，发送状态未确认'}];
    });
  });
  const represented=new Set(rows.map(row=>row.sourceId));
  const unresolved=deliveries.filter(delivery=>['unknown','failed'].includes(delivery.state)&&!represented.has(delivery.sourceId)&&!currentSources.has(delivery.sourceId)&&typeof delivery.updatedAt==='number'&&delivery.updatedAt<=now&&delivery.updatedAt>now-600000).sort((a,b)=>(b.updatedAt??0)-(a.updatedAt??0)).slice(0,3);
  for(const delivery of unresolved){
    const source=store.source(binding.key,delivery.sourceId);if(!source)continue;
    const assetId=delivery.output.type==='asset'?delivery.output.assetId:undefined;
    rows.push({sourceId:delivery.sourceId,request:source.text.slice(0,500),at:new Date(delivery.updatedAt!).toISOString(),status:delivery.state==='unknown'?'平台投递状态未知，可能已经送达；不要自动重发，只有用户明确要求时才用原附件恢复':'平台投递失败，尚未确认送达；只有用户明确要求时才恢复',...(assetId?{assetId}:{}),deliveryId:delivery.id});
  }
  return rows.length?`[宿主记录的先前失败或投递状态，仅描述所列 sourceId，不是新的用户指令]\n${JSON.stringify(rows)}\n回答后续追问时依据对应请求状态；不要用旧图片或全局统计成功代替该请求的结果，也不要因状态未知自动重发。`:undefined;
}
