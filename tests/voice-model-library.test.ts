import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Store} from '../src/infrastructure/sqlite/store.js';
import {ProfileStore} from '../src/core/profile-store.js';
import {VoiceModelLibrary,type VoiceScannerContext} from '../src/core/voice-model-library.js';
import {GptSovitsServiceAdapter} from '../src/core/gpt-sovits-adapter.js';
import {RvcCliServiceAdapter} from '../src/core/rvc-cli-adapter.js';
import {ServiceManagement} from '../src/core/service-management.js';
import {Admin} from '../src/harness/admin.js';
import {adminCommandRequestSchema,adminQueryRequestSchema} from '../src/harness/admin-contract.js';
import {configSchema} from '../src/core/types.js';

const resources=[
  '.codex/venv/'+(process.platform==='win32'?'Scripts/python.exe':'bin/python'),'scripts/model_catalog.py',
  'RVC/assets/hubert_base/config.json','RVC/assets/hubert_base/pytorch_model.bin','RVC/assets/rmvpe/rmvpe.pt',
  'RVC/assets/pymss_weights/model_bs_roformer_ep_368_sdr_12.9628.ckpt',
  'GPT-SoVITS/GPT_SoVITS/pretrained_models/chinese-hubert-base/config.json',
  'GPT-SoVITS/GPT_SoVITS/pretrained_models/chinese-hubert-base/pytorch_model.bin',
  'GPT-SoVITS/GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large/config.json',
  'GPT-SoVITS/GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large/pytorch_model.bin',
  'GPT-SoVITS/GPT_SoVITS/pretrained_models/gsv-v4-pretrained/s2Gv4.pth',
  'GPT-SoVITS/GPT_SoVITS/pretrained_models/gsv-v4-pretrained/vocoder.pth',
  'models/rvc/voice/v2/model.pth','models/rvc/voice/v2/model.index',
  'models/gpt-sovits/voice/v4-zh/gpt.ckpt','models/gpt-sovits/voice/v4-zh/sovits.pth','models/gpt-sovits/voice/v4-zh/references/default.wav',
];
function models(){return[
  {id:'voice-v2',serviceId:'rvc',displayName:'角色',modelVersion:'v2',state:'ready',files:{weights:'rvc/voice/v2/model.pth',index:'rvc/voice/v2/model.index'},resourceHash:'a'.repeat(64),diagnostics:[]},
  {id:'voice-v4-zh',serviceId:'gpt-sovits',displayName:'角色',modelVersion:'v4',state:'ready',files:{gpt:'gpt-sovits/voice/v4-zh/gpt.ckpt',sovits:'gpt-sovits/voice/v4-zh/sovits.pth',reference:'gpt-sovits/voice/v4-zh/references/default.wav'},reference:{text:'参考文本。',promptLang:'all_zh',textLang:'all_zh'},resourceHash:'b'.repeat(64),diagnostics:[]},
];}
async function fixture(t:any){
  await mkdir(path.resolve('.codex'),{recursive:true});const root=await mkdtemp(path.resolve('.codex/voice-library-')),project=path.join(root,'project'),store=new Store(path.join(root,'store'),path.join(root,'personas')),profiles=new ProfileStore(store.persistence.profiles);
  for(const relative of resources){const file=path.join(project,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'fixture');}
  let result:any={version:1,models:models(),diagnostics:[]},calls=0,context:VoiceScannerContext|undefined;
  const library=new VoiceModelLibrary(store.persistence.voiceLibrarySettings,store.home,profiles,{scan:async value=>{calls++;context=value;return result;},device:async()=> 'cuda'},{modelsRoot:'',gptSovitsUrl:'http://127.0.0.1:9880'});
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  const save=()=>library.save({modelsRoot:path.join(project,'models'),gptSovitsUrl:'http://127.0.0.1:9880/',expectedRevision:library.view().revision},new AbortController().signal);
  return{root,project,store,profiles,library,save,calls:()=>calls,context:()=>context,setResult:(value:unknown)=>result=value};
}

