import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/core/store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {BotFeatures} from '../src/core/features.js';
import {createChannelRegistry} from '../src/core/channel-registry.js';
import {freezeTurn} from '../src/core/policy.js';
import type {ChannelAdapter,CallerScope} from '../src/core/types.js';

async function fixture(t:any){
  const root=await mkdtemp(path.resolve('.codex/features-test-'));const store=new Store(root);const assets=new Assets(store);const media=new MediaService(store,assets);
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'pending'}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async()=>{throw Error('NO_PLATFORM_SEND');}};
  const harness:HarnessPort={run:async()=>{throw Error('NO_MODEL_CALL');},cancel:()=>{},dispose:async()=>{},validateModel:async()=>{}};
  const runtime=new BotRuntime(store,assets,media,harness,createChannelRegistry([{id:'qq',displayName:'QQ',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}},{id:'weixin',displayName:'Weixin',adapter,capabilities:{conversations:['private','group'],login:[],groupSupport:'observed_only'}}]),{read:async()=>undefined,write:async()=>{},remove:async()=>{}});
  const features=new BotFeatures(runtime);const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
  store.saveBot({id:'bot',name:'Bot',accountId:'account',channel:'qq',enabled:true,trustedUsers:['owner'],configId:'sakura'});const binding=store.binding(scope);
  const execute=(args:Record<string,unknown>)=>features.execute(binding,freezeTurn(store.config('sakura'),store.bot('bot'),scope,[]),args,new AbortController().signal);
  t.after(async()=>{await runtime.close();store.close();await rm(root,{recursive:true,force:true});});return{store,features,harness,binding,execute};
}
const files=(body:string)=>JSON.stringify([{path:'SKILL.md',content:`---\nname: useful-skill\ndescription: A useful test skill\n---\n${body}`}]);
test('skill rollback restores drafts, reload keeps restored content and later edits work',async t=>{
  const {store,features,execute}=await fixture(t);
  await execute({action:'skill_write',name:'useful-skill',files:files('version one')});
  const change:any=await execute({action:'skill_write',name:'useful-skill',files:files('version two')});
  await execute({action:'rollback',taskId:change.id});await execute({action:'reload'});
  assert.match(features.skills.snapshot(store.config('sakura'))['useful-skill'].content,/version one/);
  await execute({action:'skill_write',name:'useful-skill',files:files('version three')});assert.match(features.skills.snapshot(store.config('sakura'))['useful-skill'].content,/version three/);
});
test('first skill creation rollback archives its draft without resurrecting on reload',async t=>{
  const {store,execute}=await fixture(t);const change:any=await execute({action:'skill_write',name:'useful-skill',files:files('one')});
  await execute({action:'rollback',taskId:change.id});await execute({action:'reload'});assert.ok(!store.config('sakura').skills.includes('useful-skill'));
});
test('skill edits during model validation preserve the newer draft and reject stale publication',async t=>{
  const {store,harness,execute}=await fixture(t);let proceed!:()=>void;let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  harness.validateModel=async()=>{entered();await new Promise<void>(resolve=>proceed=resolve);};
  const publish=execute({action:'skill_write',name:'useful-skill',files:files('one')});await started;
  await writeFile(path.join(store.personas.directory('sakura'),'skills/useful-skill/SKILL.md'),'manual draft');proceed();
  await assert.rejects(publish,/DRAFT_CHANGED/);assert.ok(!store.config('sakura').skills.includes('useful-skill'));
});
test('permission revocation during persona validation rejects publish without changing configuration',async t=>{
  const {store,harness,execute}=await fixture(t);const previous=store.config('sakura');harness.validateModel=async()=>{store.saveBot({...store.bot('bot'),trustedUsers:[]});};
  await assert.rejects(execute({action:'persona',content:'changed'}),/TRUSTED/);assert.deepEqual(store.config('sakura'),previous);
});
