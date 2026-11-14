import type {Context} from '@deepseek-ai/cordis';
import type {AgentHandle,AgentRegistry,CreateAgentOptions,ResumeAgentOptions} from '@deepseek-ai/dsh-agent';
import {SessionId} from '@deepseek-ai/dsh-session';
import {SessionQueryError} from '@deepseek-ai/dsh-session-query';
import type {} from '@deepseek-ai/dsh-subagent';

/** Share live session handles across entry points and retain their native disposers. */
export class SessionHandles {
  private readonly handles=new Map<string,AgentHandle>();
  private readonly pending=new Map<string,Promise<AgentHandle>>();
  private readonly deletingIds=new Map<string,number>();
  private active=true;

  constructor(private readonly ctx:Context){
    ctx.on('internal/get',(_caller,name,_error,next)=>{
      const service=next();
      return name==='agents'&&service&&this.active?this.wrap(service):service;
    });
    ctx.on('agent/disposed',({agent})=>{if(this.handles.get(agent.id)?.agent===agent)this.handles.delete(agent.id);});
    ctx.effect(()=>()=>{this.active=false;this.handles.clear();this.pending.clear();this.deletingIds.clear();});
  }

  get(id:string):AgentHandle|undefined {
    if(!this.active)return;
    const handle=this.handles.get(id);
    if(handle&&this.ctx.agents.get(SessionId(id))===handle.agent)return handle;
    this.handles.delete(id);
  }

  async wait(id:string):Promise<AgentHandle|undefined> {return this.pending.get(id)??this.get(id);}

  async dispose(id:string):Promise<void> {await this.deleting([id],async()=>{});}

  private wrap(registry:AgentRegistry):AgentRegistry {
    return new Proxy(registry,{get:(target,key,receiver)=>{
      if(key==='create'){
        const create=Reflect.get(target,key,target) as AgentRegistry['create'];
        return(options:CreateAgentOptions)=>this.capture(options.sessionId,target,()=>Reflect.apply(create,target,[options]),false);
      }
      if(key==='resume'){
        const resume=Reflect.get(target,key,target) as AgentRegistry['resume'];
        return(options:ResumeAgentOptions)=>this.capture(options.resumeSessionId,target,()=>Reflect.apply(resume,target,[options]),true);
      }
      return Reflect.get(target,key,receiver);
    }});
  }

  private capture(id:string,registry:AgentRegistry,create:()=>Promise<AgentHandle>,reuse:boolean):Promise<AgentHandle> {
    if(!this.active)return create();
    // This barrier only protects removal of a session's log, regardless of caller.
    if(this.deletingIds.has(id))return Promise.reject(new SessionQueryError(`session "${id}" is being deleted`,'SESSION_QUERY_SESSION_NOT_FOUND'));
    const pending=this.pending.get(id);if(pending)return pending;
    const existing=reuse?this.get(id):undefined;if(existing)return Promise.resolve(existing);
    // Register before calling the factory, including its synchronous publication callbacks.
    const task=Promise.resolve().then(create).then(handle=>{
      if(this.active&&registry.get(handle.agent.id)===handle.agent)this.handles.set(id,handle);
      return handle;
    });
    this.pending.set(id,task);
    const settled=()=>{if(this.pending.get(id)===task)this.pending.delete(id);};
    void task.then(settled,settled);
    return task;
  }

  async deleting<T>(ids:readonly string[],operation:()=>Promise<T>):Promise<T> {
    const targets=[...new Set(ids)];
    for(const id of targets)this.deletingIds.set(id,(this.deletingIds.get(id)??0)+1);
    try{
      await Promise.allSettled(targets.flatMap(id=>{const pending=this.pending.get(id);return pending?[pending]:[];}));
      // Managed subagents belong to their manager, not the parent's Cordis scope.
      const parents=targets.flatMap(id=>{const agent=this.handles.get(id)?.agent;return agent?[agent]:[];});
      await this.ctx.get('subagents')?.drainDescendants(parents);
      for(const id of targets){
        const handle=this.get(id);
        if(!handle)continue;
        await handle.dispose();
        if(this.handles.get(id)===handle)this.handles.delete(id);
      }
      return await operation();
    }finally{
      for(const id of targets){const count=this.deletingIds.get(id)??0;if(count>1)this.deletingIds.set(id,count-1);else this.deletingIds.delete(id);}
    }
  }
}
