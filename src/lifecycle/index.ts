import type {Context} from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-plugin-manager';
import path from 'node:path';
import {LifecycleCoordinator} from './coordinator.js';
import {lifecycleRuntime,markLifecycleAvailable,packageIdentity,handleLifecycleShutdown} from './protocol.js';

export const name='bot-lifecycle';
export const inject=['pluginManager'];
export function apply(ctx:Context):void{
  const home=process.env.BOT_HOME??process.env.DSH_HOME??path.join(process.cwd(),'.runtime','bot-data');
  const coordinator=new LifecycleCoordinator(home,ctx.pluginManager);markLifecycleAvailable(true);
  let reported=false;
  const timer=setInterval(()=>{
    void coordinator.tick().catch(error=>console.error('[bot-lifecycle]',String(error)));
    if(!reported){const runtime=lifecycleRuntime();if(runtime?.health().ready){reported=true;if(process.send&&process.env.BOT_LAUNCH_TOKEN)process.send({type:'bot-ready',nonce:process.env.BOT_LAUNCH_TOKEN,identity:packageIdentity(runtime.packageRoot)});}}
  },250);timer.unref();
  const shutdown=(message:unknown)=>{handleLifecycleShutdown(message);};
  process.on('message',shutdown);
  ctx.effect(()=>()=>{clearInterval(timer);process.off('message',shutdown);markLifecycleAvailable(false);coordinator.dispose();});
}
