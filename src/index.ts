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
import { NativeHarness } from './harness/bridge.js';
import { Admin } from './harness/admin.js';
import { QQAdapter } from './channels/qq.js';
import { WeixinAdapter } from './channels/weixin.js';
import {HarnessMediaProvider} from './harness/media-provider.js';

export const name='bot-integration';
export const inject=['agents','agentPresets','llm','settings','tools','skills','systemPrompt','attachments','credentials','webServer','permissionPresets','sessions','sessionPersistence','sessionQuery','workingDirectory'];
export interface Config { dataDir?:string; python?:string; debounceMs?:number }
declare module '@deepseek-ai/cordis' {interface Context {botIntegration:BotRuntime}}
export async function apply(ctx:Context,config:Config={}):Promise<void>{
  const home=config.dataDir??process.env.BOT_DATA_HOME??path.join(process.env.DSH_HOME??path.join(os.homedir(),'.dsh-bots'),'storages','bot-integration');
  const store=new Store(home);const assets=new Assets(store);const media=new MediaService(store,assets,config.python,new HarnessMediaProvider(ctx));
  const credentials:Credentials={
    read:async id=>{const value=await ctx.credentials.readRecord(credentialKey('bot-integration',id));return value?.kind==='grant'?value.payload as unknown as Credential:undefined;},
    write:async(id,value)=>{await ctx.credentials.modifyRecord(credentialKey('bot-integration',id),async()=>({kind:'grant',payload:value as unknown as Record<string,any>}));},
    remove:async id=>{await ctx.credentials.deleteRecord(credentialKey('bot-integration',id));},
  };
  const harness=new NativeHarness(ctx,store,assets,media);let disposeMode;try{disposeMode=await harness.registerMode();}catch(error){store.close();throw error;}
  const runtime=new BotRuntime(store,assets,media,harness,{qq:new QQAdapter(),weixin:new WeixinAdapter(store)},credentials,config.debounceMs);
  const token=randomBytes(32).toString('base64url');const admin=new Admin(ctx,runtime,token);
  ctx.on('webserver/index-inject',rows=>{rows.push({kind:'global',name:'__BOT_INTEGRATION__',value:{endpoint:'/api/bot-integration',token}});});
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/bot-integration',handler:(req,res)=>admin.http(req,res)}));
  ctx.effect(()=>async()=>{await runtime.close();await disposeMode();store.close();});
  const shutdown=(message:unknown)=>{if(message&&typeof message==='object'&&'type' in message&&'nonce' in message&&message.type==='bot-stop'&&process.env.BOT_LAUNCH_TOKEN&&message.nonce===process.env.BOT_LAUNCH_TOKEN)process.emit('SIGTERM');};
  process.on('message',shutdown);ctx.effect(()=>()=>process.off('message',shutdown));
  await runtime.initialize();
  ctx.provide('botIntegration',runtime);
}
