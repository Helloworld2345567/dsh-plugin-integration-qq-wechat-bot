import type {Context} from '@deepseek-ai/cordis';
import type {AgentHandle,AgentRegistry,CreateAgentOptions,ResumeAgentOptions} from '@deepseek-ai/dsh-agent';
import {SessionQueryError} from '@deepseek-ai/dsh-session-query';
import type {} from '@deepseek-ai/dsh-subagent';

/** Retain the real handles returned through public Agent creation, including Web-owned sessions. */
export class SessionOwners {
  private readonly handles=new Map<string,AgentHandle>();
  private readonly pending=new Map<string,Set<Promise<AgentHandle>>>();
  private readonly blocked=new Map<string,number>();
  private active=true;

  constructor(private readonly ctx:Context){
    ctx.on('internal/get',(_caller,name,_error,next)=>{
      const service=next();
      return name==='agents'&&service&&this.active?this.wrap(service):service;
    });
    ctx.on('agent/disposed',({agent})=>{if(this.handles.get(agent.id)?.agent===agent)this.handles.delete(agent.id);});
    ctx.effect(()=>()=>{this.active=false;this.handles.clear();this.pending.clear();this.blocked.clear();});
  }

  private wrap(registry:AgentRegistry):AgentRegistry {
    return new Proxy(registry,{get:(target,key,receiver)=>{
      if(key==='create'){
        const create=Reflect.get(target,key,target) as AgentRegistry['create'];
        return(options:CreateAgentOptions)=>this.capture(options.sessionId,target,()=>Reflect.apply(create,target,[options]));
      }
      if(key==='resume'){
        const resume=Reflect.get(target,key,target) as AgentRegistry['resume'];
        return(options:ResumeAgentOptions)=>this.capture(options.resumeSessionId,target,()=>Reflect.apply(resume,target,[options]));
      }
      return Reflect.get(target,key,receiver);
    }});
  }

  private capture(id:string,registry:AgentRegistry,create:()=>Promise<AgentHandle>):Promise<AgentHandle> {
    if(!this.active)return create();
    if(this.blocked.has(id))return Promise.reject(new SessionQueryError(`session "${id}" is being deleted`,'SESSION_QUERY_SESSION_NOT_FOUND'));
    const pending=this.pending.get(id)??new Set<Promise<AgentHandle>>();
    this.pending.set(id,pending);
    // Register before calling the factory, including its synchronous publication callbacks.
    const task=Promise.resolve().then(create).then(handle=>{
      if(this.active&&registry.get(handle.agent.id)===handle.agent)this.handles.set(id,handle);
      return handle;
    });
    pending.add(task);
    const settled=()=>{pending.delete(task);if(!pending.size&&this.pending.get(id)===pending)this.pending.delete(id);};
    void task.then(settled,settled);
    return task;
  }

  async deleting<T>(ids:readonly string[],operation:()=>Promise<T>):Promise<T> {
    const targets=[...new Set(ids)];
    for(const id of targets)this.blocked.set(id,(this.blocked.get(id)??0)+1);
    try{
      await Promise.allSettled(targets.flatMap(id=>[...this.pending.get(id)??[]]));
      // Managed subagents belong to their manager, not the parent's Cordis scope.
      const parents=targets.flatMap(id=>{const agent=this.handles.get(id)?.agent;return agent?[agent]:[];});
      await this.ctx.get('subagents')?.drainDescendants(parents);
      for(const id of targets){
        const handle=this.handles.get(id);
        if(!handle)continue;
        await handle.dispose();
        if(this.handles.get(id)===handle)this.handles.delete(id);
      }
      return await operation();
    }finally{
      for(const id of targets){const count=this.blocked.get(id)??0;if(count>1)this.blocked.set(id,count-1);else this.blocked.delete(id);}
    }
  }
}
