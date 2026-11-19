import {diagnosticText,reportDiagnostics,type Translate} from './locale.js';
import type {PanelUI} from './bots-panel.js';
import {panelSaveBar,panelSplit} from './layout.js';
import {pathPickerField} from './ui.js';
import {modelLibraryLabel,serviceHealthLabel} from './service-health.js';

export type ServicePanelId='robot'|'gpt-sovits'|'breeze-tts'|'openai'|'google'|'comfyui'|'music'|'rvc';
export type StartableServiceId='gpt-sovits'|'breeze-tts'|'comfyui';
export type ServiceDirectoryKey='modelsRoot'|'gptSovitsProjectRoot'|'breezeTtsProjectRoot'|'breezeTtsVoicesRoot'|'musicHome';
export const serviceSettingKeys={
  'gpt-sovits':['gptSovitsUrl','gptSovitsProjectRoot'],
  'breeze-tts':['breezeTtsUrl','breezeTtsProjectRoot','breezeTtsVoicesRoot'],
  openai:['openAiBaseUrl','openAiModel','openAiKeyEnv'],
  google:['googleBaseUrl','googleModel','googleKeyEnv'],
  comfyui:['comfyUiBaseUrl','comfyUiWorkflowPath'],
  music:['musicHome','musicSources'],
  rvc:['modelsRoot'],
} as const;

export function serviceDraftDirty(serviceId:Exclude<ServicePanelId,'robot'>,draft:any,settings:any):boolean{
  return !!draft&&!!settings&&serviceSettingKeys[serviceId].some(key=>JSON.stringify(draft[key])!==JSON.stringify(settings[key]));
}

export interface ServicesPanelProps {
  React:any;
  ui:PanelUI;
  t:Translate;
  summary?:any;
  settings?:any;
  draft?:any;
  dirty:boolean;
  busy:boolean;
  robotPending?:boolean;
  saving?:boolean;
  refreshing?:boolean;
  starting?:string[];
  selectedService?:ServicePanelId;
  onSelectService?:(id:ServicePanelId)=>unknown;
  picking?:string;
  pickError?:{key:string;message:string};
  fieldErrors?:Record<string,string>;
  onCancelPick?:()=>unknown;
  health?:Record<string,any>;
  locale?:'zh'|'en';
  messageLocale?:'zh'|'en';
  messageLocaleDraft?:'zh'|'en';
  languageWritable?:boolean;
  languageSaving?:boolean;
  onMessageLocaleDraftChange?:(value:string)=>unknown;
  onSaveMessageLocale?:()=>unknown;
  onDraftChange:(patch:any)=>void;
  onSave:()=>unknown;
  onRevert?:()=>unknown;
  onRefresh:()=>unknown;
  onStart:(serviceId:StartableServiceId,saveFirst:boolean)=>unknown;
  onPickDirectory:(key:ServiceDirectoryKey)=>unknown;
  onPickFile?:(key:'comfyUiWorkflowPath')=>unknown;
  onToggleRobotService:()=>unknown;
}

function stateBadge(h:any,props:ServicesPanelProps,serviceId:ServicePanelId){
  if(serviceId==='robot')return h('span',{key:'status',className:'badge',role:'status'},props.summary?.health?(props.summary.health.serviceRunning?props.t('online'):props.t('stopped')):props.t('unknown'));
  if(serviceId==='rvc')return h('span',{key:'status',className:'badge',role:'status',title:reportDiagnostics(props.settings?.reports?.rvc,props.locale)},modelLibraryLabel(props.settings?.reports?.rvc,props.t));
  const missingPath=(serviceId==='comfyui'&&props.settings?.comfyUiWorkflowPath==='')||(serviceId==='music'&&props.settings?.musicHome==='');
  const value=missingPath?{state:'missing'}:props.health?.[serviceId];
  return h('span',{key:'status',className:`badge${['degraded','unavailable','blocked'].includes(value?.state)?' warning':''}`,role:'status',title:diagnosticText(value,props.locale)},serviceHealthLabel(value,props.t));
}

function directoryField(props:ServicesPanelProps,key:ServiceDirectoryKey|'comfyUiWorkflowPath',label:string){
  return pathPickerField(props.React.createElement,props.ui,props.t,{
    id:`service-field-${key}`,label,value:props.draft[key],onChange:value=>props.onDraftChange({[key]:value}),
    error:props.fieldErrors?.[key]??(props.pickError?.key===key?props.pickError.message:undefined),
    pending:props.picking===key,file:key==='comfyUiWorkflowPath',
    onPick:key==='comfyUiWorkflowPath'?(props.onPickFile?()=>props.onPickFile!(key):undefined):()=>props.onPickDirectory(key),onCancel:props.onCancelPick,
  });
}

