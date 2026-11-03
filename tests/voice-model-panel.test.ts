import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useVoiceModel,voiceModelPicker,voiceLibraryPanel,loadServiceProfiles} from '../src/client/voice-models.js';
import {createUI} from '../src/client/ui.js';
import {configSchema} from '../src/core/types.js';
import type {PublicServiceProfile} from '../src/core/service-management.js';

const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children})};
function nodes(tree:any):any[]{return tree&&typeof tree==='object'?[tree,...(tree.children??[]).flatMap(nodes)]:[];}
const profile=(serviceId='gpt-sovits',state:PublicServiceProfile['state']='ready'):PublicServiceProfile=>({serviceId,profileId:'klee',revision:1,contentHash:'a'.repeat(64),state,capabilities:[serviceId==='rvc'?'rvc.convert':'gpt-sovits.speak'],displayName:'可莉',modelLabel:serviceId==='rvc'?'RVC v2':'GPT-SoVITS v4',updatedAt:1});
const persona=()=>configSchema.parse({schemaVersion:4,id:'test',name:'Persona',personaPrompt:'Original',tools:['bot_media'],skills:['image-generation'],media:{image:{enabled:true,model:'original-image'},voice:{enabled:false,protocol:'edge_tts',voice:'zh-CN-XiaoxiaoNeural',replyMode:'auto',format:'mp3'},singing:{enabled:false,pitchShift:3,defaultOutput:'wav'}}});

test('using a speaking model enables its permissions and WAV while preserving the other role and preferences',()=>{
  const before=persona(),original=structuredClone(before),next=configSchema.parse(useVoiceModel(before,'voice',profile()));
  assert.deepEqual(before,original);assert.equal(next.revision,before.revision);assert.equal(next.media.voice?.enabled,true);assert.equal(next.media.voice?.format,'wav');assert.equal(next.media.voice?.replyMode,'auto');assert.equal(next.media.voice?.protocol,undefined);assert.equal(next.media.voice?.voice,undefined);
  assert.deepEqual(next.media.voice?.profileRef,{serviceId:'gpt-sovits',profileId:'klee'});assert.deepEqual(next.media.singing,before.media.singing);assert.deepEqual(next.media.image,before.media.image);
  assert.deepEqual(next.tools,['bot_media','bot_voice']);assert.deepEqual(next.skills,['image-generation','voice-generation']);
});

test('using a singing model preserves pitch and output and never enables the speaking model',()=>{
  const before=persona(),next=configSchema.parse(useVoiceModel(before,'singing',profile('rvc')));
  assert.equal(next.media.singing?.enabled,true);assert.equal(next.media.singing?.pitchShift,3);assert.equal(next.media.singing?.defaultOutput,'wav');assert.deepEqual(next.media.voice,before.media.voice);
  assert.deepEqual(next.tools,['bot_media','bot_sing']);assert.deepEqual(next.skills,['image-generation','singing-conversion']);
  assert.deepEqual(useVoiceModel(next,'singing',profile('rvc')),next);
});

test('model application rejects incomplete profiles and the wrong service even if called outside the picker',()=>{
  for(const state of ['partial','blocked','missing','disabled','revoked'] as const)assert.throws(()=>useVoiceModel(persona(),'voice',profile('gpt-sovits',state)),/配置完整/);
  assert.throws(()=>useVoiceModel(persona(),'voice',profile('rvc')),/对应音色/);
});

test('pickers filter service types and disable use during unsaved edits, loading, or missing resources',async()=>{
  const profiles=[profile(),{...profile('rvc'),displayName:'胡桃'}, {...profile('gpt-sovits','blocked'),profileId:'incomplete',displayName:'待补全'}];let selected:any;
  const options={role:'voice' as const,config:persona(),profiles,health:{},busy:false,dirty:false,existing:true,apply:async(role:string,value:any)=>{selected={role,value};},inspect:async()=>{},openLibrary:()=>{}};
  const ui=createUI(React,false,error=>{throw Error(error);});
  const tree=nodes(voiceModelPicker(React.createElement,ui,options));assert.ok(!JSON.stringify(tree).includes('胡桃'));
  const use=tree.find(node=>node.props?.['aria-label']==='说话使用可莉');assert.equal(use.props.disabled,false);use.props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(selected.role,'voice');assert.equal(selected.value.profileId,'klee');
  assert.equal(tree.find(node=>node.props?.['aria-label']==='说话使用待补全').props.disabled,true);
  for(const patch of [{dirty:true},{existing:false},{busy:true}])assert.equal(nodes(voiceModelPicker(React.createElement,ui,{...options,...patch})).find(node=>node.props?.['aria-label']==='说话使用可莉').props.disabled,true);
});

