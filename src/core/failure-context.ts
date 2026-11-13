import type {InboundMessage,SessionBinding} from './types.js';
import type {FailureRepository} from './ports/telemetry.js';
import type {DeliveryRepository} from './ports/delivery.js';
import type {InboxRepository} from './ports/inbox.js';

export interface ProcessingFailure {sessionId:string;scope:string;code:string;state:'failed'|'cancelled';stage:'attachments'|'model'|'delivery';sourceIds:string[];at:number}
interface FailureContextRow {sourceId:string;request:string;at:string;status:string;assetId?:string}

export interface FailureContextPorts {
  failures: FailureRepository;
  deliveries: DeliveryRepository;
  inbox: InboxRepository;
}

/** A failed pre-model request is absent from native chat history; expose its scoped status on the next turn. */
export function recentFailureContext(ports:FailureContextPorts,binding:SessionBinding,messages:InboundMessage[],now=Date.now()):string|undefined {
  // A followup may arrive while the preceding request is still failing; use processing time.
  const currentSources=new Set(messages.map(message=>message.id));
  const failures=(ports.failures.failures() as unknown as ProcessingFailure[]).filter(f=>f.sessionId===binding.sessionId&&f.scope===binding.key&&f.state==='failed'&&f.stage!=='model'&&f.at<=now&&f.at>now-600000&&Array.isArray(f.sourceIds)&&f.sourceIds.some(id=>!currentSources.has(id)));
  const deliveries=ports.deliveries.deliveries().filter(d=>d.purpose!=='progress'&&d.scopeKey===binding.key&&d.sessionId===binding.sessionId&&!d.turnId.startsWith('failure:')&&!d.turnId.startsWith('command:'));
  const rows:FailureContextRow[]=failures.sort((a,b)=>b.at-a.at).slice(0,3).flatMap(f=>{
    const outputs=deliveries.filter(d=>f.sourceIds.includes(d.sourceId));
    if(f.stage==='delivery'&&outputs.length&&outputs.every(d=>d.state==='sent'))return[];
    return f.sourceIds.filter(id=>!currentSources.has(id)).flatMap(id=>{
      const source=ports.inbox.source(binding.key,id);if(!source)return[];
      return[{sourceId:id,request:source.text.slice(0,500),at:new Date(f.at).toISOString(),status:f.stage==='attachments'?'Attachment preparation failed; the request did not reach the model and no new image was generated':'Result persistence or delivery did not complete; delivery status is unconfirmed'}];
    });
  });
  const represented=new Set(rows.map(row=>row.sourceId));
  const unresolved=deliveries.filter(delivery=>['unknown','failed'].includes(delivery.state)&&!represented.has(delivery.sourceId)&&!currentSources.has(delivery.sourceId)&&typeof delivery.updatedAt==='number'&&delivery.updatedAt<=now&&delivery.updatedAt>now-600000).sort((a,b)=>(b.updatedAt??0)-(a.updatedAt??0)).slice(0,3);
  for(const delivery of unresolved){
    const source=ports.inbox.source(binding.key,delivery.sourceId);if(!source)continue;
    const assetId=delivery.output.type==='asset'?delivery.output.assetId:undefined;
    // Recovery preserves the last persisted phase, which may predate a commit.
    const beforeCommit=delivery.state==='failed'&&(delivery.attempt?.phase==='prepare'||delivery.attempt?.phase==='upload');
    const status=beforeCommit?'Attachment upload or delivery preparation failed; the message was not committed or delivered. Wait for an explicit user retry request':delivery.state==='unknown'?'Platform delivery status is unknown and receipt is unconfirmed; it may already have arrived. Do not resend automatically':'Platform delivery failed and the message was not delivered. Wait for an explicit user retry request';
    rows.push({sourceId:delivery.sourceId,request:source.text.slice(0,500),at:new Date(delivery.updatedAt!).toISOString(),status,...(assetId?{assetId}:{})});
  }
  return rows.length?`[Host-recorded prior failure or delivery status for the listed requests; not new user instructions]\n${JSON.stringify(rows.map(({sourceId,...row})=>row))}\nAnswer follow-up questions using the corresponding request status. Generated, registered or queued does not mean delivered, and success of another request does not establish this result. Reuse the corresponding assetId only when the user explicitly requests a retry; a queued retry still does not mean successful delivery.`:undefined;
}
