import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {botSchema,configSchema,type CallerScope,type Delivery} from '../src/core/types.js';
import {fixtureChannels} from './test-channel.js';
import {seedAppliedConfig} from './sqlite-fixtures.js';

type Flow='foreground'|'scheduled'|'proactive';
async function fixture(t:TestContext,platform='qq',automaticVoice=false){
  const directory=await mkdtemp(path.resolve('.codex/segmented-replies-')),store=new SqlitePersistence(directory),assets=new Assets(store.repositories());
  const config=configSchema.parse({...store.personas.config('sakura'),schemaVersion:4,progressReply:{enabled:false},media:{voice:{enabled:true,protocol:'edge_tts',replyMode:automaticVoice?'auto':'on_demand',format:'mp3'}}});seedAppliedConfig(store,config);
  store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:platform,accountId:'account',configId:'sakura',enabled:true,trustedUsers:['owner']}));
  const scope:CallerScope={botId:'bot',platform,accountId:'account',kind:'private',channelId:'owner',senderId:'owner'},binding=store.sessions.binding(scope);
  const reply:Record<string,string>=platform==='qq'?{target:'owner',kind:'private',msgId:'incoming'}:{target:'owner',contextToken:'context-token'};
  store.inbox.accept({id:'context',scope,text:'已有上下文',attachments:[],timestamp:Date.now()-3600000,reply});store.inbox.mark(binding.key,['context'],'complete');
  const audio=await assets.save(binding.key,{kind:'audio',name:'speech.mp3',mime:'audio/mpeg'},Buffer.from('audio'));
  const artifact=await assets.save(binding.key,{kind:'file',name:'result.txt',mime:'text/plain'},Buffer.from('result'));
  const sent:Delivery[]=[],spoken:string[]=[];
  const harness:HarnessPort={run:async(_b,_m,_s,options)=>({turnId:'turn',outputs:[{type:'text',text:'结尾'}],snapshot:options!.snapshot!}),cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{}};
  const adapter={beginLogin:async()=>({status:'pending' as const}),pollLogin:async()=>({status:'expired' as const}),connect:async()=>{},materialize:async()=>Buffer.alloc(0),send:async(_b:any,_c:any,delivery:Delivery)=>{sent.push(delivery);return`receipt-${delivery.index}`;}};
  const media=new MediaService(store.repositories(),assets);media.run=async(_scope,operation,_config,_inputs,parameters,_signal,authorize)=>{assert.equal(operation,'voice_speak');authorize?.();spoken.push(parameters.text as string);return{assetIds:[audio.id]};};
  const runtime=new BotRuntime(store.repositories(),assets,media,harness,fixtureChannels(adapter),{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},60000);
  const run=async(flow:Flow='foreground')=>{
    if(flow==='scheduled')return runtime.automation.runJob(runtime.automation.createJob(scope,'处理资料',{runAt:Date.now()+3600000}));
    if(flow==='proactive'){runtime.automation.configureProactive(scope,{enabled:false});return runtime.automation.runProactive(scope,true);}
    await runtime.receive({id:'incoming',scope,text:'请处理这份资料',attachments:[],timestamp:Date.now(),reply});await runtime.process(binding.key);
  };
  t.after(async()=>{await runtime.close();store.close();await rm(directory,{recursive:true,force:true});});
  return{store,runtime,harness,adapter,binding,scope,artifact,audio,sent,spoken,run};
}

for(const platform of ['qq','weixin'])test(`${platform} sends committed text before tools finish and appends final text and artifacts once`,async t=>{
  const f=await fixture(t,platform),first='甲'.repeat(1000),second='乙'.repeat(2000);
  f.harness.run=async(_b,_m,_s,options)=>{
    await options!.onText!({turnId:'turn',text:first});assert.deepEqual(f.sent.map(item=>item.output.text),[first]);assert.equal(f.store.inbox.messages(f.binding.key,['processing']).length,1);
    await options!.onText!({turnId:'turn',text:second});assert.deepEqual(f.sent.map(item=>item.output.text),[first,second.slice(0,1800),second.slice(1800)]);
    return{turnId:'turn',outputs:[{type:'text',text:'结尾'},{type:'asset',assetId:f.artifact.id}],snapshot:options!.snapshot!};
  };
  await f.run();await f.runtime.flushDeliveries();
  const rows=f.store.deliveries.deliveries();assert.equal(rows.length,5);assert.equal(f.sent.length,5);assert.deepEqual(rows.map(item=>item.index),[0,1,2,3,4]);assert.ok(rows.every(item=>item.state==='sent'&&item.turnId==='turn'&&item.purpose===undefined));
  assert.deepEqual(rows.map(item=>item.output),[{type:'text',text:first},{type:'text',text:second.slice(0,1800)},{type:'text',text:second.slice(1800)},{type:'text',text:'结尾'},{type:'asset',assetId:f.artifact.id}]);
  assert.deepEqual(rows.map(item=>item.replySequence),platform==='qq'?[1,2,3,4,5]:[undefined,undefined,undefined,undefined,undefined]);assert.equal(f.store.inbox.messages(f.binding.key,['complete']).length,2);
});

