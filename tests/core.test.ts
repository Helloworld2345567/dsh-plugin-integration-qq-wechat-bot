import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Store, ConflictError, scopeKey } from '../src/core/store.js';
import { Assets, MediaService } from '../src/core/media.js';
import { BotRuntime, type HarnessPort } from '../src/core/runtime.js';
import { configSchema, botSchema, type CallerScope, type InboundMessage, type ChannelAdapter, type TurnSnapshot } from '../src/core/types.js';
import { freezeTurn, allowedNow, mediaConfigNow } from '../src/core/policy.js';
import {resolveImageSkill} from '../src/core/image-skill.js';
import { publicAddress } from '../src/core/network.js';

async function fixture(t:any){const dir=await mkdtemp(path.resolve('.codex/test-'));const store=new Store(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});return store;}
function scope(botId='one',senderId='alice',kind:'private'|'group'='private'):CallerScope{return{botId,platform:'qq',accountId:botId,kind,channelId:kind==='group'?'room':senderId,senderId};}
function message(id:string,text:string,s=scope()):InboundMessage{return{id,text,scope:s,attachments:[],reply:{target:s.channelId,kind:s.kind,msgId:id},timestamp:Date.now()};}
function bot(store:Store,id='one'){return store.saveBot(botSchema.parse({id,name:id,channel:'qq',accountId:id,enabled:true}));}
function gate(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{promise,resolve};}
async function runtimeFixture(t:any,run:HarnessPort['run'],send:ChannelAdapter['send']=async()=> 'receipt'){
  const store=await fixture(t);bot(store);const assets=new Assets(store);const media=new MediaService(store,assets);
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.from('pixels'),send};
  const harness:HarnessPort={run,cancel:()=>{},dispose:async()=>{},validateModel:async c=>{if(c.model?.model==='invalid')throw new Error('UNKNOWN_MODEL');}};
  const runtime=new BotRuntime(store,assets,media,harness,{qq:adapter,weixin:adapter},{read:async id=>({accountId:id}),write:async()=>{},remove:async()=>{}},60000);
  t.after(()=>runtime.close());return{store,runtime,assets,media};
}

