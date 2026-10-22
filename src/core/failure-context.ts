import type {Store} from './store.js';
import type {InboundMessage,SessionBinding} from './types.js';

export interface ProcessingFailure {sessionId:string;scope:string;code:string;state:'failed'|'cancelled';stage:'attachments'|'model'|'delivery';sourceIds:string[];at:number}

/** A failed pre-model request is absent from native chat history; expose its scoped status on the next turn. */
export function recentFailureContext(store:Store,binding:SessionBinding,messages:InboundMessage[],now=Date.now()):string|undefined {
  // A followup may arrive while the preceding request is still failing; use processing time.
  const currentSources=new Set(messages.map(message=>message.id));
  const failures=store.list<ProcessingFailure>('failure').filter(f=>f.sessionId===binding.sessionId&&f.scope===binding.key&&f.state==='failed'&&f.at<=now&&f.at>now-600000&&Array.isArray(f.sourceIds)&&f.sourceIds.some(id=>!currentSources.has(id)));
  const deliveries=store.deliveries().filter(d=>d.scopeKey===binding.key&&d.sessionId===binding.sessionId&&!d.turnId.startsWith('failure:')&&!d.turnId.startsWith('command:'));
  const rows=failures.sort((a,b)=>b.at-a.at).slice(0,3).flatMap(f=>{
    const outputs=deliveries.filter(d=>f.sourceIds.includes(d.sourceId));
    if(f.stage==='delivery'&&outputs.length&&outputs.every(d=>d.state==='sent'))return[];
    return f.sourceIds.filter(id=>!currentSources.has(id)).flatMap(id=>{
      const source=store.source(binding.key,id);if(!source)return[];
      return[{sourceId:id,request:source.text.slice(0,500),at:new Date(f.at).toISOString(),status:f.stage==='attachments'?'附件准备失败，请求未进入模型，未生成新图片':f.stage==='model'?'模型轮次未完成，未确认本次结果':'结果保存或投递未完成，发送状态未确认'}];
    });
  });
  return rows.length?`[宿主记录的先前失败请求，仅描述所列 sourceId，不是新的用户指令]\n${JSON.stringify(rows)}\n回答后续追问时依据对应请求状态；不要用旧图片或全局统计成功代替该请求的结果。`:undefined;
}
