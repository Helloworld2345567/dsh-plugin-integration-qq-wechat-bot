import type { Context } from '@deepseek-ai/cordis';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-llm';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Store } from './core/store.js';
import { Assets, MediaService } from './core/media.js';
import { BotRuntime, type Credentials } from './core/runtime.js';
import type { Credential } from './core/types.js';
import { NativeHarness,type HarnessExtensions } from './harness/bridge.js';
import { Admin } from './harness/admin.js';
import { QQAdapter,qqChannel } from './channels/qq.js';
import { WeixinAdapter,weixinChannel } from './channels/weixin.js';
import {createChannelRegistry} from './core/channel-registry.js';
import {HarnessMediaProvider} from './harness/media-provider.js';
import {ProcessWorker} from './harness/process-worker.js';
import {BotFeatures} from './core/features.js';
import {BotManagement} from './core/management.js';
import {packageRoot} from './core/paths.js';
import {registerLifecycleRuntime,handleLifecycleShutdown,createLifecyclePort,packageIdentity} from './lifecycle/protocol.js';
import {SessionId} from '@deepseek-ai/dsh-session';

export const name='bot-integration';
export const inject=['agents','agentPresets','llm','settings','tools','skills','systemPrompt','attachments','credentials','webServer','permissionPresets','sessions','sessionPersistence','sessionQuery','workingDirectory','commands'];
export interface Config { dataDir?:string; python?:string; debounceMs?:number }
declare module '@deepseek-ai/cordis' {interface Context {botIntegration:BotRuntime}}
export async function apply(ctx:Context,config:Config={}):Promise<void>{
  const home=config.dataDir??process.env.BOT_DATA_HOME??path.join(process.env.DSH_HOME??path.join(os.homedir(),'.dsh-bots'),'storages','bot-integration');
  const store=Store.open(home,undefined,{secureDefaults:true}).initialize().migrate();const assets=new Assets(store);const media=new MediaService(store,assets,config.python,new HarnessMediaProvider(ctx),new ProcessWorker(config.python));
  const credentials:Credentials={
    read:async id=>{const value=await ctx.credentials.readRecord(credentialKey('bot-integration',id));return value?.kind==='grant'?value.payload as unknown as Credential:undefined;},
    write:async(id,value)=>{await ctx.credentials.modifyRecord(credentialKey('bot-integration',id),async()=>({kind:'grant',payload:value as unknown as Record<string,any>}));},
    remove:async id=>{await ctx.credentials.deleteRecord(credentialKey('bot-integration',id));},
  };
  const extensions:HarnessExtensions={};const harness=new NativeHarness(ctx,store,assets,media,extensions);let disposeMode;try{disposeMode=await harness.registerMode();}catch(error){store.close();throw error;}
  const channels=createChannelRegistry([qqChannel(new QQAdapter(undefined,{emit:event=>extensions.stats?.observeGroup({botId:event.botId,groupId:event.groupId,name:event.name,event:event.type==='group.joined'?'joined':event.type==='group.left'?'left':'observed',at:event.at,eventId:event.eventId})})),weixinChannel(new WeixinAdapter(store.cursorStore()))]);
  const runtime=new BotRuntime(store,assets,media,harness,channels,credentials,config.debounceMs);
  const features=new BotFeatures(runtime,createLifecyclePort());extensions.stats=features.stats;extensions.model=(binding,snapshot,args,signal)=>features.model(binding,snapshot,args,signal);extensions.evolve=(binding,snapshot,args,signal)=>features.execute(binding,snapshot,args,signal);
  extensions.management=new BotManagement(runtime,features);
  const token=randomBytes(32).toString('base64url');const admin=new Admin(ctx,runtime,token,undefined,features);
  ctx.on('webserver/index-inject',rows=>{rows.push({kind:'global',name:'__BOT_INTEGRATION__',value:{endpoint:'/api/bot-integration',token}});});
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/bot-integration',handler:(req,res)=>admin.http(req,res)}));
  let detachLifecycle:(()=>void)|undefined;
  ctx.effect(()=>async()=>{detachLifecycle?.();await runtime.close();await disposeMode();store.close();});
  const shutdown=(message:unknown)=>{handleLifecycleShutdown(message);};
  process.on('message',shutdown);ctx.effect(()=>()=>process.off('message',shutdown));
  if(features.evolution.history().some(task=>['queued','draining','applying','restarting','reconnecting','rolling-back'].includes(task.phase)))runtime.pauseProcessing();
  await features.backfill({readSession:id=>ctx.sessionQuery.readSession(SessionId(id))});await runtime.initialize();store.start();
  const runtimePackageRoot=packageRoot();
  detachLifecycle=registerLifecycleRuntime({packageRoot:runtimePackageRoot,quiesce:()=>runtime.quiesce(),resumeProcessing:()=>runtime.resumeProcessing(),health:()=>runtime.health()});
  // The lifecycle bundle normally reports readiness. Emit the same authenticated
  // signal here as a fallback for hosts that isolate bundle timers from IPC.
  if(process.send&&process.env.BOT_LAUNCH_TOKEN)process.send({type:'bot-ready',nonce:process.env.BOT_LAUNCH_TOKEN,identity:packageIdentity(runtimePackageRoot)});
  ctx.provide('botIntegration',runtime);
}
