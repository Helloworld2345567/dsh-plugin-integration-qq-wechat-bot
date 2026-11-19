import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {botSchema,botSettingsFromConfig,configSchema,type CallerScope,type InboundMessage,type TurnSnapshot} from '../src/core/types.js';
import {imageProtocolSchema,imageServiceSettingsSchema} from '../src/core/image-service-config.js';
import {freezeTurn,allowedNow} from '../src/core/policy.js';
import {managementCommand} from '../src/core/command-bus.js';
import {commandHelp} from '../src/core/commands.js';
import {fixtureChannels} from './test-channel.js';

const scope=(senderId='alice',kind:'private'|'group'='private'):CallerScope=>({botId:'one',platform:'qq',accountId:'one',kind,channelId:kind==='group'?'room':senderId,senderId});
let sequence=0;
const message=(text:string,current=scope()):InboundMessage=>({id:`image-${++sequence}`,scope:current,text,attachments:[],reply:{target:current.channelId},timestamp:Date.now()});

async function fixture(t:TestContext){
  await mkdir(path.resolve('.codex'),{recursive:true});
  const home=await mkdtemp(path.resolve('.codex/image-command-')),store=new SqlitePersistence(home);
  const config=configSchema.parse({...store.personas.config('default'),allowHostTools:false,progressReply:{enabled:false,intervalSeconds:60},media:{image:{protocol:'openai'}}});
  store.bots.saveBot(botSchema.parse({id:'one',name:'One',channel:'qq',accountId:'one',enabled:true,trustedUsers:['alice'],settings:botSettingsFromConfig(config)}));
  const settings=imageServiceSettingsSchema.parse({imageProtocol:'google',comfyUiWorkflowPath:path.join(home,'missing-workflow.json')});
  const assets=new Assets(store.repositories()),media=new MediaService(store.repositories(),assets,undefined,undefined,undefined,undefined,undefined,undefined,()=>settings),sent:string[]=[];
  const harness:HarnessPort={run:async()=>{throw Error('UNEXPECTED_MODEL_CALL');},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},inspectSession:async()=>{},validateModel:async()=>{}};
  const adapter={beginLogin:async()=>({status:'pending' as const}),pollLogin:async()=>({status:'expired' as const}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async(_bot:unknown,_credential:unknown,delivery:any)=>{sent.push(delivery.output.text??'asset');return 'receipt';}};
  const runtime=new BotRuntime(store.repositories(),assets,media,harness,fixtureChannels(adapter),{read:async()=>({accountId:'one'}),write:async()=>{},remove:async()=>{}},0);
  const binding=()=>store.sessions.binding(scope());
  const snapshot=()=>freezeTurn(runtime.effectiveConfig(binding()),store.bots.bot('one'),scope(),[],undefined,'zh',settings);
  t.after(async()=>{await runtime.close();store.close();await rm(home,{recursive:true,force:true});});
  return{store,runtime,harness,media,sent,binding,snapshot};
}

test('image commands parse case-insensitive protocols and appear in trusted help',()=>{
  for(const args of ['', 'list', 'LIST'])assert.deepEqual(managementCommand({name:'image',args}),{kind:'image',action:'list'});
  assert.deepEqual(managementCommand({name:'image',args:'RESET'}),{kind:'image',action:'reset'});
  assert.deepEqual(managementCommand({name:'image',args:'Google'}),{kind:'image',action:'set',protocol:'google'});
  for(const locale of ['zh','en'] as const){assert.match(commandHelp(true,false,locale),/\/image/);assert.doesNotMatch(commandHelp(false,false,locale),/\/image/);}
});

test('slash switching supports all image services without changing bot defaults or other chats',async t=>{
  const f=await fixture(t),original=f.store.bots.bot('one');
  for(const protocol of imageProtocolSchema.options){
    await f.runtime.receive(message(`/image ${protocol.toUpperCase()}`));
    assert.equal(f.binding().imageProtocolOverride,protocol);
    assert.equal(f.media.imageEndpoint(f.runtime.effectiveConfig(f.binding())).protocol,protocol);
  }
  await f.runtime.receive(message('/image'));
  assert.match(f.sent.at(-1)!,/当前轮图片服务：comfyui/);
  assert.match(f.sent.at(-1)!,/会话覆盖/);
  assert.match(f.sent.at(-1)!,/openai, google, comfyui/);
  assert.equal(f.store.sessions.binding(scope('bob')).imageProtocolOverride,undefined);
  assert.deepEqual(f.store.bots.bot('one'),original);
  await f.runtime.receive(message('/image reset'));
  assert.equal(f.binding().imageProtocolOverride,undefined);
  assert.equal(f.runtime.imageSelection(f.binding()).nextTurnProtocol,'openai');
  const bot=f.store.bots.bot('one');f.runtime.saveBot({...bot,settings:{...bot.settings!,media:{}}});
  assert.equal(f.runtime.imageSelection(f.binding()).nextTurnProtocol,'google');
  assert.ok(f.sent.some(text=>text.includes('下一轮生效')));
});

