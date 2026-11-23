import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import type {ToolRunContext} from '@deepseek-ai/dsh-tools';
import {botSchema,configSchema,type CallerScope} from '../../../src/core/types.js';
import {BUSINESS_TOOLS,permitted,freezeTurn,allowedNow} from '../../../src/core/policy.js';
import {SqlitePersistence} from '../../../src/infrastructure/sqlite/persistence.js';
import {Assets,MediaService} from '../../../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../../../src/core/runtime.js';
import {BotFeatures,botImageArgumentsSchema} from '../../../src/core/features.js';
import {defineBotImageControlTool} from '../../../src/harness/management-tools.js';
import {buildChatPrompt} from '../../../src/harness/chat-prompt.js';
import {toolCatalogDescription} from '../../../src/harness/tool-disclosure.js';
import {fixtureChannels} from '../../fixtures/test-channel.js';

const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
const bot=botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true,trustedUsers:['owner']});
const config=configSchema.parse({id:'default',name:'Default',personaPrompt:'P',allowHostTools:false});

test('image control validates protocol-only actions and requires trusted private chat without host permission',()=>{
  assert.deepEqual(botImageArgumentsSchema.parse({action:'list'}),{action:'list'});
  for(const protocol of ['openai','comfyui','google'])assert.deepEqual(botImageArgumentsSchema.parse({action:'set',protocol:protocol.toUpperCase()}),{action:'set',protocol});
  for(const value of [{action:'set'},{action:'reset',protocol:'openai'},{action:'list',protocol:'google'},{action:'set',protocol:'unknown'},{action:'set',protocol:'google',sessionId:'other'},{action:'set',protocol:'google',path:'private'}])assert.equal(botImageArgumentsSchema.safeParse(value).success,false);
  assert.equal(BUSINESS_TOOLS.has('bot_image_control'),true);
  assert.equal(permitted('bot_image_control',config,bot,scope),true);
  for(const other of [{...scope,kind:'group' as const,channelId:'group'},{...scope,senderId:'other',channelId:'other'}])assert.equal(permitted('bot_image_control',config,bot,other),false);
});

test('image control exposes the saved choice and guides the next image call in this turn',async()=>{
  const calls:unknown[]=[];
  const tool=defineBotImageControlTool(async args=>{calls.push(args);return{action:args.action,sessionId:'host-session',currentTurnProtocol:args.protocol??'openai',nextTurnProtocol:args.protocol??'openai',override:args.action==='set',protocols:['openai','google','comfyui'],effective:'current'};});
  assert.equal(tool.name,'bot_image_control');
  assert.deepEqual(Object.keys((tool.parameters as any).properties).sort(),['action','protocol']);
  assert.equal(tool.isConcurrencySafe?.({action:'list'}),true);
  assert.equal(tool.isConcurrencySafe?.({action:'set',protocol:'google'}),false);
  assert.equal(tool.isConcurrencySafe?.({action:'reset'}),false);
  const exec={signal:new AbortController().signal} as ToolRunContext;
  const result=JSON.parse(await tool.execute({action:'set',protocol:'GOOGLE'},exec) as string);
  assert.equal(result.sessionId,undefined);assert.equal(result.currentTurnProtocol,'google');assert.equal(result.nextTurnProtocol,'google');assert.equal(result.effective,'current');
  assert.deepEqual(calls,[{action:'set',protocol:'google'}]);
  await assert.rejects(tool.execute({action:'set',protocol:'google',baseUrl:'https://private.invalid'},exec));
  assert.match(toolCatalogDescription([tool as any]),/bot_image_control: Select and save an image service for this task/);
  const prompt=buildChatPrompt({personaPrompt:'P',platform:'qq',loadedTools:new Set(['bot_image_control']),skillNames:[]}).sections.find(section=>section.name==='bot-management')!.text;
  assert.match(prompt,/next image operation uses currentTurnProtocol/);assert.match(prompt,/capabilities returned by the switch/);assert.match(prompt,/same turn/);
});

