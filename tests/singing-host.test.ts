import {testServiceProfiles} from './test-service-profiles.js';
import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/core/store.js';
import {ProfileStore} from '../src/core/profile-store.js';
import {Assets,MediaService} from '../src/core/media.js';
import {botSchema,configSchema,type CallerScope} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';
import {executeSingingTool,type SingingContext} from '../src/harness/singing-tool.js';
import {hasPendingSingingUpload,consumeSingingUpload,explicitSingingRequest,singingCandidates,saveSingingCandidates} from '../src/core/singing-state.js';
import {NativeHarness} from '../src/harness/bridge.js';
import {ServiceContractError} from '../src/core/service-errors.js';

const singing={enabled:true,profileRef:{serviceId:'rvc',profileId:'default'},defaultOutput:'mp3'};
async function fixture(t:TestContext){
  await mkdir(path.resolve('.codex'),{recursive:true});
  const home=await mkdtemp(path.resolve('.codex/singing-host-')),store=new Store(home,path.join(home,'personas'));
  t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});
  const config=configSchema.parse({id:'singing',name:'Singing',personaPrompt:'Hello',skills:['singing-conversion'],tools:['bot_sing','web_search','web_fetch'],media:{singing}});
  store.put('config',config.id,config);store.put('config-version',`${config.id}:${config.revision}`,config);const bot=store.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'bot',configId:config.id,enabled:true}));
  const scope:CallerScope={botId:bot.id,platform:'qq',accountId:'bot',channelId:'alice',senderId:'alice',kind:'private'},binding=store.binding(scope);
  const assets=new Assets(store);assets.workspace=async scope=>path.join(home,'workspaces',scope);
  const snapshot=freezeTurn(config,bot,scope,['request'],testServiceProfiles());const live:SingingContext={binding,snapshot,singing:{attempted:false},assets:[]};
  const deps={store,assets,media:{} as MediaService,current:()=>config,bot:()=>bot};
  const call=(args:Record<string,unknown>)=>executeSingingTool(live,args,new AbortController().signal,deps);
  const input=await assets.save(binding.key,{kind:'file',mime:'application/octet-stream',name:'vocals.wav'},Buffer.from('source'));
  return{home,store,assets,config,bot,binding,live,deps,call,input};
}
async function prepare(f:Awaited<ReturnType<typeof fixture>>){return JSON.parse(await f.call({action:'prepare',inputs:[f.input.id]}));}

test('singing candidates resolve explicit old session-owned files and reject cross-session references',async t=>{
  const f=await fixture(t);f.assets.recent=()=>[];
  const first=await prepare(f);assert.equal(first.candidates[0].title,'vocals.wav');assert.equal(first.candidates[0].assetId,undefined);
  f.store.saveAsset({...f.input,sessionId:'another-session'});
  await assert.rejects(prepare(f),/SINGING_ATTACHMENT_INVALID/);
  f.store.reset(f.binding.scope);assert.equal(singingCandidates(f.store,f.binding),undefined); // current binding is checked on mutation
  await assert.rejects(prepare(f),/SINGING_SESSION_CHANGED/);
});

test('candidate set replacement cannot redirect an old selection and invalid input never starts work',async t=>{
  const f=await fixture(t),first=await prepare(f),second=await prepare(f);let calls=0;f.deps.media={run:async()=>{calls++;return{assetIds:[]};}} as any;
  await assert.rejects(f.call({action:'convert',candidateSet:first.candidateSet,candidate:1,sourceType:'vocals'}),/SINGING_CANDIDATES_STALE/);
  await assert.rejects(f.call({action:'convert',candidateSet:second.candidateSet,candidate:1,sourceType:'unknown'}),/SINGING_SOURCE_TYPE_REQUIRED/);
  assert.equal(calls,0);
});

test('conversion attempts survive prepare and redact worker internals without repeating a failed call',async t=>{
  const f=await fixture(t),p=await prepare(f);let calls=0;
  f.deps.media={run:async()=>{calls++;throw Error('private C:\\models\\weights.pth traceback');}} as any;
  const convert=(candidateSet:string)=>f.call({action:'convert',candidateSet,candidate:1,sourceType:'vocals'});
  await assert.rejects(convert(p.candidateSet),/^Error: SINGING_CONVERSION_FAILED$/);
  const replaced=await prepare(f);await assert.rejects(convert(replaced.candidateSet),/SINGING_CONVERSION_FAILED/);
  assert.equal(calls,1);assert.equal(f.live.singing.attempted,true);
});