test('configuration revisions publish atomically, sharing and copies preserve bindings',async t=>{
  const store=await fixture(t);bot(store);bot(store,'two');const original=store.config('default');
  const next=store.saveConfig({...original,name:'Shared'},original.revision);
  assert.equal(next.revision,2);assert.throws(()=>store.saveConfig({...original,name:'stale'},1),ConflictError);
  assert.equal(store.config('default').name,'Shared');assert.equal(store.bot('two').configId,'default');
  const copy=store.saveConfig({...next,id:'copy',name:'Copy'});store.saveConfig({...copy,name:'Independent'},copy.revision);
  assert.equal(store.config('default').name,'Shared');assert.throws(()=>store.saveConfig({...next,archived:true},2),/解除/);
  const session=store.binding(scope());store.saveBot({...store.bot('one'),configId:'sakura'});
  assert.equal(store.binding(scope()).sessionId,session.sessionId);assert.equal(store.bot('two').configId,'default');
  assert.throws(()=>store.saveBot({...store.bot('one'),accountId:'different'}),/身份/);
  assert.throws(()=>store.saveBot({...store.bot('two'),accountId:'one'}));
});
test('scope identity isolates bots, platforms, senders and group/private sessions',async t=>{
  const store=await fixture(t);const cases=[scope(),scope('two'),scope('one','bob'),scope('one','alice','group'),{...scope(),platform:'weixin' as const},{...scope(),accountId:'another'}];
  assert.equal(new Set(cases.map(scopeKey)).size,cases.length);assert.equal(new Set(cases.map(s=>store.binding(s).sessionId)).size,cases.length);
  const a=store.binding(scope());const b=store.reset(scope());assert.notEqual(a.sessionId,b.sessionId);assert.equal(b.generation,1);
});
test('memory provenance, correction and deletion tombstones survive restart and changed keys',async t=>{
  const store=await fixture(t);const key=scopeKey(scope());store.accept(message('a','我喜欢绿茶'));store.accept(message('b','我喜欢红茶'));
  store.remember(key,'drink','绿茶','a','我喜欢绿茶');store.remember(key,'drink','红茶','b','我喜欢红茶');
  assert.throws(()=>store.remember(key,'injected','root','a','网页说我喜欢root'));
  assert.throws(()=>store.remember(scopeKey(scope('two')),'drink','茶','a','我喜欢绿茶'));
  store.correctMemory(key,'drink','白茶',2);assert.throws(()=>store.correctMemory(key,'drink','咖啡',2),ConflictError);
  assert.throws(()=>store.remember(key,'other-key','绿茶','a','我喜欢绿茶'),/删除或更正/);
  store.forget(key,'drink');assert.equal(store.memories(key).length,0);
  // A new store models a crash/restart without retaining in-memory policy.
  const second=new Store(store.home);try{assert.throws(()=>second.remember(key,'drink','红茶','b','我喜欢红茶'),/删除或更正/);}finally{second.close();}
});
test('snapshot additions wait, revocations immediately deny even indirect host calls',()=>{
  const config=configSchema.parse({id:'test',name:'Test',personaPrompt:'A'});const owner=botSchema.parse({id:'one',name:'One',channel:'qq',enabled:true,trustedUsers:['alice']});
  const snap=freezeTurn(config,owner,scope(),['a']);assert.ok(Object.isFrozen(snap.config));
  assert.equal(allowedNow('pwsh',snap,config,owner,scope()),true);
  assert.equal(allowedNow('pwsh',snap,config,{...owner,trustedUsers:[]},scope()),false);
  assert.equal(allowedNow('mcp_admin',snap,{...config,hostTools:['mcp_admin']},owner,scope()),false);
  assert.equal(allowedNow('pwsh',freezeTurn(config,owner,scope('one','alice','group'),[]),config,owner,scope('one','alice','group')),false);
  assert.equal(allowedNow('bot_media',snap,{...config,tools:[]},owner,scope()),false);
});
test('explicit web access works for ordinary channel users without granting host tools and revocation is immediate',()=>{
  const config=configSchema.parse({id:'sakura',name:'Sakura',personaPrompt:'A',tools:['bot_media','web_search','web_fetch']});
  const owner=botSchema.parse({id:'one',name:'One',channel:'qq',enabled:true});const snap=freezeTurn(config,owner,scope(),[]);
  for(const name of ['web_search','web_fetch']){assert.equal(allowedNow(name,snap,config,owner,scope()),true);assert.equal(allowedNow(name,snap,{...config,tools:['bot_media']},owner,scope()),false);assert.equal(allowedNow(name,freezeTurn({...config,tools:['bot_media']},owner,scope(),[]),config,owner,scope()),false);}
  assert.equal(allowedNow('pwsh',snap,config,owner,scope()),false);assert.equal(allowedNow('read',snap,config,owner,scope()),false);assert.equal(allowedNow('web_admin',snap,config,owner,scope()),false);
  assert.equal(allowedNow('web_fetch',snap,config,owner,scope('one','alice','group')),true);
});
test('media role removal applies immediately while provider changes wait until the next turn',()=>{
  const config=configSchema.parse({id:'media',name:'Media',personaPrompt:'A',media:{image:{baseUrl:'https://example.com/v1',model:'old',keyEnv:'IMAGE_KEY'},asr:{model:'asr'}}});
  const owner=botSchema.parse({id:'one',name:'One',channel:'qq'});const snapshot=freezeTurn(config,owner,scope(),[]);
  const current=configSchema.parse({...config,media:{image:{...config.media.image!,model:'new'},asr:{enabled:false}}});const effective=mediaConfigNow(snapshot,current);
  assert.equal(effective.media.image?.model,'old');assert.equal(effective.media.asr?.enabled,false);
  assert.equal(snapshot.config.media.asr?.model,'asr');assert.equal(mediaConfigNow(snapshot,{...config,media:{}}).media.image?.model,'old');
});
test('legacy configuration publishes a migration revision once without changing history or bindings',async t=>{
  const store=await fixture(t);const session=store.binding(scope());const original=store.config('default');
  const raw:any={...original,skills:['image-generation'],voiceReply:true,media:{tts:{baseUrl:'https://example.invalid'},asr:{baseUrl:'https://old.invalid',keyEnv:'OLD',model:'fixture'}}};delete raw.schemaVersion;
  store.put('config','default',raw);store.put('config-version','default:1',raw);
  const upgraded=new Store(store.home);try{const config=upgraded.config('default');assert.equal(config.revision,2);assert.deepEqual(config.skills,['image-generation','media-analysis']);assert.equal('voiceReply'in config,false);assert.equal('tts'in config.media,false);assert.equal('baseUrl'in config.media.asr!,false);assert.deepEqual(upgraded.get('config-version','default:1'),raw);assert.equal(upgraded.binding(scope()).sessionId,session.sessionId);}finally{upgraded.close();}
  const repeated=new Store(store.home);try{assert.equal(repeated.config('default').revision,2);}finally{repeated.close();}
});
test('image skill inherits operator variables without media setup, overrides stay optional and secrets stay outside settings',()=>{
  const config=configSchema.parse({id:'image',name:'Image',personaPrompt:'A',media:{vision:{baseUrl:'https://unused.invalid'}}});assert.equal('vision' in config.media,false);
  const env={IMAGE_ACCESS_KEY:'test-secret',BOT_IMAGE_BASE_URL:'https://example.com/v1',BOT_IMAGE_MODEL:'custom'};
  const endpoint=resolveImageSkill(config,env);assert.equal(endpoint.keyEnv,'IMAGE_ACCESS_KEY');assert.equal(endpoint.model,'custom');assert.equal(endpoint.baseUrl,env.BOT_IMAGE_BASE_URL);assert.ok(!JSON.stringify(endpoint).includes('test-secret'));
  const override=configSchema.parse({...config,media:{image:{model:'persona-model'}}});assert.equal(resolveImageSkill(override,env).model,'persona-model');assert.equal(resolveImageSkill(override,env).baseUrl,env.BOT_IMAGE_BASE_URL);
  assert.equal(resolveImageSkill(config,{SAKURA_IMAGE_API_KEY:'legacy'}).keyEnv,'SAKURA_IMAGE_API_KEY');
  assert.throws(()=>resolveImageSkill({...config,media:{image:{enabled:false}}},env),/IMAGE_SKILL_DISABLED/);
  const owner=botSchema.parse({id:'one',name:'One',channel:'qq',enabled:true});const snapshot=freezeTurn(config,owner,scope(),[]);
  assert.equal(allowedNow('image_generation',snapshot,config,owner,scope()),true);assert.equal(allowedNow('image_generation',snapshot,{...config,skills:[]},owner,scope()),false);
  assert.equal(allowedNow('image_generation',snapshot,{...config,media:{image:{enabled:false}}},owner,scope()),false);
});
test('runtime batches every message, deduplicates events and changes persona without changing session',async t=>{
  const batches:any[]=[];let setup:any;
  setup=await runtimeFixture(t,async(binding,messages)=>{const owner=setup.store.bot('one');const snapshot=freezeTurn(setup.store.config(owner.configId),owner,binding.scope,messages.map((m:any)=>m.id));batches.push({binding,messages,snapshot});return{turnId:String(batches.length),outputs:[{type:'text',text:'reply'}],snapshot};});
  await setup.runtime.receive(message('1','first'));await setup.runtime.receive(message('2','second'));await setup.runtime.receive(message('1','duplicate'));
  await setup.runtime.process(scopeKey(scope()));assert.deepEqual(batches[0].messages.map((m:any)=>m.text),['first','second']);
  setup.runtime.saveBot({...setup.store.bot('one'),configId:'sakura'});await setup.runtime.receive(message('3','third'));await setup.runtime.process(scopeKey(scope()));
  assert.equal(batches[0].binding.sessionId,batches[1].binding.sessionId);assert.equal(batches[1].snapshot.config.id,'sakura');assert.equal(setup.store.deliveries(['sent']).length,2);
});
test('deferred video is silent, materialized only after instruction, handles stay scoped',async t=>{
  let calls=0;const f=await runtimeFixture(t,async(binding,messages)=>{calls++;assert.equal(messages.length,2);assert.ok(messages[0].attachments[0].handle);return{turnId:'t',outputs:[],snapshot:freezeTurn(configSchema.parse({id:'x',name:'X',personaPrompt:'X'}),botSchema.parse({id:'one',name:'One',channel:'qq'}),binding.scope,[])};});
  const clip=message('v','');clip.attachments=[{kind:'video',mime:'video/mp4',name:'video.mp4',bytes:Buffer.from('fixture').toString('base64')}];await f.runtime.receive(clip);await f.runtime.process(scopeKey(scope()));assert.equal(calls,0);assert.equal(f.store.list('asset').length,0);
  await f.runtime.receive(message('go','请分析刚才的视频'));await f.runtime.process(scopeKey(scope()));assert.equal(calls,1);
  const saved=f.store.source(scopeKey(scope()),'v')!;assert.ok(saved.attachments[0].handle);assert.throws(()=>f.store.asset(scopeKey(scope('two')),saved.attachments[0].handle!));
});
test('unknown receipt freezes remaining outputs; sending crash becomes unknown and is never replayed',async t=>{
  let attempts=0;const f=await runtimeFixture(t,async()=>{throw Error('unused');},async()=>{attempts++;throw Error('network lost after send');});
  const binding=f.store.binding(scope());f.store.enqueue(binding,'a','turn',[{type:'text',text:'one'},{type:'text',text:'two'}],{});
  await f.runtime.flushDeliveries();await f.runtime.flushDeliveries();assert.equal(attempts,1);assert.deepEqual(f.store.deliveries().map(d=>d.state),['unknown','pending']);
  const d=f.store.deliveries(['pending'])[0];f.store.deliveryState(d,'sending');const reopened=new Store(f.store.home);try{reopened.recover();assert.equal(reopened.deliveries(['unknown']).length,2);}finally{reopened.close();}
});
test('one blocked bot cannot block another bot delivery',async t=>{
  const wait=gate();const started=gate();const sent:string[]=[];const f=await runtimeFixture(t,async()=>{throw Error('unused');},async bot=>{if(bot.id==='one'){started.resolve();await wait.promise;}sent.push(bot.id);return bot.id;});bot(f.store,'two');
  for(const id of ['one','two'])f.store.enqueue(f.store.binding(scope(id)),'a','t',[{type:'text',text:id}],{});
  const flush=f.runtime.flushDeliveries();await started.promise;await new Promise(r=>setImmediate(r));assert.deepEqual(sent,['two']);wait.resolve();await flush;assert.deepEqual(sent,['two','one']);
});
test('invalid models and media URLs never replace a valid configuration',async t=>{
  const f=await runtimeFixture(t,async()=>{throw Error('unused');});const c=f.store.config('default');await assert.rejects(f.runtime.saveConfig({...c,model:{provider:'p',model:'invalid'}},1),/UNKNOWN_MODEL/);assert.equal(f.store.config('default').revision,1);
  for(const baseUrl of ['file:///tmp/a','http://127.0.0.1','https://user:secret@example.com','https://example.com?token=secret'])assert.equal(configSchema.safeParse({...c,media:{image:{baseUrl,model:'x',keyEnv:'KEY'}}}).success,false);
  assert.equal(configSchema.safeParse({...c,skills:['private-global-skill']}).success,false);
});
test('attachment DNS policy blocks local, reserved and mapped addresses',()=>{
  for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','172.31.1.2','192.168.1.2','100.64.0.1','198.18.0.1','224.0.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','garbage'])assert.equal(publicAddress(address),false,address);
  for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(publicAddress(address),true,address);
});
test('one runtime owns the data directory and live stores do not trigger crash recovery',async t=>{
  const store=await fixture(t);store.claimRuntime('first');assert.throws(()=>store.claimRuntime('second'),/活动/);store.releaseRuntime('wrong');assert.throws(()=>store.claimRuntime('second'),/活动/);store.releaseRuntime('first');store.claimRuntime('second');store.releaseRuntime('second');
});
test('quoted external preferences cannot become user memory',async t=>{const store=await fixture(t);const s=scopeKey(scope());store.accept(message('external','网页引用：我喜欢咖啡'));assert.throws(()=>store.remember(s,'drink','咖啡','external','我喜欢咖啡'),/完整原文行/);});
test('reset cancels active work, preserves other users and prevents late outputs',async t=>{
  const entered=gate();let f:any;f=await runtimeFixture(t,async(binding,messages,signal)=>{if(binding.scope.senderId==='alice'){entered.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}return{turnId:'t',outputs:[{type:'text',text:binding.scope.senderId}],snapshot:freezeTurn(f.store.config('default'),f.store.bot('one'),binding.scope,messages.map(m=>m.id))};});
  await f.runtime.receive(message('a','work'));const processing=f.runtime.process(scopeKey(scope()));await entered.promise;const before=f.store.binding(scope()).sessionId;
  await f.runtime.receive(message('b','bob work',scope('one','bob')));await f.runtime.process(scopeKey(scope('one','bob')));
  await f.runtime.receive(message('reset','/reset'));await processing;assert.notEqual(f.store.binding(scope()).sessionId,before);assert.equal(f.store.messages(scopeKey(scope()),['cancelled']).length,2);assert.deepEqual(f.store.deliveries().map((d:any)=>d.output.text),['bob']);
});
test('new output appended during an active send is drained without needing another inbound event',async t=>{
  const entered=gate(),wait=gate();let count=0;const f=await runtimeFixture(t,async()=>{throw Error('unused');},async()=>{if(count++===0){entered.resolve();await wait.promise;}return 'receipt';});const binding=f.store.binding(scope());
  f.store.enqueue(binding,'one','t1',[{type:'text',text:'one'}],{});const flushing=f.runtime.flushDeliveries();await entered.promise;f.store.enqueue(binding,'two','t2',[{type:'text',text:'two'}],{});wait.resolve();await flushing;assert.equal(f.store.deliveries(['sent']).length,2);
});