test('model library settings expose only the root and GPT address and show incomplete model diagnostics',()=>{
  const ui=createUI(React,false,()=>{}),value={modelsRoot:'configured-root',gptSovitsUrl:'http://localhost:9880',reports:{rvc:{profileCount:1,state:'partial',models:[{profileId:'bad',displayName:'缺少索引',state:'blocked',diagnostics:['模型权重无法读取']}],diagnostics:[]}}};
  const rows=nodes(voiceLibraryPanel(React.createElement,ui,{value,draft:{modelsRoot:'new-root',gptSovitsUrl:value.gptSovitsUrl},busy:false,update:()=>{},save:async()=>{},refresh:async()=>{}}));
  assert.deepEqual(rows.filter(node=>node.type==='label').map(node=>node.children[0]),['模型根目录','GPT-SoVITS 地址']);assert.ok(JSON.stringify(rows).includes('模型权重无法读取'));
  assert.equal(rows.find(node=>node.type==='button'&&node.children[0]==='刷新模型').props.disabled,true);
});

test('an already selected voice can repair missing permissions or a non-WAV speaking format',()=>{
  const ui=createUI(React,false,()=>{});
  for(const role of ['voice','singing'] as const){
    const selectedProfile=profile(role==='voice'?'gpt-sovits':'rvc'),config=useVoiceModel(persona(),role,selectedProfile);
    const button=(value:typeof config)=>nodes(voiceModelPicker(React.createElement,ui,{role,config:value,profiles:[selectedProfile],health:{},busy:false,dirty:false,existing:true,apply:async()=>{},inspect:async()=>{},openLibrary:()=>{}})).find(node=>node.props?.['aria-label']===(role==='voice'?'说话使用可莉':'唱歌使用可莉'));
    assert.equal(button(config).props.disabled,true);
    for(const patch of [{tools:config.tools.filter(tool=>tool!==(role==='voice'?'bot_voice':'bot_sing'))},{skills:config.skills.filter(skill=>skill!==(role==='voice'?'voice-generation':'singing-conversion'))}]){
      const incomplete={...config,...patch};assert.equal(button(incomplete).props.disabled,false);assert.equal(button(useVoiceModel(incomplete,role,selectedProfile)).props.disabled,true);
    }
    if(role==='voice')assert.equal(button({...config,media:{...config.media,voice:{...config.media.voice!,format:'mp3'}}}).props.disabled,false);
  }
});

test('voice picker does not show expired or replaced-profile health as available',()=>{
  const ui=createUI(React,false,()=>{}),selectedProfile=profile(),health={serviceId:'gpt-sovits',profileId:'klee',profileRevision:1,profileContentHash:'a'.repeat(64),state:'ready',checkedAt:Date.now()-1000,expiresAt:Date.now()+60_000,cached:false};
  const render=(value:typeof health)=>JSON.stringify(voiceModelPicker(React.createElement,ui,{role:'voice',config:persona(),profiles:[selectedProfile],health:{'gpt-sovits/klee':value},busy:false,dirty:false,existing:true,apply:async()=>{},inspect:async()=>{},openLibrary:()=>{}}));
  assert.match(render(health),/服务可用/);
  assert.match(render({...health,expiresAt:Date.now()-1}),/服务未检查/);
  assert.match(render({...health,profileRevision:2}),/服务未检查/);
  assert.match(render({...health,profileContentHash:'b'.repeat(64)}),/服务未检查/);
});

test('profile loading follows catalog pages instead of hiding models after the first hundred',async()=>{
  const inputs:any[]=[];const result=await loadServiceProfiles(async(_name,input)=>{inputs.push(input);return input.cursor?{items:[profile('rvc')],nextCursor:null}:{items:[profile()],nextCursor:'page-2'};});
  assert.equal(result.length,2);assert.deepEqual(inputs,[{limit:100},{limit:100,cursor:'page-2'}]);
});
