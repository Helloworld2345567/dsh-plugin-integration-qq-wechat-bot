import type { Context, Volatile } from '@deepseek-ai/cordis';
import type {SystemLocale} from './i18n/common.js';
import type {} from '@deepseek-ai/dsh-host-webserver';
import type {} from '@deepseek-ai/dsh-llm';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import { SqlitePersistence } from './infrastructure/sqlite/persistence.js';
import { Assets, MediaService } from './core/media.js';
import { BotRuntime } from './core/runtime.js';
import {createBotCredentials} from './harness/credentials.js';
import { NativeHarness,type HarnessExtensions } from './harness/bridge.js';
import {SessionOwners} from './harness/session-owners.js';
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
import {registerLifecycleRuntime,handleLifecycleShutdown,createLifecyclePort,packageIdentity} from '../packages/bot-lifecycle/src/contract/protocol.js';
import {SessionId} from '@deepseek-ai/dsh-session';
import {ServicePluginHost} from './core/service-plugin-host.js';
import {ProfileStore} from './core/profile-store.js';
import {OutputValidatorRegistry} from './core/output-validator.js';
import {ServiceRuntime,type ApprovedServicePolicy} from './core/service-runtime.js';
import {mediaOperationRegistry} from './core/media-operation-registry.js';
import {BUILTIN_SERVICE_POLICIES} from './core/builtin-service-adapters.js';
import {ServiceManagement} from './core/service-management.js';
import {createBuiltinServiceAdapters,createVoiceModelLibrary} from './harness/service-adapter-runtime.js';
import {MusicServiceLibrary} from './core/music-service-library.js';
import {imageServiceSettingsFromRecord} from './core/image-service-config.js';
import {NodeControlledProcessPort} from './harness/controlled-process.js';