function startButton(props:ServicesPanelProps,serviceId:StartableServiceId){
  const dirty=serviceDraftDirty(serviceId,props.draft,props.settings),starting=props.starting?.includes(serviceId)===true;
  const root=serviceId==='gpt-sovits'?'gptSovitsProjectRoot':serviceId==='breeze-tts'?'breezeTtsProjectRoot':undefined;
  return props.ui.button(props.t(starting?'starting':dirty?'saveAndStart':'start'),()=>props.onStart(serviceId,dirty),{disabled:starting||(dirty&&props.saving===true)||!!(root&&!props.draft[root]),'aria-busy':starting});
}

function orderedSources(props:ServicesPanelProps){
  const h=props.React.createElement,sources=Array.isArray(props.draft.musicSources)?props.draft.musicSources:[];
  const sourceIds=['MiguMusicClient','KuwoMusicClient','QQMusicClient','NeteaseMusicClient'];
  const labels:Record<string,string>={MiguMusicClient:props.t('musicMigu'),KuwoMusicClient:props.t('musicKuwo'),QQMusicClient:props.t('musicQq'),NeteaseMusicClient:props.t('musicNetease')};
  const move=(index:number,delta:number)=>{const next=[...sources],target=index+delta;if(target<0||target>=next.length)return;[next[index],next[target]]=[next[target],next[index]];props.onDraftChange({musicSources:next});};
  return h('div',{className:'service-priority-wrap'},
    h('div',{className:'service-priority-list',role:'list','aria-label':props.t('musicSourcePriority')},...sources.map((source:string,index:number)=>h('div',{key:source,className:'service-priority-item',role:'listitem'},
      h('span',null,labels[source]??source),h('span',{className:'actions'},
        props.ui.button('↑',()=>move(index,-1),{disabled:index===0,'aria-label':`${props.t('moveUp')} ${labels[source]??source}`}),
        props.ui.button('↓',()=>move(index,1),{disabled:index===sources.length-1,'aria-label':`${props.t('moveDown')} ${labels[source]??source}`}),
        props.ui.button('×',()=>props.onDraftChange({musicSources:sources.filter((item:string)=>item!==source)}),{disabled:sources.length<=1,'aria-label':`${props.t('delete')} ${labels[source]??source}`}),
      ),
    ))),
    h('div',{className:'service-priority-add'},...sourceIds.filter(source=>!sources.includes(source)).map(source=>props.ui.button(`${props.t('add')} ${labels[source]}`,()=>props.onDraftChange({musicSources:[...sources,source]}),{disabled:false,key:source}))),
  );
}

