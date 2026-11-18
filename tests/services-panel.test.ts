import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ServicesPanel,serviceDraftDirty,type ServicesPanelProps} from '../src/client/services-panel.js';
import {createUI} from '../src/client/ui.js';
import {chinese} from '../src/client/locale.js';

const React={createElement:(type:any,props:any,...children:any[])=>({type,props:props??{},children})};
const flatten=(node:any):any[]=>Array.isArray(node)?node.flatMap(flatten):node&&typeof node==='object'?[node,...(node.children??[]).flatMap(flatten)]:[];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(patch:Partial<ServicesPanelProps>={}){
  const calls:any[]=[];
  const settings={gptSovitsUrl:'http://127.0.0.1:9880',gptSovitsProjectRoot:'E:\\gpt',breezeTtsUrl:'http://127.0.0.1:8080',breezeTtsProjectRoot:'E:\\breeze',breezeTtsVoicesRoot:'E:\\breeze\\voices',openAiModel:'saved',comfyUiBaseUrl:'http://127.0.0.1:8188',comfyUiWorkflowPath:'E:\\workflow.json',modelsRoot:'E:\\models',musicSources:['MiguMusicClient','KuwoMusicClient']};
  const props:ServicesPanelProps={React,ui:createUI(React,false,error=>{throw Error(String(error));}),t:chinese,settings,draft:{...settings},selectedService:'gpt-sovits',dirty:false,busy:false,onSave:()=>calls.push(['save']),onRevert:()=>calls.push(['revert']),onRefresh:()=>calls.push(['refresh']),onStart:(id,saveFirst)=>calls.push(['start',id,saveFirst]),onDraftChange:value=>calls.push(['draft',value]),onPickDirectory:key=>calls.push(['directory',key]),onCancelPick:()=>calls.push(['cancel']),onSelectService:id=>calls.push(['browse',id]),onToggleRobotService:()=>calls.push(['toggle']),...patch};
  return {props,calls,tree:()=>flatten(ServicesPanel(props))};
}

test('service actions use their own saved fields while refresh preserves unrelated drafts',async()=>{
  const {props,calls,tree}=fixture({dirty:true,busy:true,starting:['breeze-tts']});
  props.draft.openAiModel='unsaved image model';
  assert.equal(serviceDraftDirty('gpt-sovits',props.draft,props.settings),false);
  let button=tree().find(node=>node.type==='button'&&node.children.includes('启动'));
  assert.equal(button.props.disabled,false);button.props.onClick();
  button=tree().find(node=>node.type==='button'&&node.children.includes('刷新'));
  assert.equal(button.props.disabled,false);button.props.onClick();await settle();
  assert.deepEqual(calls,[['start','gpt-sovits',false],['refresh']]);
  props.draft.gptSovitsUrl='http://127.0.0.1:9881';
  button=tree().find(node=>node.type==='button'&&node.children.includes('保存并启动'));
  assert.equal(button.props.disabled,false);button.props.onClick();await settle();
  assert.deepEqual(calls.at(-1),['start','gpt-sovits',true]);
  props.draft.gptSovitsUrl=props.settings.gptSovitsUrl;
  assert.equal(serviceDraftDirty('gpt-sovits',props.draft,props.settings),false);
});

test('directory pending is local and switching service details is only navigation',async()=>{
  const {props,calls,tree}=fixture({selectedService:'breeze-tts',picking:'breezeTtsProjectRoot'});
  const pending=tree().find(node=>node.type==='button'&&node.children.includes('正在选择…'));
  assert.equal(pending.props.disabled,true);
  const otherPicker=tree().find(node=>node.type==='button'&&node.children.includes(chinese('browseDirectory')));
  assert.equal(otherPicker.props.disabled,false);otherPicker.props.onClick();
  tree().find(node=>node.type==='button'&&node.props['aria-label']==='OpenAI 生图').props.onClick();await settle();
  assert.deepEqual(calls,[['directory','breezeTtsVoicesRoot'],['browse','openai']]);
  assert.equal(props.draft.breezeTtsVoicesRoot,props.settings.breezeTtsVoicesRoot);
});

test('message language is a draft until its native form is submitted',async()=>{
  const {props,calls,tree}=fixture({selectedService:'robot',messageLocale:'zh',messageLocaleDraft:'zh',languageWritable:true,onMessageLocaleDraftChange:value=>calls.push(['language-draft',value]),onSaveMessageLocale:()=>calls.push(['language-save'])});
  tree().find(node=>node.type==='select').props.onChange({target:{value:'en'}});await settle();
  assert.deepEqual(calls,[['language-draft','en']]);
  props.messageLocaleDraft='en';
  const save=tree().find(node=>node.type==='button'&&node.children.includes('保存'));
  assert.equal(save.props.type,'submit');assert.equal(save.props.disabled,false);
  tree().find(node=>node.type==='form').props.onSubmit({preventDefault:()=>{}});await settle();
  assert.deepEqual(calls.at(-1),['language-save']);
});

test('music sources remain an ordered draft and service save belongs to one form',async()=>{
  const {props,calls,tree}=fixture({selectedService:'music',dirty:true});
  tree().find(node=>node.type==='button'&&node.props['aria-label']==='下移 咪咕音乐').props.onClick();await settle();
  assert.deepEqual(calls,[['draft',{musicSources:['KuwoMusicClient','MiguMusicClient']}]]);
  assert.deepEqual(props.draft.musicSources,['MiguMusicClient','KuwoMusicClient']);
  const saves=tree().filter(node=>node.type==='button'&&node.children.includes('保存'));
  assert.equal(saves.length,1);assert.equal(saves[0].props.type,'submit');
  tree().find(node=>node.type==='form').props.onSubmit({preventDefault:()=>{}});await settle();
  assert.deepEqual(calls.at(-1),['save']);
});