test('operator settings discover independent strict adapter profiles without changing personas',async t=>{
  const f=await fixture(t),before=JSON.stringify(f.store.configs()),view=await f.save();
  assert.equal(view.reports.rvc.state,'ready');assert.equal(view.reports['gpt-sovits'].state,'ready');assert.equal(f.calls(),1);
  assert.equal(f.context()?.script,path.join(f.project,'scripts','model_catalog.py'));assert.equal(f.context()?.python,path.join(f.project,'.codex','venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'));
  const rvc=f.profiles.require({serviceId:'rvc',profileId:'voice-v2'}),gpt=f.profiles.require({serviceId:'gpt-sovits',profileId:'voice-v4-zh'});
  assert.equal(rvc.managedConfig.device,'cuda');assert.equal(rvc.managedConfig.indexRate,0.75);assert.equal((rvc.managedConfig.separation as any).enabled,true);
  assert.equal(gpt.managedConfig.healthPath,'/openapi.json');assert.equal(gpt.managedConfig.baseUrl,'http://127.0.0.1:9880');
  assert.equal('__discovery' in gpt.managedConfig,false);assert.equal('__discovery' in rvc.managedConfig,false);
  assert.equal((await new RvcCliServiceAdapter({run:async()=>{throw Error('not called');},cancel:async()=> 'cancelled'}).health(rvc,new AbortController().signal)).state,'ready');
  let received:any;const adapter=new GptSovitsServiceAdapter({run:async()=>({})},{check:async config=>{received=config;return true;}});
  assert.equal((await adapter.health(gpt,new AbortController().signal)).state,'ready');assert.equal(received.promptText,'参考文本。');
  assert.equal(JSON.stringify(f.store.configs()),before);assert.doesNotMatch(JSON.stringify(f.profiles.list()),/model\.pth|baseUrl|sourceId|resourceHash|modelsRoot/);
});

test('refresh is idempotent and model updates and removals affect only the owned profile',async t=>{
  const f=await fixture(t);await f.save();const first=f.profiles.require({serviceId:'rvc',profileId:'voice-v2'}),gpt=f.profiles.require({serviceId:'gpt-sovits',profileId:'voice-v4-zh'});
  f.profiles.create({serviceId:'rvc',profileId:'manual',state:'ready',displayName:'Manual',capabilities:['rvc.convert'],managedConfig:{private:'unchanged'}});
  await f.library.refresh(new AbortController().signal);assert.equal(f.profiles.require(first).revision,first.revision);assert.equal(f.profiles.require(gpt).revision,gpt.revision);
  const updated=models();updated[0].resourceHash='c'.repeat(64);f.setResult({version:1,models:updated,diagnostics:[]});await f.library.refresh(new AbortController().signal);
  assert.equal(f.profiles.require(first).revision,first.revision+1);assert.equal(f.profiles.require(gpt).revision,gpt.revision);
  f.setResult({version:1,models:[updated[1]],diagnostics:[]});await f.library.refresh(new AbortController().signal);
  assert.equal(f.profiles.require(first).state,'missing');assert.equal(f.profiles.require({serviceId:'rvc',profileId:'manual'}).state,'ready');
});

test('settings require the current revision and empty roots disable discovery without selecting another model',async t=>{
  const f=await fixture(t),initial=f.library.view();await f.save();
  await assert.rejects(f.library.save({modelsRoot:'',gptSovitsUrl:initial.gptSovitsUrl,expectedRevision:initial.revision},new AbortController().signal),/配置已变化/);
  await assert.rejects(f.library.save({modelsRoot:'',gptSovitsUrl:initial.gptSovitsUrl},new AbortController().signal),/配置已变化/);
  const view=await f.library.save({modelsRoot:'',gptSovitsUrl:initial.gptSovitsUrl,expectedRevision:f.library.view().revision},new AbortController().signal);
  assert.equal(view.reports.rvc.state,'missing');assert.equal(f.profiles.require({serviceId:'rvc',profileId:'voice-v2'}).state,'missing');assert.equal(f.calls(),1);
});

test('missing references and environment resources stay blocked with operator-visible diagnostics',async t=>{
  const f=await fixture(t);await rm(path.join(f.project,'models/gpt-sovits/voice/v4-zh/references/default.wav'));await rm(path.join(f.project,'RVC/assets/rmvpe/rmvpe.pt'));
  const view=await f.save();assert.equal(view.reports.rvc.state,'blocked');assert.equal(view.reports['gpt-sovits'].state,'blocked');
  assert.match(view.reports.rvc.models[0].diagnostics.join(' '),/RMVPE/);assert.match(view.reports['gpt-sovits'].models[0].diagnostics.join(' '),/参考音频/);
  assert.doesNotMatch(JSON.stringify(view.reports),/model\.pth|default\.wav|\.codex/);
});

test('RVC without an index stays ready with zero retrieval and scanner path escapes are rejected',async t=>{
  const f=await fixture(t),items=models();delete items[0].files.index;f.setResult({version:1,models:items,diagnostics:[]});await f.save();
  assert.equal(f.profiles.require({serviceId:'rvc',profileId:'voice-v2'}).managedConfig.indexRate,0);
  items[0].files.weights='../outside.pth';f.setResult({version:1,models:items,diagnostics:[]});await f.library.refresh(new AbortController().signal);
  assert.equal(f.library.view().reports.rvc.state,'blocked');assert.equal(f.profiles.require({serviceId:'rvc',profileId:'voice-v2'}).state,'blocked');
});