test('v4 conversion preserves only safe singing provider codes and hides service diagnostics',async t=>{
  for(const providerCode of ['SINGING_MODEL_INCOMPATIBLE',undefined,'RVC_PROVIDER_FAILED','SINGING_FAILED:private-token'])await t.test(providerCode??'no provider code',async t=>{
    const f=await fixture(t),profiles=new ProfileStore();profiles.create({serviceId:'rvc',profileId:'managed',state:'ready',capabilities:['rvc.convert'],displayName:'RVC',managedConfig:{protocol:'rvc_cli_v1'}});
    const v4=configSchema.parse({schemaVersion:4,id:'managed',name:'Managed',personaPrompt:'A',tools:['bot_sing'],skills:['singing-conversion'],media:{singing:{enabled:true,profileRef:{serviceId:'rvc',profileId:'managed'}}}});f.store.put('config',v4.id,v4);f.live.snapshot=freezeTurn(v4,f.bot,f.binding.scope,['v4-error'],profiles);f.deps.current=()=>v4;
    const prepared=await prepare(f);let calls=0;f.deps.media={run:async()=>{calls++;throw new ServiceContractError({category:'PROVIDER_ERROR',providerCode,safeDiagnostic:'SINGING_PRIVATE_DIAGNOSTIC',retryable:false,blocksService:false},Error('https://provider.invalid/private token=secret'));}} as any;
    const expected=providerCode==='SINGING_MODEL_INCOMPATIBLE'?providerCode:'SINGING_CONVERSION_FAILED',convert=()=>f.call({action:'convert',candidateSet:prepared.candidateSet,candidate:1,sourceType:'vocals'});
    await assert.rejects(convert(),new RegExp(`^Error: ${expected}$`));await assert.rejects(convert(),new RegExp(`^Error: ${expected}$`));
    assert.equal(f.store.get<any>('singing-attempt',f.binding.key)?.code,expected);assert.equal(calls,1);assert.equal(f.live.assets.length,0);
  });
});

test('success returns safe names, reuses one audio asset and forwards only business parameters',async t=>{
  const f=await fixture(t),p=await prepare(f);let calls=0;
  f.deps.media={run:async(_scope:string,_operation:string,config:unknown,inputs:string[],parameters:unknown,_signal:AbortSignal,authorize:()=>void)=>{
    calls++;authorize();assert.deepEqual(inputs,[f.input.id]);assert.deepEqual(config,f.config);assert.deepEqual(parameters,{sourceType:'vocals',format:'mp3'});
    const out=await f.assets.save(f.binding.key,{kind:'audio',mime:'audio/mpeg',name:'converted.mp3'},Buffer.from('converted'),'job');return{assetIds:[out.id]};
  }} as any;
  const args={action:'convert',candidateSet:p.candidateSet,candidate:1,sourceType:'vocals',serviceUrl:'http://evil.invalid',singingWeightsPath:'bad'};
  const result=JSON.parse(await f.call(args));assert.deepEqual(result.files,['converted.mp3']);assert.doesNotMatch(JSON.stringify(result),/models|assetId|serviceUrl|traceback/);
  const reused=JSON.parse(await f.call(args));assert.equal(reused.reused,true);assert.equal(calls,1);assert.equal(f.live.assets.length,1);
});

test('URL candidates require current network permission and pending upload has explicit consumption',async t=>{
  const f=await fixture(t);await f.call({action:'prepare'});assert.equal(hasPendingSingingUpload(f.store,f.binding),true);consumeSingingUpload(f.store,f.binding);assert.equal(hasPendingSingingUpload(f.store,f.binding),false);
  await assert.rejects(f.call({action:'prepare',candidates:[{title:'bad',url:'http://example.org/a.wav'}]}),/SINGING_SOURCE_INVALID/);
  f.deps.current=()=>({...f.config,tools:['bot_sing']});
  await assert.rejects(f.call({action:'prepare',candidates:[{title:'audio',url:'https://example.org/a.wav'}]}),/SINGING_NETWORK_DISABLED/);
});

