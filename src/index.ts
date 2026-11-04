import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-llm';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import { Store } from './core/store.js';
import { Assets, MediaService } from './core/media.js';
import { BotRuntime } from './core/runtime.js';
import {createBotCredentials} from './harness/credentials.js';
import { NativeHarness,type HarnessExtensions } from './harness/bridge.js';
import { Admin } from './harness/admin.js';
import { QQAdapter,qqChannel } from './channels/qq.js';
import {createQQAudioPreparer} from './channels/qq-audio.js';
import { WeixinAdapter,weixinChannel } from './channels/weixin.js';
import {createChannelRegistry} from './core/channel-registry.js';
import {HarnessMediaProvider} from './harness/media-provider.js';
import {ProcessWorker} from './harness/process-worker.js';
import {BotFeatures} from './core/features.js';
import {BotManagement} from './core/management.js';
import {packageRoot} from './core/paths.js';
import {registerLifecycleRuntime,handleLifecycleShutdown,createLifecyclePort,packageIdentity} from './lifecycle/protocol.js';
import {SessionId} from '@deepseek-ai/dsh-session';
import {ServicePluginHost} from './core/service-plugin-host.js';
import {ProfileStore,StoreProfileRepository} from './core/profile-store.js';
import {OutputValidatorRegistry} from './core/output-validator.js';
import {ServiceRuntime,type ApprovedServicePolicy} from './core/service-runtime.js';
import {mediaOperationRegistry} from './core/media-operation-registry.js';
import {StoreServiceStateRepository} from './core/service-state-store.js';
import {BUILTIN_SERVICE_POLICIES} from './core/builtin-service-adapters.js';
import {ServiceManagement} from './core/service-management.js';
import {createBuiltinServiceAdapters,createVoiceModelLibrary} from './harness/service-adapter-runtime.js';
import {NodeControlledProcessPort} from './harness/controlled-process.js';