test('admin settings and refresh use versioned operator interfaces and share a full library scan',async t=>{
  const f=await fixture(t),management=new ServiceManagement({personas:f.store.persistence.personas,capabilities:f.store.persistence.capability,health:f.store.persistence.capability},f.profiles,{host:{catalog:{require:()=>{}}}} as any,{models:async()=>[]},new Map(),f.library),admin=new Admin({} as any,{store:f.store,profiles:f.profiles} as any,'token',undefined,undefined,management);
  assert.doesNotThrow(()=>adminQueryRequestSchema.parse({version:1,kind:'query',name:'service.settings',input:{}}));
  const initial:any=await admin.query({version:1,kind:'query',name:'service.settings',input:{}});assert.equal(initial.revision,initial.data.revision);
  const saved:any=await admin.command({version:1,kind:'command',name:'service.settings.save',input:{modelsRoot:path.join(f.project,'models'),gptSovitsUrl:initial.data.gptSovitsUrl,expectedRevision:initial.data.revision}});
  assert.equal(saved.data.reports.rvc.profileCount,1);assert.equal(saved.data.reports['gpt-sovits'].profileCount,1);
  const refreshed:any=await admin.command({version:1,kind:'command',name:'service.refresh',input:{serviceId:'rvc'}});assert.equal(refreshed.data.state,'ready');assert.equal(refreshed.data.profileCount,1);
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'service.settings.save',input:{modelsRoot:'relative/path',gptSovitsUrl:'http://127.0.0.1:9880'}}));
  assert.throws(()=>adminCommandRequestSchema.parse({version:1,kind:'command',name:'service.settings.save',input:{modelsRoot:'',gptSovitsUrl:'http://user:secret@example.invalid'}}));
});

test('applying a newly selected voice profile rechecks its current availability without blocking unrelated edits',async t=>{
  const f=await fixture(t);await f.save();
  const management=new ServiceManagement({personas:f.store.persistence.personas,capabilities:f.store.persistence.capability,health:f.store.persistence.capability},f.profiles,{} as any,{models:async()=>[]}),original=f.store.config('default'),selected=configSchema.parse({...original,media:{...original.media,voice:{enabled:true,profileRef:{serviceId:'gpt-sovits',profileId:'voice-v4-zh'},format:'wav'}}});
  const admin=new Admin({} as any,{repos:f.store.repositories(),saveConfig:(config:unknown,expectedRevision:number)=>f.store.saveConfig(config,expectedRevision)} as any,'token',undefined,undefined,management);
  f.profiles.transition({serviceId:'gpt-sovits',profileId:'voice-v4-zh'},'blocked');
  await assert.rejects(admin.invoke('config.save',{config:selected,expectedRevision:original.revision}),/模型不可用/);assert.equal(f.store.config('default').revision,original.revision);
  const blocked=f.profiles.require({serviceId:'gpt-sovits',profileId:'voice-v4-zh'});f.profiles.create({...blocked,state:'ready'});
  const applied:any=await admin.invoke('config.save',{config:selected,expectedRevision:original.revision});
  f.profiles.transition({serviceId:'gpt-sovits',profileId:'voice-v4-zh'},'missing');
  const renamed:any=await admin.invoke('config.save',{config:{...applied,name:'Renamed'},expectedRevision:applied.revision});assert.equal(renamed.name,'Renamed');
  await assert.rejects(admin.invoke('config.save',{config:{...renamed,name:'Stale'},expectedRevision:applied.revision}),/配置已被其他操作修改/);
  const disabled:any=await admin.invoke('config.save',{config:{...renamed,media:{...renamed.media,voice:{...renamed.media.voice,enabled:false}}},expectedRevision:renamed.revision});
  await assert.rejects(admin.invoke('config.save',{config:{...disabled,media:{...disabled.media,voice:{...disabled.media.voice,enabled:true}}},expectedRevision:disabled.revision}),/模型不可用/);
});

test('scanner failures block existing owned models and duplicated IDs only block their own model',async t=>{
  const f=await fixture(t);await f.save();
  const duplicated=models();f.setResult({version:1,models:[...duplicated,duplicated[0]],diagnostics:[]});await f.library.refresh(new AbortController().signal);
  assert.equal(f.library.view().reports.rvc.state,'blocked');assert.match(f.library.view().reports.rvc.models[0].diagnostics.join(' '),/相同模型 ID/);
  assert.equal(f.library.view().reports['gpt-sovits'].state,'ready');
  f.setResult({version:1,models:[],diagnostics:['read failed'],error:'SCAN_FAILED'});await f.library.refresh(new AbortController().signal);
  assert.equal(f.profiles.require({serviceId:'gpt-sovits',profileId:'voice-v4-zh'}).state,'blocked');
  assert.equal(f.library.view().reports['gpt-sovits'].state,'blocked');
});
