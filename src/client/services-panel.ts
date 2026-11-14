import {diagnosticText,reportDiagnostics,type Translate} from './locale.js';
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
  saving?:boolean;
  refreshing?:boolean;
  picking?:string;
  onCancelPick?:()=>unknown;
  health?:Record<string,any>;
  locale?:'zh'|'en';
  messageLocale?:'zh'|'en';
  languageWritable?:boolean;
  languageSaving?:boolean;
  onMessageLocaleChange?:(value:string)=>unknown;
  onDraftChange:(patch:any)=>void;
  onSave:()=>unknown;
  onRefresh:()=>unknown;
  onStart:(serviceId:'gpt-sovits'|'breeze-tts'|'comfyui')=>unknown;
  onPickDirectory:(key:'modelsRoot'|'gptSovitsProjectRoot'|'breezeTtsProjectRoot'|'breezeTtsVoicesRoot')=>unknown;
  onPickFile?:(key:'comfyUiWorkflowPath')=>unknown;
  onToggleRobotService:()=>unknown;
}

const h=(React:any,type:any,props:any,...children:any[])=>React.createElement(type,props,...children);

function pickerButton(props:ServicesPanelProps,key:string,action:()=>unknown,file=false){
  const active=props.picking===key;
  return h(props.React,'span',{className:'actions'},
    props.ui.button(props.t(active?'selectingPath':file?'browseFile':'browseDirectory'),action,{disabled:props.busy||!!props.picking,'aria-busy':active}),
    active&&props.onCancelPick?props.ui.button(props.t('cancel'),props.onCancelPick,{disabled:false}):null,
  );
}

function stateBadge(React:any, t:Translate, value:any,locale:'zh'|'en'='zh'){
  const warning=['degraded','unavailable','blocked'].includes(value?.state);
  return h(React,'span',{className:`badge${warning?' warning':''}`,role:'status',title:diagnosticText(value,locale)},serviceHealthLabel(value,t));
}

function serviceCard(React:any, props:ServicesPanelProps, serviceId:'gpt-sovits'|'breeze-tts', label:string, urlKey:'gptSovitsUrl'|'breezeTtsUrl', rootKey:'gptSovitsProjectRoot'|'breezeTtsProjectRoot', addressLabel:string, startLabel:string){
  const draft=props.draft;
  if(!draft)return null;
  const health=props.health?.[serviceId];
  return h(React,'section',{className:'card service-card',key:serviceId},
    h(React,'div',{className:'section-heading'},h(React,'h3',null,label),stateBadge(React,props.t,health,props.locale)),
    h(React,'div',{className:'fields'},
      props.ui.field(addressLabel,draft[urlKey],value=>props.onDraftChange({[urlKey]:value}),'url'),
      h(React,'div',{className:'directory-field'},props.ui.field(rootKey==='gptSovitsProjectRoot'?props.t('gptSovitsProjectRoot'):props.t('breezeTtsProjectRoot'),draft[rootKey],value=>props.onDraftChange({[rootKey]:value})),pickerButton(props,rootKey,()=>props.onPickDirectory(rootKey))),
      serviceId==='breeze-tts'?h(React,'div',{className:'directory-field'},props.ui.field(props.t('breezeTtsVoicesRoot'),draft.breezeTtsVoicesRoot,value=>props.onDraftChange({breezeTtsVoicesRoot:value})),pickerButton(props,'breezeTtsVoicesRoot',()=>props.onPickDirectory('breezeTtsVoicesRoot'))):null,
    ),
    h(React,'div',{className:'actions'},props.ui.button(startLabel,()=>props.onStart(serviceId),{className:'primary',disabled:props.busy||props.dirty||props.saving===true||!draft[rootKey]})),
  );
}

