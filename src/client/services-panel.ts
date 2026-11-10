import type {Translate} from './locale.js';
import type {PanelUI} from './bots-panel.js';
import {modelLibraryLabel,serviceHealthLabel} from './service-health.js';

export interface ServicesPanelProps {
  React:any;
  ui:PanelUI;
  t:Translate;
  summary?:any;
  settings?:any;
  draft?:any;
  dirty:boolean;
  busy:boolean;
  health?:Record<string,any>;
  onDraftChange:(patch:any)=>void;
  onSave:()=>unknown;
  onRefresh:()=>unknown;
  onStart:(serviceId:'gpt-sovits'|'breeze-tts')=>unknown;
  onPickDirectory:(key:'modelsRoot'|'gptSovitsProjectRoot'|'breezeTtsProjectRoot'|'breezeTtsVoicesRoot')=>unknown;
  onToggleRobotService:()=>unknown;
}

const h=(React:any,type:any,props:any,...children:any[])=>React.createElement(type,props,...children);

function stateBadge(React:any, t:Translate, value:any){
  const warning=['degraded','unavailable','blocked'].includes(value?.state);
  return h(React,'span',{className:`badge${warning?' warning':''}`,role:'status',title:value?.safeDiagnostic},serviceHealthLabel(value,t));
}

function serviceCard(React:any, props:ServicesPanelProps, serviceId:'gpt-sovits'|'breeze-tts', label:string, urlKey:'gptSovitsUrl'|'breezeTtsUrl', rootKey:'gptSovitsProjectRoot'|'breezeTtsProjectRoot', addressLabel:string, startLabel:string){
  const draft=props.draft;
  if(!draft)return null;
  const health=props.health?.[serviceId];
  return h(React,'section',{className:'card service-card',key:serviceId},
    h(React,'div',{className:'section-heading'},h(React,'h3',null,label),stateBadge(React,props.t,health)),
    h(React,'div',{className:'fields'},
      props.ui.field(addressLabel,draft[urlKey],value=>props.onDraftChange({[urlKey]:value}),'url'),
      h(React,'div',{className:'directory-field'},props.ui.field(rootKey==='gptSovitsProjectRoot'?props.t('gptSovitsProjectRoot'):props.t('breezeTtsProjectRoot'),draft[rootKey],value=>props.onDraftChange({[rootKey]:value})),props.ui.button(props.t('browseDirectory'),()=>props.onPickDirectory(rootKey))),
      serviceId==='breeze-tts'?h(React,'div',{className:'directory-field'},props.ui.field(props.t('breezeTtsVoicesRoot'),draft.breezeTtsVoicesRoot,value=>props.onDraftChange({breezeTtsVoicesRoot:value})),props.ui.button(props.t('browseDirectory'),()=>props.onPickDirectory('breezeTtsVoicesRoot'))):null,
    ),
    h(React,'div',{className:'actions'},props.ui.button(startLabel,()=>props.onStart(serviceId),{className:'primary',disabled:props.busy||props.dirty||!draft[rootKey]})),
  );
}

export function ServicesPanel(props:ServicesPanelProps){
  const React=props.React;
  const draft=props.draft;
  const running=props.summary?.health?.serviceRunning===true;
  return h(React,'section',{className:'panel-page services-page','aria-label':props.t('services')},
    h(React,'div',{className:'page-toolbar'},h(React,'div',null,h(React,'h3',null,props.t('services')),h(React,'span',{className:'muted'},props.t('serviceDescription')))),
    h(React,'section',{className:'card service-card'},
      h(React,'div',{className:'section-heading'},h(React,'h3',null,props.t('robotService')),h(React,'span',{className:'badge',role:'status'},props.summary?.health?(running?props.t('online'):props.t('stopped')):props.t('unknown'))),
      h(React,'div',{className:'actions'},props.ui.button(running?props.t('stopBotService'):props.t('startBotService'),props.onToggleRobotService,{className:'primary',disabled:props.busy||!props.summary?.health,'aria-label':running?props.t('stopBotService'):props.t('startBotService')})),
    ),
    serviceCard(React,props,'gpt-sovits','GPT-SoVITS','gptSovitsUrl','gptSovitsProjectRoot',props.t('gptSovitsAddress'),props.t('startGptSovits')),
    serviceCard(React,props,'breeze-tts','Breeze TTS','breezeTtsUrl','breezeTtsProjectRoot',props.t('breezeTtsAddress'),props.t('startBreezeTts')),
    draft?h(React,'section',{className:'card service-card'},
      h(React,'div',{className:'section-heading'},h(React,'h3',null,props.t('stsModelDirectory')),h(React,'span',{className:'badge',role:'status',title:props.settings?.reports?.rvc?.diagnostics?.join('\n')},modelLibraryLabel(props.settings?.reports?.rvc,props.t))),
      h(React,'div',{className:'directory-field'},props.ui.field(props.t('stsModelDirectory'),draft.modelsRoot,value=>props.onDraftChange({modelsRoot:value})),props.ui.button(props.t('browseDirectory'),()=>props.onPickDirectory('modelsRoot'))),
      h(React,'div',{className:'save-bar'},h(React,'span',{className:'save-state'},props.dirty?props.t('unsaved'):props.t('savedState')),props.ui.button(props.t('save'),props.onSave,{className:'primary',disabled:props.busy||!props.dirty}),props.ui.button(props.t('refresh'),props.onRefresh,{disabled:props.busy||props.dirty})),
    ):h(React,'p',{role:'status'},props.t('loading')),
  );
}