export function ServicesPanel(props:ServicesPanelProps){
  const h=props.React.createElement,t=props.t,draft=props.draft,selected=props.selectedService??'robot';
  const services:Array<{id:ServicePanelId;name:string}>=[{id:'robot',name:t('robotService')},{id:'gpt-sovits',name:'GPT-SoVITS'},{id:'breeze-tts',name:'Breeze TTS'},{id:'openai',name:t('openaiImageService')},{id:'google',name:t('googleImageService')},{id:'comfyui',name:'ComfyUI'},{id:'music',name:t('musicService')},{id:'rvc',name:t('rvcModelLibrary')}];
  const selectedLabel=services.find(service=>service.id===selected)!.name;
  const field=(key:string,label:string,type='text',extra:any={})=>props.ui.field(label,draft[key]??'',value=>props.onDraftChange({[key]:value}),type,{id:`service-field-${key}`,error:props.fieldErrors?.[key],disabled:false,...extra});
  let fields:any=null,actions:any=null;
  if(selected==='robot'){
    const language=props.messageLocaleDraft??props.messageLocale??'zh',languageDirty=language!==(props.messageLocale??'zh');
    const saveAction=props.ui.button('',()=>props.onSaveMessageLocale?.()).props.onClick;
    const save=props.ui.button(t(props.languageSaving?'saving':'save'),()=>{}, {type:'submit',onClick:undefined,className:'primary',disabled:props.languageSaving||!props.languageWritable||!languageDirty});
    fields=h('form',{onSubmit:(event:any)=>{event.preventDefault();if(!save.props.disabled)saveAction();}},
      h('div',{className:'fields'},props.ui.select(t('messageLocale'),language,[{id:'zh',name:t('chineseLanguage')},{id:'en',name:t('englishLanguage')}],value=>props.onMessageLocaleDraftChange?.(value),{disabled:props.languageSaving||!props.languageWritable})),
      panelSaveBar(h,{status:languageDirty?t('unsaved'):t('savedState'),cancel:props.ui.button(t('revert'),()=>props.onMessageLocaleDraftChange?.(props.messageLocale??'zh'),{disabled:props.languageSaving||!languageDirty}),save}),
    );
    actions=props.ui.button(props.summary?.health?.serviceRunning?t('stopBotService'):t('startBotService'),props.onToggleRobotService,{disabled:props.busy||props.robotPending||!props.summary?.health});
  }else if(draft){
    if(selected==='gpt-sovits'||selected==='breeze-tts'){
      const gpt=selected==='gpt-sovits';
      fields=h('div',{className:'fields'},field(gpt?'gptSovitsUrl':'breezeTtsUrl',t(gpt?'gptSovitsAddress':'breezeTtsAddress'),'url'),directoryField(props,gpt?'gptSovitsProjectRoot':'breezeTtsProjectRoot',t(gpt?'gptSovitsProjectRoot':'breezeTtsProjectRoot')),gpt?null:directoryField(props,'breezeTtsVoicesRoot',t('breezeTtsVoicesRoot')));
      actions=startButton(props,selected);
    }else if(selected==='openai')fields=h('div',{className:'fields'},field('openAiBaseUrl',t('serviceAddress'),'url',{placeholder:t('inheritAddress')}),field('openAiModel',t('defaultImageModel'),'text',{placeholder:t('inheritModel')}),field('openAiKeyEnv',t('keyEnv'),'text',{placeholder:'OPENAI_API_KEY',autoComplete:'off',spellCheck:false}));
    else if(selected==='google')fields=h('div',{className:'fields'},field('googleBaseUrl',t('serviceAddress'),'url',{placeholder:'https://generativelanguage.googleapis.com/v1beta'}),field('googleModel',t('defaultImageModel'),'text',{placeholder:'gemini-2.5-flash-image'}),field('googleKeyEnv',t('keyEnv'),'text',{placeholder:'GEMINI_API_KEY',autoComplete:'off',spellCheck:false}));
    else if(selected==='comfyui'){
      fields=h('div',{className:'fields'},field('comfyUiBaseUrl',t('comfyUiAddress'),'url'),directoryField(props,'comfyUiWorkflowPath',t('comfyUiWorkflow')));
      actions=startButton(props,'comfyui');
    }else if(selected==='music')fields=h('div',{className:'fields'},directoryField(props,'musicHome',t('musicHome')),h('div',{className:'full'},h('h4',null,t('musicSourcePriority')),orderedSources(props)));
    else fields=directoryField(props,'modelsRoot',t('stsModelDirectory'));
  }else fields=h('p',{role:'status'},t('loading'));
  const list=h('nav',{className:'service-list entity-list','aria-label':t('services')},...services.map(service=>props.ui.button([
    h('strong',{key:'name'},service.name),stateBadge(h,props,service.id),
    service.id!=='robot'&&serviceDraftDirty(service.id,draft,props.settings)?h('span',{key:'dirty',className:'draft-indicator','aria-label':t('unsaved')},'•'):null,
  ] as any,()=>props.onSelectService?.(service.id),{key:service.id,className:`entity-row${service.id===selected?' selected':''}`,'aria-label':service.name,'aria-current':service.id===selected?'page':undefined,disabled:false})));
  const detail=h('section',{className:'card service-card',key:selected},h('div',{className:'section-heading'},h('h3',null,selectedLabel),stateBadge(h,props,selected)),fields,actions?h('div',{className:'actions'},actions):null);
  const saveAction=props.ui.button('',props.onSave).props.onClick;
  const save=props.ui.button(t(props.saving?'saving':'save'),()=>{}, {type:'submit',onClick:undefined,className:'primary',disabled:props.saving||!props.dirty});
  const serviceEditor=selected==='robot'?detail:h('form',{onSubmit:(event:any)=>{event.preventDefault();if(!save.props.disabled)saveAction();}},detail,draft?panelSaveBar(h,{status:props.dirty?t('unsaved'):t('savedState'),cancel:props.ui.button(t('revert'),()=>props.onRevert?.(),{disabled:props.saving||!props.dirty}),save}):null);
  return h('section',{className:'panel-page services-page','aria-label':t('services')},
    h('div',{className:'page-toolbar'},props.ui.button(t(props.refreshing?'refreshing':'refresh'),props.onRefresh,{disabled:props.refreshing===true})),
    panelSplit(h,list,serviceEditor),
  );
}
