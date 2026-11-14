import type {PanelUI} from './bots-panel.js';
import type {Translate} from './locale.js';

export function workflowFileBrowser({React,ui,t,state,onBrowse,onLocation,onSelect,onCancel}:{React:any;ui:PanelUI;t:Translate;state:any;onBrowse:(directory:string)=>unknown;onLocation:(directory:string)=>void;onSelect:(file:string)=>void;onCancel:()=>void}){
  if(!state)return null;
  const h=React.createElement;
  return h('div',{className:'dialog-backdrop'},
    h('section',{className:'card dialog workflow-file-browser',role:'dialog','aria-modal':true,'aria-label':t('chooseWorkflow'),onKeyDown:(event:any)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onCancel();}}},
      h('div',{className:'row spread'},h('h3',null,t('chooseWorkflow')),ui.button(t('cancel'),onCancel,{disabled:false})),
      h('form',{onSubmit:(event:any)=>{event.preventDefault();void onBrowse(state.location);}},
        ui.field(t('workflowDirectory'),state.location,onLocation,'text',{autoFocus:true,disabled:state.loading}),
        h('div',{className:'actions'},ui.button(t('openWorkflowDirectory'),()=>onBrowse(state.location),{disabled:state.loading}),ui.button(t('parentDirectory'),()=>onBrowse(state.parent),{disabled:state.loading||!state.parent})),
      ),
      state.error?h('p',{className:'error',role:'alert'},state.error):null,
      state.loading?h('p',{role:'status'},t('loading')):
        h('div',{className:'workflow-file-list',role:'list','aria-label':t('workflowFiles')},
          ...(state.entries??[]).map((entry:any)=>h('div',{key:entry.path,role:'listitem'},ui.button(`${entry.directory?'📁 ':''}${entry.name}`,()=>entry.directory?onBrowse(entry.path):onSelect(entry.path),{className:'workflow-file-entry',title:entry.path}))),
          !state.entries?.length?h('p',{className:'muted'},t('noWorkflowFiles')):null,
        ),
    ),
  );
}