export const name='bot-integration';
export const inject=['agents','agentPresets','llm','settings','tools','skills','systemPrompt','attachments','credentials','webServer','permissionPresets','sessions','sessionPersistence','sessionQuery','storageDomain','workingDirectory','commands'];
export const Config=Schema.object({
  dataDir:Schema.string().min(1).max(4096).description('机器人运行数据目录；留空使用产品或 Harness 默认目录。'),
  python:Schema.string().min(1).max(4096).description('媒体 worker 使用的 Python 3.12+ 解释器；留空使用 BOT_PYTHON 或 python。'),
  debounceMs:Schema.number().step(1).min(0).max(60_000).default(2000).description('同一会话入站消息的合并等待时间（毫秒）。'),
});
export interface Config {dataDir?:string;python?:string;debounceMs?:number}
declare module '@deepseek-ai/cordis' {interface Context {botIntegration:BotRuntime}}
/** First release: only code-reviewed adapters compiled into this package may load. */
const HOST_SERVICE_POLICIES:ReadonlyMap<string,ApprovedServicePolicy>=BUILTIN_SERVICE_POLICIES;
export async function apply(ctx:Context,config:Config={}):Promise<void>{
  const home=config.dataDir??process.env.BOT_DATA_HOME??path.join(process.env.DSH_HOME??path.join(process.cwd(),'.runtime','bot-data'),'storages','bot-integration');
  const store=Store.open(home,undefined,{secureDefaults:true}).initialize().migrate();
  let serviceHost:ServicePluginHost|undefined,serviceRuntime:ServiceRuntime|undefined;const profiles=new ProfileStore(new StoreProfileRepository(store));
  try{
    // Validate every fixed source and create the immutable catalog before any
    // executable operation or Harness tool is exposed.
    serviceHost=await ServicePluginHost.createBuiltin(createBuiltinServiceAdapters(config.python));
    const validators=new OutputValidatorRegistry();
    serviceRuntime=new ServiceRuntime(serviceHost,profiles,validators,HOST_SERVICE_POLICIES,new StoreServiceStateRepository(store),path.join(store.home,'.tmp','service-health'));
    serviceRuntime.assertApprovedMediaOperations(mediaOperationRegistry);
  }catch(error){await serviceHost?.dispose().catch(()=>{});store.close();throw error;}
  const assets=new Assets(store);const media=new MediaService(store,assets,config.python,new HarnessMediaProvider(ctx),new ProcessWorker(config.python),mediaOperationRegistry,undefined,serviceRuntime);
  const credentials=createBotCredentials(ctx.credentials);
  const extensions:HarnessExtensions={};const harness=new NativeHarness(ctx,store,assets,media,extensions);let disposeMode;try{disposeMode=await harness.registerMode();}catch(error){await serviceHost.dispose().catch(()=>{});store.close();throw error;}
  const channels=createChannelRegistry([qqChannel(new QQAdapter(undefined,{emit:event=>extensions.stats?.observeGroup({botId:event.botId,groupId:event.groupId,name:event.name,event:event.type==='group.joined'?'joined':event.type==='group.left'?'left':'observed',at:event.at,eventId:event.eventId})},undefined,undefined,createQQAudioPreparer(assets,{processes:new NodeControlledProcessPort()}))),weixinChannel(new WeixinAdapter(store.cursorStore()))]);
  const runtime=new BotRuntime(store,assets,media,harness,channels,credentials,config.debounceMs,0,profiles);
  const features=new BotFeatures(runtime,createLifecyclePort());extensions.stats=features.stats;extensions.model=(binding,snapshot,args,signal)=>features.model(binding,snapshot,args,signal);extensions.evolve=(binding,snapshot,args,signal)=>features.execute(binding,snapshot,args,signal);
  extensions.management=new BotManagement(runtime,features);
  const voiceLibrary=createVoiceModelLibrary(store,profiles);
  await voiceLibrary.initialize();
  const services=new ServiceManagement(store,profiles,serviceRuntime,{models:()=>harness.models()},new Map(),voiceLibrary);
  const token=randomBytes(32).toString('base64url');const admin=new Admin(ctx,runtime,token,undefined,features,services);
  ctx.on('webserver/index-inject',rows=>{rows.push({kind:'global',name:'__BOT_INTEGRATION__',value:{endpoint:'/api/bot-integration',token}});});
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/bot-integration',handler:(req,res)=>admin.http(req,res)}));
  let detachLifecycle:(()=>void)|undefined;
  ctx.effect(()=>async()=>{
    detachLifecycle?.();serviceRuntime.stopAccepting();
    let shutdownError:unknown;
    try{await serviceRuntime.cancelAndDrain();}catch(error){shutdownError=error;}
    try{await runtime.close();await serviceHost.dispose();await disposeMode();}finally{store.close();}
    if(shutdownError)throw shutdownError;
  });
  const shutdown=(message:unknown)=>{handleLifecycleShutdown(message);};
  process.on('message',shutdown);ctx.effect(()=>()=>process.off('message',shutdown));
  if(features.evolution.history().some(task=>['queued','draining','applying','restarting','reconnecting','rolling-back'].includes(task.phase)))runtime.pauseProcessing();
  await assets.migrate();await harness.exportHistory();await features.backfill({readSession:id=>ctx.sessionQuery.readSession(SessionId(id))});await runtime.initialize();store.start();
  const runtimePackageRoot=packageRoot();
  detachLifecycle=registerLifecycleRuntime({packageRoot:runtimePackageRoot,quiesce:()=>runtime.quiesce(),resumeProcessing:()=>runtime.resumeProcessing(),health:()=>runtime.health()});
  // The lifecycle bundle normally reports readiness. Emit the same authenticated
  // signal here as a fallback for hosts that isolate bundle timers from IPC.
  if(process.send&&process.env.BOT_LAUNCH_TOKEN)process.send({type:'bot-ready',nonce:process.env.BOT_LAUNCH_TOKEN,identity:packageIdentity(runtimePackageRoot)});
  ctx.provide('botIntegration',runtime);
}
