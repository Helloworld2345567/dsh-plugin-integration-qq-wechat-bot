import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import type {ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botSchema,configSchema,type CallerScope} from '../src/core/types.js';
import {BUSINESS_TOOLS,permitted,freezeTurn,allowedNow} from '../src/core/policy.js';
import {Store} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {BotFeatures} from '../src/core/features.js';
import {defineBotModelTool} from '../src/harness/model-tool.js';
import {fixtureChannels} from './test-channel.js';

const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
test('trusted natural-language model switching has a bot_model capability without enabling host tools',()=>{
  const config=configSchema.parse({id:'sakura',name:'Sakura',personaPrompt:'P',allowHostTools:false});
  const bot=botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true,trustedUsers:['owner']});
  assert.equal(BUSINESS_TOOLS.has('bot_model'),true,'可信私聊要求切换模型时应有 bot_model，不能只能转告手动输入 /model');
  assert.equal(permitted('bot_model',config,bot,scope),true,'模型管理不得依赖本机工具权限');
});

async function fixture(t:any){
  const directory=await mkdtemp(path.resolve('.codex/model-tool-'));const store=new Store(directory);const assets=new Assets(store),media=new MediaService(store,assets);
  const catalog=[{provider:'Fixture',model:'chat'},{provider:'Fixture',model:'Gemini-Case'}];
  const harness:HarnessPort={run:async()=>{throw Error('NO_MODEL_CALL');},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},models:async()=>catalog,validateModel:async config=>{if(config.model&&!catalog.some(m=>m.provider===config.model!.provider&&m.model===config.model!.model))throw Error('UNKNOWN_MODEL');}};
  const adapter={beginLogin:async()=>({status:'pending' as const}),pollLogin:async()=>({status:'expired' as const}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=> 'receipt'};
  const runtime=new BotRuntime(store,assets,media,harness,fixtureChannels(adapter),{} as any);const features=new BotFeatures(runtime);
  const previous=store.config('sakura');store.saveConfig({...previous,allowHostTools:false,model:catalog[0]},previous.revision);
  store.saveBot(botSchema.parse({id:'bot',name:'Bot',accountId:'account',channel:'qq',enabled:true,trustedUsers:['owner'],configId:'sakura'}));const binding=store.binding(scope);
  const snapshot=()=>freezeTurn(runtime.effectiveConfig(store.binding(scope)),store.bot('bot'),scope,[]);
  t.after(async()=>{await runtime.close();store.close();await rm(directory,{recursive:true,force:true});});return{store,runtime,features,harness,binding,snapshot,catalog};
}

test('model tool declaration exposes only list/set/reset and executes the host-bound service',async t=>{
  const f=await fixture(t);const frozen=f.snapshot();const tool=defineBotModelTool((args,exec)=>f.features.model(f.binding,frozen,args,exec.signal));
  assert.equal(tool.name,'bot_model');assert.deepEqual(Object.keys((tool.parameters as any).properties).sort(),['action','model','provider']);
  const exec={signal:new AbortController().signal} as ToolRunContext;const result=JSON.parse(await tool.execute({action:'list'},exec) as string);assert.deepEqual(result.models,f.catalog);assert.equal(result.personaId,'sakura');assert.deepEqual(result.currentTurnModel,f.catalog[0]);
  await assert.rejects(tool.execute({action:'set',provider:'Fixture',model:'Gemini-Case',sessionId:'another'},exec));assert.equal(f.store.binding(scope).modelOverride,undefined);
  assert.equal(tool.isConcurrencySafe?.({action:'set',provider:'Fixture',model:'Gemini-Case'}),false);
});
test('trusted model set/reset changes only host-bound session and leaves frozen parent/child and shared persona unchanged',async t=>{
  const f=await fixture(t);const original=f.store.config('sakura');const parent=f.snapshot(),child=f.snapshot();const another=f.store.binding({...scope,senderId:'another',channelId:'another'});
  const set=await f.features.model(f.binding,parent,{action:'set',provider:'Fixture',model:'Gemini-Case'},new AbortController().signal);
  assert.equal(set.effective,'next_turn');assert.deepEqual(set.currentTurnModel,f.catalog[0]);assert.deepEqual(set.nextTurnModel,f.catalog[1]);assert.deepEqual(parent.config.model,f.catalog[0]);assert.deepEqual(child.config.model,f.catalog[0]);assert.deepEqual(f.store.config('sakura'),original);assert.equal(f.store.get<any>('binding',another.key).modelOverride,undefined);assert.deepEqual(f.snapshot().config.model,f.catalog[1]);
  const reset=await f.features.model(f.binding,f.snapshot(),{action:'reset'},new AbortController().signal);assert.deepEqual(reset.nextTurnModel,f.catalog[0]);assert.equal(reset.override,false);assert.deepEqual(f.store.config('sakura'),original);
});
test('ordinary/group callers and newly granted privileges cannot access model management mid-turn',async t=>{
  const f=await fixture(t);const config=f.store.config('sakura');
  for(const other of [{...scope,senderId:'other',channelId:'other'},{...scope,kind:'group' as const,channelId:'group'}]){const binding=f.store.binding(other);const frozen=freezeTurn(config,f.store.bot('bot'),other,[]);assert.equal(permitted('bot_model',config,f.store.bot('bot'),other),false);await assert.rejects(f.features.model(binding,frozen,{action:'list'},new AbortController().signal),/TRUSTED/);}
  f.store.saveBot({...f.store.bot('bot'),trustedUsers:[]});const untrusted=f.snapshot();f.store.saveBot({...f.store.bot('bot'),trustedUsers:['owner']});assert.equal(allowedNow('bot_model',untrusted,config,f.store.bot('bot'),scope),false);await assert.rejects(f.features.model(f.binding,untrusted,{action:'set',provider:'Fixture',model:'Gemini-Case'},new AbortController().signal),/TRUSTED/);
});
test('revocation after asynchronous model validation prevents session mutation',async t=>{
  const f=await fixture(t);const original=f.store.binding(scope);const frozen=f.snapshot();f.harness.validateModel=async()=>{f.store.saveBot({...f.store.bot('bot'),trustedUsers:[]});};
  await assert.rejects(f.features.model(f.binding,frozen,{action:'set',provider:'Fixture',model:'Gemini-Case'},new AbortController().signal),/TRUSTED/);assert.deepEqual(f.store.binding(scope),original);
});
test('catalog revocation, cancelled calls, unknown models and stale sessions fail without changing overrides',async t=>{
  const f=await fixture(t);const frozen=f.snapshot();
  await assert.rejects(f.features.model(f.binding,frozen,{action:'set',provider:'Fixture',model:'missing'},new AbortController().signal),/UNKNOWN_MODEL/);assert.equal(f.store.binding(scope).modelOverride,undefined);
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(f.features.model(f.binding,frozen,{action:'reset'},cancelled.signal));
  f.harness.models=async()=>{f.store.saveBot({...f.store.bot('bot'),trustedUsers:[]});return f.catalog;};await assert.rejects(f.features.model(f.binding,frozen,{action:'list'},new AbortController().signal),/TRUSTED/);
  f.store.saveBot({...f.store.bot('bot'),trustedUsers:['owner']});f.store.reset(scope);await assert.rejects(f.features.model(f.binding,frozen,{action:'set',provider:'Fixture',model:'Gemini-Case'},new AbortController().signal),/MODEL_SESSION_CHANGED/);assert.equal(f.store.binding(scope).modelOverride,undefined);
});
