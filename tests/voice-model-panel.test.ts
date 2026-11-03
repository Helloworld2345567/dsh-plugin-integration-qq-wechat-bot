import {test} from 'node:test';
import assert from 'node:assert/strict';
import {useVoiceModel,voiceModelPicker,loadServiceProfiles} from '../src/client/voice-models.js';
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

test('native voice selector filters service types, applies choices, and disables unavailable models',async()=>{
  const profiles=[profile(),{...profile('rvc'),displayName:'胡桃'}, {...profile('gpt-sovits','blocked'),profileId:'incomplete',displayName:'待补全'}];let selected:any;
  const options={role:'voice' as const,config:persona(),profiles,busy:false,dirty:false,existing:true,apply:async(role:string,value:any)=>{selected={role,value};}};
  const ui=createUI(React,false,error=>{throw Error(error);});
  const tree=nodes(voiceModelPicker(React.createElement,ui,options));assert.ok(!JSON.stringify(tree).includes('胡桃'));
  const select=tree.find(node=>node.type==='select');assert.equal(select.props.disabled,false);select.props.onChange({target:{value:'gpt-sovits/klee'}});await new Promise(resolve=>setImmediate(resolve));assert.equal(selected.role,'voice');assert.equal(selected.value.profileId,'klee');
  assert.equal(tree.find(node=>node.type==='option'&&node.props.value==='gpt-sovits/incomplete').props.disabled,true);
  assert.equal(tree.find(node=>node.type==='option'&&node.props.value==='gpt-sovits/klee').children[0],'可莉 · v4');
  assert.equal(tree.some(node=>node.type==='button'),false);
  for(const patch of [{dirty:true},{existing:false},{busy:true}])assert.equal(nodes(voiceModelPicker(React.createElement,ui,{...options,...patch})).find(node=>node.type==='select').props.disabled,true);
});

test('native voice selector preserves missing selections and labels built-in voices and model variants',()=>{
  const ui=createUI(React,false,()=>{}),selectedProfile={...profile(),modelLabel:'可莉 · v4-zh'},config=useVoiceModel(persona(),'voice',selectedProfile);
  const render=(value:typeof config,profiles:PublicServiceProfile[])=>nodes(voiceModelPicker(React.createElement,ui,{role:'voice',config:value,profiles,busy:false,dirty:false,existing:true,apply:async()=>{throw Error('must not automatically apply');}}));
  const existing=render(config,[selectedProfile]);assert.equal(existing.find(node=>node.type==='option'&&node.props.value==='gpt-sovits/klee').children[0],'可莉 · v4-zh');
  const missing=render(config,[]);assert.equal(missing.find(node=>node.type==='select').props.value,'gpt-sovits/klee');assert.equal(missing.find(node=>node.type==='option'&&node.props.value==='gpt-sovits/klee').children[0],'不可用');assert.equal(missing.find(node=>node.type==='option'&&node.props.value==='gpt-sovits/klee').props.disabled,true);
  const builtIn=render(persona(),[selectedProfile]);assert.equal(builtIn.find(node=>node.type==='option'&&node.props.value==='').children[0],'内置语音');assert.equal(builtIn.find(node=>node.type==='select').props.disabled,false);
});

test('profile loading follows catalog pages instead of hiding models after the first hundred',async()=>{
  const inputs:any[]=[];const result=await loadServiceProfiles(async(_name,input)=>{inputs.push(input);return input.cursor?{items:[profile('rvc')],nextCursor:null}:{items:[profile()],nextCursor:'page-2'};});
  assert.equal(result.length,2);assert.deepEqual(inputs,[{limit:100},{limit:100,cursor:'page-2'}]);
});