export const name='bot-integration';
export const inject=['agents','agentPresets','llm','settings','tools','skills','systemPrompt','attachments','credentials','webServer','permissionPresets','sessions','sessionPersistence','sessionQuery','storageDomain','workingDirectory','commands'];
export const Config=Schema.object({
  dataDir:Schema.string().min(1).max(4096).description('机器人运行数据目录；留空使用产品或 Harness 默认目录。'),
  python:Schema.string().min(1).max(4096).description('媒体 worker 使用的 Python 3.12+ 解释器；留空使用 BOT_PYTHON 或 python。'),
  debounceMs:Schema.number().step(1).min(0).max(60_000).default(2000).description('同一会话入站消息的合并等待时间（毫秒）。'),
  autoStart:Schema.boolean().default(true).description('加载面板后自动启动机器人服务；关闭时保留配置和历史，等待单独启动服务。'),
  messageLocale:Schema.union(['zh','en']).default('zh').volatile().description('所有机器人固定提示的语言；保存后对新操作生效。'),
}).i18n({zh:{dataDir:'机器人运行数据目录；留空使用产品或 Harness 默认目录。',python:'媒体 worker 使用的 Python 3.12+ 解释器；留空使用 BOT_PYTHON 或 python。',debounceMs:'同一会话入站消息的合并等待时间（毫秒）。',autoStart:'加载面板后自动启动机器人服务；关闭时保留配置和历史，等待单独启动服务。',messageLocale:'所有机器人固定提示的语言；保存后对新操作生效。'},en:{dataDir:'Bot runtime data directory. Leave blank for the product or Harness default.',python:'Python 3.12+ interpreter for media workers. Leave blank to use BOT_PYTHON or python.',debounceMs:'Wait time in milliseconds for combining incoming messages in the same session.',autoStart:'Start the bot service when the panel loads. When off, keep configuration and history until the service is started separately.',messageLocale:'Language for fixed messages from all bots. Applies to new operations after saving.'}});
export interface Config {dataDir?:string;python?:string;debounceMs?:number;autoStart?:boolean;messageLocale?:Volatile<SystemLocale>}
declare module '@deepseek-ai/cordis' {interface Context {botIntegration:BotRuntime}}
/** First release: only code-reviewed adapters compiled into this package may load. */
const HOST_SERVICE_POLICIES:ReadonlyMap<string,ApprovedServicePolicy>=BUILTIN_SERVICE_POLICIES;
export async function apply(ctx:Context,config:Config={}):Promise<void>{
  const sessionOwners=new SessionOwners(ctx);
  const systemLocale=():SystemLocale=>config.messageLocale?.get()??'zh';
  ctx.effect(()=>ctx.settings.configure({auto:false}));
  const home=config.dataDir??process.env.BOT_DATA_HOME??path.join(process.env.DSH_HOME??path.join(process.cwd(),'.runtime','bot-data'),'storages','bot-integration');
  // The composition root is the only place that opens storage, builds adapters
  // and injects them into application services.
  const persistence=SqlitePersistence.open(home,undefined,{secureDefaults:true}).initialize().migrate();
  const repos=persistence.repositories();
  let serviceHost:ServicePluginHost|undefined,serviceRuntime:ServiceRuntime|undefined;const profiles=new ProfileStore(persistence.profiles);
  try{
    // Validate every fixed source and create the immutable catalog before any
    // executable operation or Harness tool is exposed.
    serviceHost=await ServicePluginHost.createBuiltin(createBuiltinServiceAdapters(config.python,ctx.credentials));
    const validators=new OutputValidatorRegistry();
    serviceRuntime=new ServiceRuntime(serviceHost,profiles,validators,HOST_SERVICE_POLICIES,persistence.serviceState,path.join(persistence.home,'.tmp','service-health'));
    serviceRuntime.assertApprovedMediaOperations(mediaOperationRegistry);
  }catch(error){await serviceHost?.dispose().catch(()=>{});persistence.close();throw error;}
  const assets=new Assets(repos);const media=new MediaService(repos,assets,config.python,new HarnessMediaProvider(ctx),new ProcessWorker(config.python),mediaOperationRegistry,undefined,serviceRuntime,()=>imageServiceSettingsFromRecord(persistence.voiceLibrarySettings.read()));
  const credentials=createBotCredentials(ctx.credentials);
  const extensions:HarnessExtensions={};const harness=new NativeHarness(ctx,repos,assets,media,extensions,systemLocale,sessionOwners);let disposeMode;try{disposeMode=await harness.registerMode();}catch(error){await serviceHost.dispose().catch(()=>{});persistence.close();throw error;}
  const channels=createChannelRegistry([qqChannel(new QQAdapter(undefined,{emit:event=>extensions.stats?.observeGroup({botId:event.botId,groupId:event.groupId,name:event.name,event:event.type==='group.joined'?'joined':event.type==='group.left'?'left':'observed',at:event.at,eventId:event.eventId})},undefined,undefined,createQQAudioPreparer(assets,{processes:new NodeControlledProcessPort()}))),weixinChannel(new WeixinAdapter(persistence.cursors))]);
  const runtime=new BotRuntime(repos,assets,media,harness,channels,credentials,config.debounceMs,0,profiles,systemLocale);
  const features=new BotFeatures(runtime,createLifecyclePort());extensions.stats=features.stats;extensions.model=(binding,snapshot,args,signal)=>features.model(binding,snapshot,args,signal);extensions.voice=(binding,snapshot,args,signal)=>features.voice(binding,snapshot,args,signal);extensions.evolve=(binding,snapshot,args,signal)=>features.execute(binding,snapshot,args,signal);
  extensions.management=new BotManagement(runtime,features);
  const voiceLibrary=createVoiceModelLibrary(persistence.voiceLibrarySettings,persistence.home,profiles);
  const musicLibrary=new MusicServiceLibrary(persistence.voiceLibrarySettings,profiles);
  await voiceLibrary.initialize();
  await musicLibrary.initialize();
  const services=new ServiceManagement({personas:persistence.personas,capabilities:persistence.capability,health:persistence.capability},profiles,serviceRuntime,{models:()=>harness.models()},new Map(),voiceLibrary,musicLibrary);
  const token=randomBytes(32).toString('base64url');const admin=new Admin(ctx,runtime,token,undefined,features,services);
  ctx.on('webserver/index-inject',rows=>{rows.push({kind:'global',name:'__BOT_INTEGRATION__',value:{endpoint:'/api/bot-integration',token}});});
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/bot-integration',handler:(req,res)=>admin.http(req,res)}));
  let detachLifecycle:(()=>void)|undefined;
  ctx.effect(()=>async()=>{
    detachLifecycle?.();serviceRuntime.stopAccepting();
    let shutdownError:unknown;
    try{await serviceRuntime.cancelAndDrain();}catch(error){shutdownError=error;}
    try{await runtime.close();await serviceHost.dispose();await disposeMode();}finally{persistence.close();}
    if(shutdownError)throw shutdownError;
  });
  const shutdown=(message:unknown)=>{handleLifecycleShutdown(message);};
  process.on('message',shutdown);ctx.effect(()=>()=>process.off('message',shutdown));
  if(features.evolution.history().some(task=>['queued','draining','applying','restarting','reconnecting','rolling-back'].includes(task.phase)))runtime.pauseProcessing();
  await assets.migrate();await harness.exportHistory();await features.backfill({readSession:id=>ctx.sessionQuery.readSession(SessionId(id))});await runtime.initialize({autoStart:config.autoStart??true});persistence.start();
  const runtimePackageRoot=packageRoot();
  const runtimeIdentity=packageIdentity(runtimePackageRoot);
  detachLifecycle=registerLifecycleRuntime({packageRoot:runtimePackageRoot,quiesce:()=>runtime.quiesce(),resumeProcessing:()=>runtime.resumeProcessing(),health:()=>runtime.health()},runtimeIdentity);
  // The lifecycle bundle reports readiness only after the versioned handshake is
  // compatible. The fallback carries the same serialized contract for launchers
  // whose bundle timer cannot own IPC, and is ignored when compatibility fails.
  const lifecycle=createLifecyclePort();const handshake=lifecycle.handshake();const compatibility=lifecycle.compatibility();
  if(process.send&&process.env.BOT_LAUNCH_TOKEN&&handshake&&compatibility.compatible)process.send({type:'bot-ready',nonce:process.env.BOT_LAUNCH_TOKEN,identity:runtimeIdentity,lifecycle:{protocol:handshake.runtimeProtocol,mainVersion:handshake.packageVersion,coordinatorApi:compatibility.coordinator?.coordinatorApi,coordinatorVersion:compatibility.coordinator?.packageVersion,coordinatorIdentity:compatibility.coordinator?.artifactIdentity}});
  ctx.provide('botIntegration',runtime);
}
