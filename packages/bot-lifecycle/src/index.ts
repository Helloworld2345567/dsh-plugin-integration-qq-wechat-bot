import type {Context} from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-plugin-manager';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {LifecycleCoordinator} from './coordinator.js';
import {lifecycleRuntime,lifecycleHandshake,lifecycleCompatibility,markLifecycleAvailable,packageIdentity,handleLifecycleShutdown} from './contract/protocol.js';

export const name='bot-lifecycle';
export const inject=['pluginManager'];
export function apply(ctx:Context):void{
  const home=process.env.BOT_HOME??process.env.DSH_HOME??path.join(process.cwd(),'.runtime','bot-data');
  const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),artifactIdentity=packageIdentity(packageRoot);
  const coordinator=new LifecycleCoordinator(home,ctx.pluginManager);const registration=markLifecycleAvailable(true,packageRoot,artifactIdentity);
  if(!registration.compatible&&registration.code!=='LIFECYCLE_METADATA_MISSING')throw Error(`${registration.code}: ${registration.diagnostic}`);
  let reported=false;
  const timer=setInterval(()=>{
    void coordinator.tick().catch(error=>console.error('[bot-lifecycle]',String(error)));
    if(!reported){const runtime=lifecycleRuntime(),handshake=lifecycleHandshake(),compatibility=lifecycleCompatibility();if(runtime?.health().ready&&handshake?.runtime===runtime&&compatibility.compatible){reported=true;if(process.send&&process.env.BOT_LAUNCH_TOKEN)process.send({type:'bot-ready',nonce:process.env.BOT_LAUNCH_TOKEN,identity:handshake.artifactIdentity,lifecycle:{protocol:compatibility.main?.runtimeProtocol,coordinatorApi:compatibility.coordinator?.coordinatorApi,mainVersion:compatibility.main?.packageVersion,coordinatorVersion:compatibility.coordinator?.packageVersion,coordinatorIdentity:artifactIdentity}});}}
  },250);timer.unref();
  const shutdown=(message:unknown)=>{handleLifecycleShutdown(message);};process.on('message',shutdown);
  ctx.effect(()=>()=>{clearInterval(timer);process.off('message',shutdown);markLifecycleAvailable(false);coordinator.dispose();});
}