test('unknown image protocols and extra arguments return usage without mutation',async t=>{
  const f=await fixture(t);
  await f.runtime.receive(message('/image google'));
  for(const args of ['unknown','google extra','reset extra','list extra','set google']){
    await f.runtime.receive(message(`/image ${args}`));
    assert.equal(f.binding().imageProtocolOverride,'google');
    assert.match(f.sent.at(-1)!,/用法：\/image/);
  }
});

test('image commands require trusted private chat and disabled capability permits only list/reset',async t=>{
  const f=await fixture(t);
  for(const current of [scope('alice','group'),scope('bob')]){
    await f.runtime.receive(message('/image google',current));
    assert.equal(f.store.sessions.binding(current).imageProtocolOverride,undefined);
    assert.match(f.sent.at(-1)!,/可信私聊/);
  }
  const bot=f.store.bots.bot('one'),settings=bot.settings!;
  for(const disabled of [
    {...settings,media:{image:{enabled:false,protocol:'openai' as const}}},
    {...settings,tools:settings.tools.filter(name=>name!=='bot_media')},
    {...settings,skills:settings.skills.filter(name=>name!=='image-generation')},
  ]){
    f.runtime.saveBot(bot);await f.runtime.receive(message('/image google'));
    const before=f.snapshot();f.runtime.saveBot({...bot,settings:disabled});
    await f.runtime.receive(message('/image comfyui'));
    assert.equal(f.binding().imageProtocolOverride,'google');assert.match(f.sent.at(-1)!,/未启用图片生成/);
    assert.equal(allowedNow('image_generation',before,f.runtime.effectiveConfig(f.binding()),f.store.bots.bot('one'),scope()),false);
    await f.runtime.receive(message('/image list'));assert.match(f.sent.at(-1)!,/支持的服务/);
    await f.runtime.receive(message('/image reset'));assert.equal(f.binding().imageProtocolOverride,undefined);
  }
});

test('runtime new/reset, persona switching and history restoration carry image overrides',async t=>{
  const f=await fixture(t);
  await f.runtime.receive(message('/image google'));
  const historical=f.binding();f.store.sessions.markSessionPersisted(historical);
  await f.runtime.receive(message('/new'));assert.equal(f.binding().imageProtocolOverride,'google');
  await f.runtime.receive(message('/image comfyui'));
  await f.runtime.receive(message('/reset'));assert.equal(f.binding().imageProtocolOverride,'comfyui');
  f.store.personas.saveConfig(configSchema.parse({...f.store.personas.config('default'),id:'other',name:'Other'}));
  await f.runtime.switchPersona(scope(),'other');assert.equal(f.binding().imageProtocolOverride,'comfyui');
  let validatedProtocol:unknown;
  f.harness.validateModel=async config=>{validatedProtocol=config.media.image?.protocol;};
  await f.runtime.receive(message(`/resume ${historical.sessionId}`));
  assert.equal(validatedProtocol,'google');assert.equal(f.binding().imageProtocolOverride,'google');
});

test('switching during a turn leaves its snapshot and execution intact', {timeout:10000},async t=>{
  const f=await fixture(t);
  let start!:()=>void,release!:()=>void,activeSnapshot!:TurnSnapshot,activeSignal!:AbortSignal;
  const started=new Promise<void>(resolve=>{start=resolve;}),finished=new Promise<void>(resolve=>{release=resolve;});
  f.harness.run=async(_binding,_messages,signal,options)=>{
    activeSnapshot=options!.snapshot!;activeSignal=signal;start();await finished;
    return{turnId:'image-frozen',outputs:[],snapshot:activeSnapshot};
  };
  try{
    await f.runtime.receive(message('draw an image'));await started;
    await f.runtime.receive(message('/image google'));
    await f.runtime.receive(message('/image list'));
    assert.match(f.sent.at(-1)!,/当前轮图片服务：openai\n下一轮图片服务：google/);
    assert.equal(activeSignal.aborted,false);
    assert.equal(f.media.imageEndpoint(activeSnapshot.config,activeSnapshot).protocol,'openai');
    const next=f.snapshot();assert.equal(f.media.imageEndpoint(next.config,next).protocol,'google');
  }finally{release();}
});
