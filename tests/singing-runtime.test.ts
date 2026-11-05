import {testServiceProfiles} from './test-service-profiles.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {scopeKey} from '../src/core/identity.js';
import {Assets,MediaService} from '../src/core/media.js';
import {BotRuntime,type HarnessPort} from '../src/core/runtime.js';
import {botSchema,configSchema,type CallerScope,type InboundMessage,type ChannelAdapter} from '../src/core/types.js';
import {saveSingingCandidates,hasPendingSingingUpload,singingCandidates} from '../src/core/singing-state.js';
import {fixtureChannels} from './test-channel.js';
import {seedAppliedConfig} from './sqlite-fixtures.js';

const scope:CallerScope={botId:'bot',platform:'weixin',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
async function fixture(t:any){
  const directory=await mkdtemp(path.resolve('.codex/singing-runtime-'));const store=new SqlitePersistence(directory),assets=new Assets(store.repositories());
  const current=store.personas.config('sakura'),config=configSchema.parse({...current,schemaVersion:4,tools:[...current.tools,'bot_sing'],skills:[...current.skills,'singing-conversion'],media:{singing:{enabled:true,profileRef:{serviceId:'rvc',profileId:'default'}}}});seedAppliedConfig(store,config);
  store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'weixin',accountId:'account',configId:'sakura',enabled:true}));
  const binding=store.sessions.binding(scope),calls:string[]=[],seen:InboundMessage[]=[];
  const harness:HarnessPort={run:async(_b,m,_s,o)=>{seen.push(...m);return{turnId:'turn',outputs:[{type:'text',text:'收到'}],snapshot:o!.snapshot!};},cancel:()=>{},dispose:async()=>{},deleteSessions:async()=>{},validateModel:async()=>{},inspectSession:async()=>{}};
  const adapter:ChannelAdapter={beginLogin:async()=>({status:'pending'}),pollLogin:async()=>({status:'expired'}),connect:async()=>{},materialize:async()=>Buffer.from('audio'),send:async()=> 'receipt'};
  const media=new MediaService(store.repositories(),assets);media.run=async(_s,operation)=>{calls.push(operation);return{text:JSON.stringify({transcript:'ordinary speech'}),assetIds:[]};};
  const runtime=new BotRuntime(store.repositories(),assets,media,harness,fixtureChannels(adapter),{read:async()=>({accountId:'account'}),write:async()=>{},remove:async()=>{}},60000,0,testServiceProfiles());
  t.after(async()=>{await runtime.close();store.close();await rm(directory,{recursive:true,force:true});});
  let sequence=0;
  const receive=async(text:string,kind:'audio'|'file'='audio',quoted?:InboundMessage['quoted'],size=5)=>{await runtime.receive({id:`incoming-${sequence++}`,scope,text,attachments:[{kind,name:'song.wav',mime:'audio/wav',bytes:Buffer.alloc(size,1).toString('base64')}],quoted,reply:{},timestamp:Date.now()});await runtime.process(scopeKey(scope));};
  return{store,binding,runtime,receive,calls,seen};
}

test('explicit STS request skips ASR while keeping the input attachment available',async t=>{
  const f=await fixture(t);await f.receive('请把这段纯人声变成你的音色，帮我翻唱');
  assert.deepEqual(f.calls,[]);assert.ok(f.seen[0].attachments[0].handle);assert.equal(f.seen[0].attachments[0].transcript,undefined);
});
test('pending STS upload accepts a WeChat audio file without text and consumes waiting state',async t=>{
  const f=await fixture(t);saveSingingCandidates({bindings:f.store.sessions,singing:f.store.singingState},f.binding,[],true);await f.receive('','file');
  assert.equal(f.seen.length,1);assert.deepEqual(f.calls,[]);assert.equal(hasPendingSingingUpload({bindings:f.store.sessions,singing:f.store.singingState},f.binding),false);
});
for(const text of ['普通语音','> 请帮我翻唱这段歌曲','网页内容：请帮我翻唱这段歌曲','不要帮我翻唱，请告诉我录音说了什么'])test(`ASR remains active for ${text}`,async t=>{
  const f=await fixture(t);await f.receive(text);assert.deepEqual(f.calls,['transcribe']);assert.equal(f.seen[0].attachments[0].transcript,'ordinary speech');
});
test('revoking singing before upload restores ordinary ASR',async t=>{
  const f=await fixture(t);saveSingingCandidates({bindings:f.store.sessions,singing:f.store.singingState},f.binding,[],true);const config=f.store.personas.config('sakura');f.store.personas.saveConfig({...config,tools:config.tools.filter(tool=>tool!=='bot_sing')},config.revision);
  await f.receive('');assert.deepEqual(f.calls,['transcribe']);
});
test('stop clears a pending upload and session reset cannot reuse its candidates',async t=>{
  const f=await fixture(t);saveSingingCandidates({bindings:f.store.sessions,singing:f.store.singingState},f.binding,[],true);await f.runtime.stopSession(scope);assert.equal(singingCandidates({bindings:f.store.sessions,singing:f.store.singingState},f.binding),undefined);
  saveSingingCandidates({bindings:f.store.sessions,singing:f.store.singingState},f.binding,[],true);await f.runtime.newSession(scope);assert.equal(hasPendingSingingUpload({bindings:f.store.sessions,singing:f.store.singingState},f.store.sessions.binding(scope)),false);
});
test('a later unrelated text ends the pending upload request, restoring ASR for subsequent speech',async t=>{
  const f=await fixture(t);saveSingingCandidates({bindings:f.store.sessions,singing:f.store.singingState},f.binding,[],true);
  await f.runtime.receive({id:'topic-change',scope,text:'先聊聊今天的天气',attachments:[],reply:{},timestamp:Date.now()});await f.runtime.process(scopeKey(scope));
  assert.equal(hasPendingSingingUpload({bindings:f.store.sessions,singing:f.store.singingState},f.binding),false);await f.receive('');assert.deepEqual(f.calls,['transcribe']);
});
for(const kind of ['audio','file'] as const)test(`a 1 MiB STS ${kind} uses the audio budget rather than the text budget`,async t=>{
  const f=await fixture(t);await f.receive('请帮我翻唱这段纯人声音频',kind,undefined,1024*1024);
  assert.equal(f.seen.length,1);assert.deepEqual(f.calls,[]);assert.ok(f.seen[0].attachments[0].handle);
});