async function fixture(t:any){
  await mkdir(path.resolve('.codex'),{recursive:true});const directory=await mkdtemp(path.resolve('.codex/image-tool-'));
  const store=new SqlitePersistence(directory),assets=new Assets(store.repositories()),media=new MediaService(store.repositories(),assets);
  const harness:HarnessPort={run:async()=>{throw Error('NO_MODEL_CALL');},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const adapter={beginLogin:async()=>({status:'pending' as const}),pollLogin:async()=>({status:'expired' as const}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=> 'receipt'};
  const runtime=new BotRuntime(store.repositories(),assets,media,harness,fixtureChannels(adapter),{} as any),features=new BotFeatures(runtime);
  store.bots.saveBot({...bot,configId:'sakura'});const binding=store.sessions.binding(scope);
  const snapshot=()=>freezeTurn(runtime.effectiveConfig(store.sessions.binding(scope)),store.bots.bot('bot'),scope,[],undefined,'zh',media.imageSettings());
  t.after(async()=>{await runtime.close();store.close();await rm(directory,{recursive:true,force:true});});
  return{store,runtime,features,harness,binding,snapshot};
}

test('image set/reset publishes the selected protocol to the parent and keeps earlier child work isolated',async t=>{
  const f=await fixture(t),parent=f.snapshot(),child=f.snapshot(),original=f.store.bots.bot('bot');
  const another=f.store.sessions.binding({...scope,senderId:'another',channelId:'another'});
  let active=parent;
  f.harness.applyTurnSelection=(_binding,before,updated)=>{assert.equal(before,active);active=updated;};
  for(const protocol of ['google','comfyui','openai']){
    const result=await f.features.image(f.binding,active,{action:'set',protocol},new AbortController().signal);
    assert.equal(result.effective,'current');assert.equal(result.currentTurnProtocol,protocol);assert.equal(result.nextTurnProtocol,protocol);
    assert.equal(f.runtime.imageSelection(f.store.sessions.binding(scope)).nextTurnProtocol,protocol);
    assert.equal(f.runtime.imageSelection(f.binding,active).currentTurnProtocol,protocol);assert.equal(f.runtime.imageSelection(f.binding,child).currentTurnProtocol,'openai');
  }
  assert.deepEqual(f.store.bots.bot('bot'),original);assert.equal(f.store.sessions.findBinding(another.key)!.imageProtocolOverride,undefined);
  const reset=await f.features.image(f.binding,active,{action:'reset'},new AbortController().signal);assert.equal(reset.override,false);assert.equal(reset.currentTurnProtocol,'openai');assert.equal(reset.nextTurnProtocol,'openai');
});

test('image control rejects cancellation, stale generations and sessions, forged scope and revoked trust without writes',async t=>{
  const f=await fixture(t),snapshot=f.snapshot(),signal=new AbortController().signal;
  const aborted=new AbortController();aborted.abort();await assert.rejects(f.features.image(f.binding,snapshot,{action:'set',protocol:'google'},aborted.signal));
  await assert.rejects(f.features.image({...f.binding,generation:f.binding.generation+1},snapshot,{action:'set',protocol:'google'},signal),/IMAGE_SESSION_CHANGED/);
  await assert.rejects(f.features.image({...f.binding,scope:{...scope,senderId:'other'}},snapshot,{action:'set',protocol:'google'},signal),/IMAGE_SESSION_CHANGED/);
  f.store.bots.saveBot({...f.store.bots.bot('bot'),trustedUsers:[]});await assert.rejects(f.features.image(f.binding,snapshot,{action:'set',protocol:'google'},signal),/TRUSTED/);
  const untrusted=f.snapshot();f.store.bots.saveBot({...f.store.bots.bot('bot'),trustedUsers:['owner']});assert.equal(allowedNow('bot_image_control',untrusted,f.runtime.effectiveConfig(f.binding),f.store.bots.bot('bot'),scope),false);await assert.rejects(f.features.image(f.binding,untrusted,{action:'set',protocol:'google'},signal),/TRUSTED/);
  f.store.sessions.reset(scope);await assert.rejects(f.features.image(f.binding,snapshot,{action:'set',protocol:'google'},signal),/IMAGE_SESSION_CHANGED/);assert.equal(f.store.sessions.binding(scope).imageProtocolOverride,undefined);
});

test('disabling image generation blocks set while list and reset remain available',async t=>{
  const f=await fixture(t),snapshot=f.snapshot(),signal=new AbortController().signal;
  await f.features.image(f.binding,snapshot,{action:'set',protocol:'google'},signal);
  const current=f.store.bots.bot('bot');f.store.bots.saveBot({...current,settings:{...current.settings!,media:{...current.settings!.media,image:{enabled:false}}}});
  await assert.rejects(f.features.image(f.binding,snapshot,{action:'set',protocol:'comfyui'},signal));assert.equal(f.store.sessions.binding(scope).imageProtocolOverride,'google');
  const listed=await f.features.image(f.binding,snapshot,{action:'list'},signal);assert.equal(listed.nextTurnProtocol,'google');
  const reset=await f.features.image(f.binding,snapshot,{action:'reset'},signal);assert.equal(reset.override,false);assert.equal(f.runtime.effectiveConfig(f.store.sessions.binding(scope)).media.image?.enabled,false);
  const disabled=f.snapshot();f.store.bots.saveBot(current);
  await assert.rejects(f.features.image(f.binding,disabled,{action:'set',protocol:'google'},signal),/未启用/);
  assert.equal(f.store.sessions.binding(scope).imageProtocolOverride,undefined);
});