test('a user supplied HTTPS song URL is registered before conversion and cannot be replaced by convert arguments',async t=>{
  const f=await fixture(t);const prepared=JSON.parse(await f.call({action:'prepare',title:'Song',url:'https://example.org/song.mp3'}));
  assert.equal(prepared.candidates[0].title,'Song');assert.equal(prepared.candidates[0].url,'https://example.org/song.mp3');
  f.deps.media={run:async(_scope:string,_operation:string,_config:unknown,inputs:string[],parameters:Record<string,unknown>)=>{assert.deepEqual(inputs,[]);assert.deepEqual(parameters,{sourceType:'vocals',format:'mp3',url:'https://example.org/song.mp3'});return{assetIds:[]};}} as any;
  await assert.rejects(f.call({action:'convert',candidateSet:prepared.candidateSet,candidate:1,sourceType:'vocals',url:'https://evil.example/other.mp3'}),/SINGING_OUTPUT_INVALID/);
});

test('revocation and session switching are rechecked during execution before result registration',async t=>{
  const f=await fixture(t),p=await prepare(f);
  f.deps.media={run:async(_s:any,_o:any,_c:any,_i:any,_p:any,_signal:any,authorize:()=>void)=>{f.deps.current=()=>({...f.config,media:{...f.config.media,singing:{...f.config.media.singing!,enabled:false}}});authorize();return{assetIds:[]};}} as any;
  await assert.rejects(f.call({action:'convert',candidateSet:p.candidateSet,candidate:1,sourceType:'vocals'}),/SINGING_DISABLED/);assert.equal(f.live.assets.length,0);
});

test('v4 named singing uses the frozen RVC profile and delegates private separation checks to the adapter',async t=>{const f=await fixture(t),profiles=new ProfileStore(),profile=profiles.create({serviceId:'rvc',profileId:'managed',state:'ready',capabilities:['rvc.convert'],displayName:'Managed RVC',managedConfig:{protocol:'rvc_cli_v1',separation:{enabled:true,status:'configured'}}}),v4=configSchema.parse({schemaVersion:4,id:'managed',name:'Managed',personaPrompt:'A',tools:['bot_sing','bot_music'],skills:['singing-conversion','music-download'],media:{singing:{enabled:true,profileRef:{serviceId:'rvc',profileId:'managed'}},music:{enabled:true,profileRef:{serviceId:'music',profileId:'managed'},includeLyrics:false}}});f.store.put('config',v4.id,v4);f.live.snapshot=freezeTurn(v4,f.bot,f.binding.scope,['v4'],profiles);f.deps.current=()=>v4;f.deps.media={run:async(_scope:string,operation:string,_config:any,_inputs:any,parameters:any)=>{assert.equal(operation,'singing_convert');assert.equal(parameters.sourceType,'mixed');const out=await f.assets.save(f.binding.key,{kind:'audio',mime:'audio/mpeg',name:'managed.mp3'},Buffer.from('audio'),'managed-job');return{assetIds:[out.id]};}} as any;const source=await f.assets.save(f.binding.key,{kind:'audio',mime:'audio/mpeg',name:'song.mp3'},Buffer.from('song'),'music-job');(f.deps as any).store.put('music-acquisition',f.binding.key,{scope:f.binding.key,sessionId:f.binding.sessionId,generation:f.binding.generation,request:'other',selectionKey:JSON.stringify({song:'Song',includeLyrics:false}),state:'succeeded',sourceAssetId:source.id,track:{source:'MiguMusicClient',id:'id',title:'Song',artist:'Artist'}});const prepared=saveSingingCandidates(f.store,f.binding,[{title:'Song',assetId:source.id}]);const result=JSON.parse(await f.call({action:'convert',candidateSet:prepared.id,candidate:1,sourceType:'mixed',format:'mp3'}));assert.equal(result.status,'succeeded');assert.equal(profile.state,'ready');});

test('explicit singing intent excludes quoted and webpage content',()=>{
  assert.equal(explicitSingingRequest('请把这段歌声换成你的音色，帮我翻唱'),true);
  assert.equal(explicitSingingRequest('请唱歌：周杰伦《晴天》'),true);
  assert.equal(explicitSingingRequest('帮我唱这个链接 https://example.org/song.mp3'),true);
  assert.equal(explicitSingingRequest('> 帮我翻唱这首歌'),false);
  assert.equal(explicitSingingRequest('网页：帮我翻唱这首歌'),false);
  assert.equal(explicitSingingRequest('普通语音'),false);
});

test('compatibility media dispatch rejects singing before provider or identity lookups',async()=>{
  await assert.rejects((NativeHarness.prototype as any).mediaTool.call({},{} as any,undefined,'singing_convert',[],{},new AbortController().signal),/SINGING_USE_BOT_SING/);
});