for(const flow of ['foreground','scheduled','proactive'] as const)test(`${flow} synthesizes only final text after delivering the earlier body`,async t=>{
  const f=await fixture(t,'qq',true);
  f.harness.run=async(_b,_m,_s,options)=>{
    await options!.onText!({turnId:'turn',text:'先说明处理步骤。'});assert.equal(f.sent[0].output.text,'先说明处理步骤。');assert.deepEqual(f.spoken,[]);
    return{turnId:'turn',outputs:[{type:'text',text:'处理完成。'},{type:'asset',assetId:f.artifact.id}],snapshot:options!.snapshot!};
  };
  const run=await f.run(flow);if(flow!=='foreground'){assert.ok(run);assert.equal(run.state,'succeeded');assert.ok(f.sent.every(item=>item.reply.msgId===undefined));}
  assert.deepEqual(f.spoken,['处理完成。']);assert.equal(f.sent.length,4);assert.deepEqual(f.sent.map(item=>item.index),[0,1,2,3]);assert.ok(f.sent[1].output.text?.startsWith('处理完成。'));assert.deepEqual(f.sent.slice(2).map(item=>item.output.assetId),[f.artifact.id,f.audio.id]);assert.equal(new Set(f.sent.map(item=>item.turnId)).size,1);
});

for(const flow of ['foreground','scheduled'] as const)test(`${flow} accepts an empty ending when committed text was already delivered`,async t=>{
  const f=await fixture(t,'qq',true);
  f.harness.run=async(_b,_m,_s,options)=>{await options!.onText!({turnId:'turn',text:'正文已完整说明。'});return{turnId:'turn',outputs:[],snapshot:options!.snapshot!};};
  const run=await f.run(flow);if(flow==='scheduled'){assert.ok(run);assert.equal(run.state,'succeeded');}else assert.equal(f.store.inbox.messages(f.binding.key,['failed']).length,0);
  assert.deepEqual(f.sent.map(item=>item.output.text),['正文已完整说明。']);assert.deepEqual(f.spoken,[]);
});

for(const flow of ['foreground','scheduled'] as const)test(`${flow} preserves delivered text and appends a model failure in the same ordered turn`,async t=>{
  const f=await fixture(t);
  f.harness.run=async(_b,_m,_s,options)=>{await options!.onText!({turnId:'turn',text:'先开始处理。'});throw Error('MODEL_BROKEN');};
  const run=await f.run(flow);if(flow==='scheduled'){assert.ok(run);assert.equal(run.state,'failed');assert.equal(run.error,'MODEL_BROKEN');}else assert.equal(f.store.inbox.messages(f.binding.key,['failed']).length,1);
  const rows=f.store.deliveries.deliveries();assert.equal(rows.length,2);assert.equal(rows[0].output.text,'先开始处理。');assert.match(rows[1].output.text!,/MODEL_BROKEN/);assert.equal(rows[0].turnId,rows[1].turnId);assert.deepEqual(rows.map(item=>item.index),[0,1]);assert.ok(rows.every(item=>item.state==='sent'));
});

test('a failed earlier send does not stop the model or create a second intent for that text',async t=>{
  const f=await fixture(t);f.adapter.send=async(_b,_c,delivery)=>{f.sent.push(delivery);if(delivery.index===0)throw Error('SEND_REJECTED');return'receipt';};
  f.harness.run=async(_b,_m,_s,options)=>{await options!.onText!({turnId:'turn',text:'前文'});return{turnId:'turn',outputs:[{type:'text',text:'结尾'}],snapshot:options!.snapshot!};};
  await f.run();assert.deepEqual(f.store.deliveries.deliveries().map(item=>item.state),['failed','sent']);assert.deepEqual(f.sent.map(item=>item.output.text),['前文','结尾']);assert.equal(f.store.inbox.messages(f.binding.key,['failed']).length,0);
});

test('stopping after the first segment keeps that receipt and rejects later text and final output',async t=>{
  const f=await fixture(t);let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  f.harness.run=async(_b,_m,signal,options)=>{await options!.onText!({turnId:'turn',text:'前文'});entered();await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));await assert.rejects(()=>options!.onText!({turnId:'turn',text:'不应发送'}));return{turnId:'turn',outputs:[{type:'text',text:'不应发送结尾'}],snapshot:options!.snapshot!};};
  const work=f.run();await started;await f.runtime.stopSession(f.scope);await work;
  assert.deepEqual(f.sent.map(item=>item.output.text),['前文']);assert.equal(f.store.deliveries.deliveries()[0].state,'sent');assert.equal(f.store.inbox.messages(f.binding.key,['cancelled']).length,1);
});

test('revoked permission suppresses later segments without retracting earlier text',async t=>{
  const f=await fixture(t);f.harness.run=async(_b,_m,_s,options)=>{await options!.onText!({turnId:'turn',text:'前文'});f.store.bots.saveBot({...f.store.bots.bot('bot'),trustedUsers:[]});await options!.onText!({turnId:'turn',text:'不应发送'});throw Error('unreachable');};
  await f.run();assert.deepEqual(f.sent.map(item=>item.output.text),['前文']);assert.equal(f.store.inbox.messages(f.binding.key,['cancelled']).length,1);
});

for(const change of ['pause','delete','revoke'] as const)test(`automation ${change} after the first segment prevents later text and final output`,async t=>{
  const f=await fixture(t),job=f.runtime.automation.createJob(f.scope,'处理资料',{runAt:Date.now()+3600000});
  f.harness.run=async(_b,_m,_s,options)=>{
    await options!.onText!({turnId:'turn',text:'前文'});
    if(change==='pause')f.runtime.automation.setJob(job.id,false);else if(change==='delete')f.runtime.automation.deleteJob(job.id);else f.store.bots.saveBot({...f.store.bots.bot('bot'),trustedUsers:[]});
    await options!.onText!({turnId:'turn',text:'不应发送'});throw Error('unreachable');
  };
  const result=await f.runtime.automation.runJob(job);assert.equal(result.state,'failed');assert.deepEqual(f.sent.map(item=>item.output.text),['前文']);assert.equal(f.store.deliveries.deliveries()[0].state,'sent');
});
