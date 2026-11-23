import type {Context} from '@deepseek-ai/cordis';
import type {ModelSelectionRef} from '@deepseek-ai/dsh-agent';
import {createDeveloperMessage,createUserMessage} from '@deepseek-ai/dsh-llm';

/** Bind each request to the model selected when its prompt was assembled. */
export function installBotModelSelection(ctx:Context,selection:ModelSelectionRef):()=>void {
  const registerNotice=()=>ctx.on('agent/pre-step',async({signal},next)=>{
    const result=await next();if(result.kind==='reject'||signal.aborted)return result;
    return {...result,messages:result.messages.filter(message=>!['time-context','model-selection','working-directory'].includes(message.source?.kind??''))};
  },{prepend:true});
  let notice=registerNotice();
  const assembly=ctx.on('system-prompt/assemble',async(_assembly,_context,next)=>{
    const selected=selection.current,result=await next();selection.assembled=selected;
    // Web model selection can install its notice lazily, after the bot was initialized.
    notice();notice=registerNotice();
    return selected?{...result,variables:{...result.variables,provider:selected.provider,model:selected.model}}:result;
  },{prepend:true});
  const request=ctx.on('agent/request',async({agent,turn,step},next)=>{
    const result=await next(),selected=selection.assembled;
    // Replace known host additions at the real step position. Source events
    // stay intact; the active surface makes this idempotent after resumes.
    for(const seq of [...agent.session.surface.nodes]){
      const event=agent.session.eventAt(seq);if(event?.type!=='user/message')continue;
      const source=event.data.source,content=event.data.content,last=content.at(-1);
      const intent={surfaceOp:{op:'replace' as const,startSeq:seq,endSeq:seq},sourceEventSeqs:[seq]};
      if(['time-context','model-selection','working-directory'].includes(source.kind)){
        agent.session.append('developer/message',{turn,step,message:createDeveloperMessage({source,content:[]})},intent);
      }else if(source.kind==='user'&&content.length>1&&last?.type==='text'&&last.text.startsWith('Recent attachments in this session (newest first; select according to the user request and use tools to read actual content): ')){
        agent.session.append('user/message',createUserMessage({source,content:content.slice(0,-1)}),intent);
      }
    }
    if(!selected)return result;
    const {reasoningEffort:_inherited,...config}=result;
    return {...config,provider:selected.provider,model:selected.model,...selected.reasoningEffort===undefined?{}:{reasoningEffort:selected.reasoningEffort}};
  },{prepend:true});
  return()=>{assembly();request();notice();};
}