function orderedSources(React:any, props:ServicesPanelProps, draft:any){
  const sources=Array.isArray(draft.musicSources)?draft.musicSources:[];
  if(!sources.length)return null;
  const sourceIds=['MiguMusicClient','KuwoMusicClient','QQMusicClient','NeteaseMusicClient'];
  const labels:Record<string,string>={MiguMusicClient:props.t('musicMigu'),KuwoMusicClient:props.t('musicKuwo'),QQMusicClient:props.t('musicQq'),NeteaseMusicClient:props.t('musicNetease')};
  const move=(index:number,delta:number)=>{const next=[...sources],target=index+delta;if(target<0||target>=next.length)return;[next[index],next[target]]=[next[target],next[index]];props.onDraftChange({musicSources:next});};
  const remove=(source:string)=>{if(sources.length<=1)return;props.onDraftChange({musicSources:sources.filter((item:string)=>item!==source)});};
  const add=(source:string)=>props.onDraftChange({musicSources:[...sources,source]});
  return h(React,'div',{className:'service-priority-wrap'},
    h(React,'div',{className:'service-priority-list','role':'list','aria-label':props.t('musicSourcePriority')},...sources.map((source:string,index:number)=>
    h(React,'div',{key:source,className:'service-priority-item','role':'listitem'},
      h(React,'span',null,labels[source]??source),
      h(React,'span',{className:'actions'},
        props.ui.button('←',()=>move(index,-1),{disabled:index===0||props.busy,'aria-label':`${props.t('moveUp')} ${labels[source]??source}`}),
        props.ui.button('→',()=>move(index,1),{disabled:index===sources.length-1||props.busy,'aria-label':`${props.t('moveDown')} ${labels[source]??source}`}),
        props.ui.button('×',()=>remove(source),{disabled:sources.length<=1||props.busy,'aria-label':`${props.t('delete')} ${labels[source]??source}`}),
      ),
    ),
  )),
    sourceIds.some(source=>!sources.includes(source))?h(React,'div',{className:'service-priority-add'},...sourceIds.filter(source=>!sources.includes(source)).map(source=>props.ui.button(`${props.t('add')} ${labels[source]}`,()=>add(source),{disabled:props.busy,key:source}))):null,
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
      h(React,'div',{className:'fields'},props.ui.select(props.t('messageLocale'),props.messageLocale??'zh',[{id:'zh',name:props.t('chineseLanguage')},{id:'en',name:props.t('englishLanguage')}],value=>props.onMessageLocaleChange?.(value),{disabled:props.busy||props.languageSaving||!props.languageWritable})),
      h(React,'p',{className:'muted'},props.t('messageLocaleHint')),
    ),
    serviceCard(React,props,'gpt-sovits','GPT-SoVITS','gptSovitsUrl','gptSovitsProjectRoot',props.t('gptSovitsAddress'),props.t('startGptSovits')),
    serviceCard(React,props,'breeze-tts','Breeze TTS','breezeTtsUrl','breezeTtsProjectRoot',props.t('breezeTtsAddress'),props.t('startBreezeTts')),
    draft?h(React,'section',{className:'card service-card',key:'openai-image-service'},
      h(React,'div',{className:'section-heading'},h(React,'h3',null,props.t('openaiImageService'))),
      h(React,'div',{className:'fields'},
        props.ui.field(props.t('serviceAddress'),draft.openAiBaseUrl??'',value=>props.onDraftChange({openAiBaseUrl:value.trim()||undefined}),'url',{placeholder:props.t('inheritAddress')}),
        props.ui.field(props.t('model'),draft.openAiModel??'',value=>props.onDraftChange({openAiModel:value.trim()||undefined}),'text',{placeholder:props.t('inheritModel')}),
        props.ui.field(props.t('keyEnv'),draft.openAiKeyEnv??'OPENAI_API_KEY',value=>props.onDraftChange({openAiKeyEnv:value.trim()||undefined}),'text',{placeholder:'OPENAI_API_KEY',autoComplete:'off',spellCheck:false}),
      ),
    ):null,
    draft?h(React,'section',{className:'card service-card',key:'comfyui-service'},
      h(React,'div',{className:'section-heading'},h(React,'h3',null,'ComfyUI')),
      h(React,'div',{className:'fields'},
        props.ui.field(props.t('comfyUiAddress'),draft.comfyUiBaseUrl??'http://127.0.0.1:8188',value=>props.onDraftChange({comfyUiBaseUrl:value.trim()}),'url'),
        h(React,'div',{className:'directory-field'},props.ui.field(props.t('comfyUiWorkflow'),draft.comfyUiWorkflowPath??'',value=>props.onDraftChange({comfyUiWorkflowPath:value}),'text'),props.onPickFile?pickerButton(props,'comfyUiWorkflowPath',()=>props.onPickFile?.('comfyUiWorkflowPath'),true):null),
      ),
      h(React,'div',{className:'actions'},props.ui.button(props.t('startComfyUi'),()=>props.onStart('comfyui'),{className:'primary',disabled:props.busy||props.dirty||props.saving===true})),
    ):null,
    draft?h(React,'section',{className:'card service-card',key:'music-service'},
      h(React,'div',{className:'section-heading'},h(React,'h3',null,props.t('musicService'))),
      h(React,'div',{className:'fields'},
        h(React,'p',{className:'muted full'},props.t('musicSourcePriority')),
        h(React,'div',{className:'full'},orderedSources(React,props,draft)),
      ),
    ):null,
    draft?h(React,'section',{className:'card service-card'},
      h(React,'div',{className:'section-heading'},h(React,'h3',null,props.t('stsModelDirectory')),h(React,'span',{className:'badge',role:'status',title:reportDiagnostics(props.settings?.reports?.rvc,props.locale)},modelLibraryLabel(props.settings?.reports?.rvc,props.t))),
      h(React,'div',{className:'directory-field'},props.ui.field(props.t('stsModelDirectory'),draft.modelsRoot,value=>props.onDraftChange({modelsRoot:value})),pickerButton(props,'modelsRoot',()=>props.onPickDirectory('modelsRoot'))),
      h(React,'div',{className:'save-bar'},h(React,'span',{className:'save-state'},props.dirty?props.t('unsaved'):props.t('savedState')),props.ui.button(props.t(props.saving?'saving':'save'),props.onSave,{className:'primary',disabled:props.busy||props.saving===true||!props.dirty}),props.ui.button(props.t(props.refreshing?'refreshing':'refresh'),props.onRefresh,{disabled:props.busy||props.saving===true||props.refreshing===true||props.dirty})),
    ):h(React,'p',{role:'status'},props.t('loading')),
  );
}
