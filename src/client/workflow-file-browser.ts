import type {PanelUI} from './bots-panel.js';
import type {Translate} from './locale.js';

interface WorkflowFileBrowserProps {React:any;ui:PanelUI;t:Translate;state:any;onBrowse:(directory:string)=>unknown;onLocation:(directory:string)=>void;onSelect:(file:string)=>void;onCancel:()=>void}

function WorkflowFileDialog({React,ui,t,state,onBrowse,onLocation,onSelect,onCancel}:WorkflowFileBrowserProps){
  const h=React.createElement;
  const dialog=React.useRef(null);
  React.useEffect(()=>{
    const element=dialog.current;
    const previous=document.activeElement as HTMLElement|null;
    element?.showModal();
    return()=>{element?.close();if(previous?.isConnected)previous.focus();};
  },[]);
  const close=()=>{dialog.current?.close();onCancel();};
  const select=(file:string)=>{dialog.current?.close();onSelect(file);};
  return h('dialog',{ref:dialog,className:'card dialog workflow-file-browser','aria-modal':true,'aria-label':t('chooseWorkflow'),onCancel:(event:any)=>{event.preventDefault();event.stopPropagation();close();},onKeyDown:(event:any)=>{if(event.key==='Escape')event.stopPropagation();}},
      h('div',{className:'row spread'},h('h3',null,t('chooseWorkflow')),ui.button(t('cancel'),close,{disabled:false})),
      h('form',{onSubmit:(event:any)=>{event.preventDefault();void onBrowse(state.location);}},
        ui.field(t('workflowDirectory'),state.location,onLocation,'text',{autoFocus:true,disabled:state.loading,id:'workflow-browser-location',error:state.error}),
        h('div',{className:'actions'},ui.button(t('openWorkflowDirectory'),()=>onBrowse(state.location),{disabled:state.loading}),ui.button(t('parentDirectory'),()=>onBrowse(state.parent),{disabled:state.loading||!state.parent})),
      ),
      state.loading?h('p',{role:'status'},t('loading')):
        h('div',{className:'workflow-file-list',role:'list','aria-label':t('workflowFiles')},
          ...(state.entries??[]).map((entry:any)=>h('div',{key:entry.path,role:'listitem'},ui.button(`${entry.directory?'📁 ':''}${entry.name}`,()=>entry.directory?onBrowse(entry.path):select(entry.path),{className:'workflow-file-entry',title:entry.path}))),
          !state.entries?.length?h('p',{className:'muted'},t('noWorkflowFiles')):null,
        ),
  );
}

export function workflowFileBrowser(props:WorkflowFileBrowserProps){
  return props.state?props.React.createElement(WorkflowFileDialog,props):null;
}
