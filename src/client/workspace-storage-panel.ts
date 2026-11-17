import {createUI} from './ui.js';
import {errorText,type Translate} from './locale.js';

export const storageBytes=(bytes:number)=>bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KiB`:`${(bytes/1024/1024).toFixed(1)} MiB`;
export function WorkspaceStoragePanel({React,t,botId,query,api,confirm,onError,onNotice}: {React:any;t:Translate;botId:string;query:(name:string,input:any,signal?:AbortSignal)=>Promise<any>;api:(name:string,input:any)=>Promise<any>;confirm:(message:string)=>Promise<boolean>;onError:(error:any)=>void;onNotice:(message:string)=>void}){
  const h=React.createElement;
  const [filter,setFilter]=React.useState({kind:'',origin:'',before:'',offset:0});
  const [report,setReport]=React.useState(null as any),[busy,setBusy]=React.useState(false),[revision,setRevision]=React.useState(0);
  const ui=createUI(React,busy,onError);
  React.useEffect(()=>{
    const abort=new AbortController();setBusy(true);setReport(null);
    const input={botId,...filter.kind?{kind:filter.kind}:{},...filter.origin?{origin:filter.origin}:{},...filter.before?{before:new Date(`${filter.before}T00:00:00`).getTime()}:{},offset:filter.offset,limit:100};
    void query('workspace.storage',input,abort.signal).then((value:any)=>{if(!abort.signal.aborted)setReport(value);}).catch((error:unknown)=>{if(!abort.signal.aborted)onError(errorText(error));}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    return()=>abort.abort();
  },[botId,filter.kind,filter.origin,filter.before,filter.offset,revision]);
  const kind=(value:string)=>value==='image'?t('image'):value==='video'?t('video'):value==='audio'?t('storageAudio'):t('files');
  const origin=(value:string)=>value==='received'?t('storageReceived'):value==='generated'?t('storageGenerated'):t('storageImported');
  const protection=(value:string)=>value==='retained'?t('storageRetained'):value==='current-session'?t('storageCurrentSession'):value==='active-task'?t('storageActiveTask'):value==='delivery'?t('storageDelivery'):t('storageReclaimable');
  const clear=async()=>{
    const items=report.items.filter((item:any)=>!item.protection);if(!items.length)return;
    if(!await confirm(t('storageCleanupConfirm',{count:items.length,size:storageBytes(items.reduce((sum:number,item:any)=>sum+item.size,0))})))return;
    setBusy(true);
    try{const result=await api('workspace.cleanup',{botId,assetIds:items.map((item:any)=>item.id)});onNotice(t('storageCleaned',{count:result.count,size:storageBytes(result.bytes),skipped:result.skipped.length}));setRevision((value:number)=>value+1);}
    finally{setBusy(false);}
  };
  return h('section',{className:'detail-section workspace-storage'},h('h4',null,t('storageTitle')),h('p',{className:'muted'},t('storageHint')),
    h('div',{className:'section-grid'},
      ui.select(t('category'),filter.kind,[{id:'',name:t('all')},...['image','video','audio','file'].map(id=>({id,name:kind(id)}))],value=>setFilter({...filter,kind:value,offset:0})),
      ui.select(t('storageOrigin'),filter.origin,[{id:'',name:t('all')},...['received','generated','sent'].map(id=>({id,name:origin(id)}))],value=>setFilter({...filter,origin:value,offset:0})),
      ui.field(t('storageBefore'),filter.before,value=>setFilter({...filter,before:value,offset:0}),'date')),
    busy?h('p',{role:'status'},t('loading')):null,
    report?h(React.Fragment,null,
      h('p',null,t('storageSummary',{count:report.total.count,size:storageBytes(report.total.bytes),matched:report.matched.count,reclaimable:report.reclaimable.count,reclaimableSize:storageBytes(report.reclaimable.bytes)})),
      h('details',null,h('summary',null,t('storageBreakdown')),h('div',{className:'storage-table-wrap'},h('table',null,h('thead',null,h('tr',null,...[t('category'),t('storageOrigin'),t('storageDate'),t('storageCount'),t('storageSize')].map(label=>h('th',{key:label},label)))),h('tbody',null,...report.groups.map((group:any)=>h('tr',{key:`${group.kind}/${group.origin}/${group.date}`},h('td',null,kind(group.kind)),h('td',null,origin(group.origin)),h('td',null,group.date),h('td',null,group.count),h('td',null,storageBytes(group.bytes)))))))),
      h('p',{className:'muted'},t('storageProtectionHint')),
      h('div',{className:'storage-table-wrap'},h('table',null,h('thead',null,h('tr',null,...[t('storageFile'),t('category'),t('storageOrigin'),t('storageSize'),t('storageDate'),t('status'),t('storageKeep')].map(label=>h('th',{key:label},label)))),h('tbody',null,...report.items.map((item:any)=>h('tr',{key:item.id},h('td',{title:item.id},item.name),h('td',null,kind(item.kind)),h('td',null,origin(item.origin)),h('td',null,storageBytes(item.size)),h('td',null,new Date(item.createdAt).toLocaleDateString()),h('td',null,protection(item.protection)),h('td',null,ui.toggle(t('storageKeepFile',{name:item.name}),item.pinned,async()=>{setBusy(true);try{await api('workspace.pin',{botId,assetId:item.id,pinned:!item.pinned});setRevision((value:number)=>value+1);}finally{setBusy(false);}}))))))),
      h('div',{className:'actions'},ui.button(t('storageCleanupPage'),clear,{className:'danger',disabled:busy||!report.items.some((item:any)=>!item.protection)}),ui.button(t('refresh'),()=>setRevision((value:number)=>value+1),{disabled:busy}),ui.button(t('storagePrevious'),()=>setFilter({...filter,offset:Math.max(0,filter.offset-100)}),{disabled:busy||!filter.offset}),ui.button(t('storageNext'),()=>setFilter({...filter,offset:filter.offset+100}),{disabled:busy||!report.hasMore})),
    ):null);
}
