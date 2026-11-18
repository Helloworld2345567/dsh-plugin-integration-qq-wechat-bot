import {createUI,dateInput,scheduledTime,type Api,type Mutation} from './ui.js';
import {panelSaveBar} from './layout.js';
import {chinese,message,uiError,errorText,renderText,type DisplayText,type Translate} from './locale.js';

export interface AutomationDraftState {dirty:boolean;save:()=>Promise<unknown>;discard:()=>void}
const defaults={enabled:false,dailyLimit:3,quietFrom:'00:00',quietTo:'09:00',allowWeb:false,timezone:'Asia/Shanghai'};
const newSchedule=()=>({prompt:'',timezone:'Asia/Shanghai',runAt:dateInput(Date.now()+3600000,'Asia/Shanghai')});

export function AutomationPanel({React,query,mutate,configs,bots,confirm,onError,busy,t=chinese,active=true,locale='zh',onDraftState,resolveDraft}:{React:any;query:Api;mutate:Mutation;configs:any[];bots:any[];confirm:(message:DisplayText)=>Promise<boolean>;onError:(message:any)=>void;busy:boolean;t?:Translate;active?:boolean;locale?:'zh'|'en';onDraftState?:(state:AutomationDraftState)=>void;resolveDraft?:(save:()=>Promise<unknown>,discard:()=>void)=>Promise<boolean>}){
  const h=React.createElement;
  const [data,setData]=React.useState(null);
  const [configId,setConfigId]=React.useState('');const [scopeKey,setScopeKey]=React.useState('');
  const [drafts,setDrafts]=React.useState({} as Record<string,any>);
  const [creating,setCreating]=React.useState(false);
  const [schedule,setSchedule]=React.useState(newSchedule());const [scheduleBaseline,setScheduleBaseline]=React.useState(schedule);
  const [loading,setLoading]=React.useState(true);const [loadError,setLoadError]=React.useState('');
  const [pending,setPending]=React.useState([] as string[]);const pendingRef=React.useRef(new Set<string>());
  const [fieldErrors,setFieldErrors]=React.useState({} as Record<string,DisplayText>);
  const formRef=React.useRef(null);const loadSequence=React.useRef(0);const scheduleScope=React.useRef('');
  const ui=createUI(React,busy,onError,t);
  const assignments=JSON.stringify(bots.map(b=>[b.id,b.configId]));
  const reload=async(signal?:AbortSignal)=>{
    const sequence=++loadSequence.current;setLoading(true);setLoadError('');
    try{const result=await query('automation.list',{},signal);if(signal?.aborted||sequence!==loadSequence.current)return;if(!result)throw uiError('automationStateFailed',t);setData(result);}
    catch(error){if(!signal?.aborted&&sequence===loadSequence.current)setLoadError(errorText(error));throw error;}
    finally{if(!signal?.aborted&&sequence===loadSequence.current)setLoading(false);}
  };
  React.useEffect(()=>{if(!active)return;const abort=new AbortController();void reload(abort.signal).catch(()=>{});return()=>{abort.abort();++loadSequence.current;};},[active,assignments]);
  React.useEffect(()=>{if(Object.keys(fieldErrors).length)formRef.current?.querySelector('[aria-invalid="true"]')?.focus();},[fieldErrors]);
  const selectedId=configs.some(c=>c.id===configId)?configId:configs[0]?.id??'';
  const scopes=(data?.scopes??[]).filter((s:any)=>s.configId===selectedId);
  const scope=scopes.find((s:any)=>s.scopeKey===scopeKey)??scopes[0];
  const proactive={...defaults,...(data?.proactive??[]).find((p:any)=>p.scopeKey===scope?.scopeKey)};
  const draft=scope?drafts[scope.scopeKey]??{}:{};
  const patch=(key:string,value:any)=>setDrafts((old:any)=>{const next={...old[scope.scopeKey]};if(value===proactive[key])delete next[key];else next[key]=value;const result={...old};if(Object.keys(next).length)result[scope.scopeKey]=next;else delete result[scope.scopeKey];return result;});
  const value={...proactive,...draft};
  const jobs=(data?.scheduled??[]).filter((j:any)=>j.scopeKey===scope?.scopeKey);
  const scopeNames=scopes.map((s:any)=>({id:s.scopeKey,name:`${bots.find(b=>b.id===s.botId)?.name??s.botId} · ${s.senderId}`}));
  const draftDirty=Object.keys(draft).length>0;
  const scheduleDirty=creating&&Object.keys(schedule).some(key=>schedule[key]!==scheduleBaseline[key]);
  const discardProactive=()=>setDrafts((old:any)=>{const next={...old};if(scope)delete next[scope.scopeKey];return next;});
  const discardSchedule=()=>{setCreating(false);setSchedule(newSchedule());setFieldErrors({});};
  const discard=()=>{if(pendingRef.current.size)throw uiError('operationBusy',t);setDrafts({});discardSchedule();};
  const update=async(action:string,input:any,notice:DisplayText,key:string,saved?:()=>void)=>{
    if(pendingRef.current.has(key))throw uiError('operationBusy',t);pendingRef.current.add(key);setPending([...pendingRef.current]);
    try{await mutate(action,input,notice);saved?.();try{await reload();}catch{onError(message('automationRefreshFailed'));}}
    finally{pendingRef.current.delete(key);setPending([...pendingRef.current]);}
  };
  const saveProactive=async()=>{
    if(!scope||!draftDirty)return;
    if(!Number.isInteger(value.dailyLimit)||value.dailyLimit<1||value.dailyLimit>10){setFieldErrors({dailyLimit:message('dailyLimitInvalid')});throw uiError('dailyLimitInvalid',t);}
    setFieldErrors({});const key=scope.scopeKey;
    await update('automation.proactive',{scopeKey:key,action:'set',args:Object.entries(draft).map(([k,v])=>`${k}=${v}`).join(' ')},message('saved'),`proactive:${key}`,()=>{
      setData((old:any)=>({...old,proactive:[...(old?.proactive??[]).filter((item:any)=>item.scopeKey!==key),{...proactive,...draft,scopeKey:key}]}));
      setDrafts((old:any)=>{const next={...old};delete next[key];return next;});
    });
  };
  const createSchedule=async()=>{
    if(!scope||scheduleScope.current!==scope.scopeKey)throw uiError('automationStateFailed',t);
    const errors:Record<string,DisplayText>={};let at=0;
    if(!schedule.prompt.trim())errors.prompt=message('targetRequired');
    try{new Intl.DateTimeFormat('en',{timeZone:schedule.timezone}).format();}catch{errors.timezone=message('invalidTimezone');}
    if(!errors.timezone)try{at=scheduledTime(schedule.runAt,schedule.timezone,t);if(at-Date.now()<1000)errors.runAt=message('timeMustBeFuture');}catch(error){errors.runAt=errorText(error);}
    setFieldErrors(errors);if(Object.keys(errors).length)throw Error(renderText(Object.values(errors)[0],t,locale));
    await update('automation.schedule',{scopeKey:scope.scopeKey,action:'create',args:JSON.stringify({delayMs:at-Date.now(),timezone:schedule.timezone,prompt:schedule.prompt.trim()})},message('created'),'create',discardSchedule);
  };
  const save=async()=>{if(pendingRef.current.size)throw uiError('operationBusy',t);if(Object.keys(drafts).some(key=>key!==scope?.scopeKey))throw uiError('automationStateFailed',t);if(draftDirty)await saveProactive();if(scheduleDirty)await createSchedule();};
  const hasDraft=Object.keys(drafts).length>0||scheduleDirty;
  React.useEffect(()=>{onDraftState?.({dirty:hasDraft,save,discard});},[hasDraft,drafts,schedule,creating,scope?.scopeKey,data,locale]);
  React.useEffect(()=>()=>onDraftState?.({dirty:false,save:async()=>{},discard:()=>{}}),[]);
  const leave=async(action:()=>void)=>{
    if(pendingRef.current.size)throw uiError('operationBusy',t);
    if(hasDraft){if(resolveDraft){if(!await resolveDraft(save,discard))return;}else{if(!await confirm(message('unsavedChanges')))return;discard();}}
    action();setFieldErrors({});
  };
  const closeSchedule=async()=>{if(pendingRef.current.has('create'))throw uiError('operationBusy',t);if(scheduleDirty){if(resolveDraft){if(!await resolveDraft(createSchedule,discardSchedule))return;}else if(!await confirm(message('unsavedChanges')))return;}discardSchedule();};
  const submit=(event:any,action:()=>Promise<unknown>)=>{event.preventDefault();ui.button('',action).props.onClick();};
  const fieldError=(key:string)=>fieldErrors[key]?renderText(fieldErrors[key],t,locale):undefined;
  const proactivePending=pending.includes(`proactive:${scope?.scopeKey}`);
  return h('section',{className:'panel-page automation-page','aria-label':t('automation'),ref:formRef},
    h('div',{className:'page-toolbar'},ui.button(t(loading?'refreshing':'refresh'),()=>reload(),{disabled:loading||pending.length>0})),
    h('div',{className:'fields'},ui.select(t('persona'),selectedId,configs,id=>leave(()=>{setConfigId(id);setScopeKey('');setCreating(false);}),{disabled:pending.length>0}),
      ui.select(t('targetSession'),scope?.scopeKey??'',scopeNames,key=>leave(()=>{setScopeKey(key);setCreating(false);}),{disabled:pending.length>0||!scope})),
    loadError?h('p',{className:'error',role:'alert'},renderText(loadError,t,locale)):null,
    !data&&loading?h('p',{role:'status'},t('loading')):!scope?h('p',{className:'empty'},data?t('noPrivateSession'):t('automationStateFailed')):h(React.Fragment,null,
      h('form',{className:'card',onSubmit:(event:any)=>submit(event,saveProactive)},
        ui.toggle(t('proactive'),proactive.enabled,()=>update('automation.proactive',{scopeKey:scope.scopeKey,action:proactive.enabled?'off':'on',args:''},message('updated'),`proactive:${scope.scopeKey}`,()=>setData((old:any)=>({...old,proactive:[...(old?.proactive??[]).filter((item:any)=>item.scopeKey!==scope.scopeKey),{...proactive,enabled:!proactive.enabled,scopeKey:scope.scopeKey}]}))),{disabled:proactivePending}),
        proactive.enabled&&proactive.nextAt?h('p',{className:'muted'},t('nextProactive',{time:new Intl.DateTimeFormat(locale,{timeZone:proactive.timezone,dateStyle:'short',timeStyle:'short'}).format(proactive.nextAt)})):null,
        h('fieldset',{disabled:proactivePending},h('div',{className:'fields'},
          ui.field(t('dailyLimit'),value.dailyLimit,v=>patch('dailyLimit',Number(v)),'number',{min:1,max:10,required:true,id:'automation-daily-limit',error:fieldError('dailyLimit')}),
          ui.field(t('quietFrom'),value.quietFrom,v=>patch('quietFrom',v),'time',{required:true}),ui.field(t('quietTo'),value.quietTo,v=>patch('quietTo',v),'time',{required:true})),
          ui.toggle(t('webSearch'),value.allowWeb,()=>patch('allowWeb',!value.allowWeb))),
        panelSaveBar(h,{status:draftDirty?t('unsaved'):t('savedState'),cancel:ui.button(t('revert'),discardProactive,{disabled:!draftDirty||proactivePending}),save:ui.button(t(proactivePending?'saving':'save'),saveProactive,{className:'primary',type:'submit',onClick:undefined,disabled:!draftDirty||proactivePending})})),
      h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,t('scheduledTasks')),ui.button(creating?t('cancel'):t('createNew'),()=>creating?closeSchedule():(()=>{const next=newSchedule();scheduleScope.current=scope.scopeKey;setSchedule(next);setScheduleBaseline(next);setCreating(true);setFieldErrors({});})(),{disabled:pending.includes('create')})),
        creating?h('form',{className:'detail-body',onSubmit:(event:any)=>submit(event,createSchedule)},
          h('fieldset',{disabled:pending.includes('create')},
            ui.textarea(t('target'),schedule.prompt,v=>setSchedule({...schedule,prompt:v}),{required:true,maxLength:12000,id:'schedule-prompt',error:fieldError('prompt')}),
            h('div',{className:'fields'},ui.field(t('runAt'),schedule.runAt,v=>setSchedule({...schedule,runAt:v}),'datetime-local',{required:true,id:'schedule-time',error:fieldError('runAt')}),
              ui.field(t('timezone'),schedule.timezone,v=>setSchedule({...schedule,timezone:v}),'text',{required:true,id:'schedule-timezone',error:fieldError('timezone')}))),
          h('div',{className:'actions'},ui.button(t('create'),createSchedule,{className:'primary',type:'submit',onClick:undefined,disabled:pending.includes('create')}))):null,
        !jobs.length&&!creating?h('p',{className:'empty'},t('noTasks')):null,
        ...jobs.map((job:any)=>h('div',{className:'item',key:job.id},
          h('div',{className:'row spread'},h('strong',null,job.prompt.slice(0,80)),ui.button(t('delete'),async()=>{
            if(await confirm(message('deleteScheduleConfirm')))await update('automation.schedule',{scopeKey:job.scopeKey,action:'delete',args:job.id},message('deleted'),`job:${job.id}`,()=>setData((old:any)=>({...old,scheduled:old.scheduled.filter((item:any)=>item.id!==job.id)})));
          },{className:'quiet danger',disabled:pending.includes(`job:${job.id}`)})),
          h('p',{className:'muted'},`${job.timezone} · ${job.nextAt?new Intl.DateTimeFormat(locale,{timeZone:job.timezone,dateStyle:'short',timeStyle:'short'}).format(job.nextAt):t('noNextRun')}`),
          job.state==='completed'?h('span',{className:'muted'},t('completed')):ui.toggle(t('enableTask'),job.enabled,()=>update('automation.schedule',{scopeKey:job.scopeKey,action:job.enabled?'pause':'resume',args:job.id},message('updated'),`job:${job.id}`,()=>setData((old:any)=>({...old,scheduled:old.scheduled.map((item:any)=>item.id===job.id?{...item,enabled:!job.enabled,state:job.enabled?'paused':'active'}:item)}))),{disabled:pending.includes(`job:${job.id}`)}),
          job.prompt.length>80?ui.details(t('details'),h('p',null,job.prompt)):null)))));
}

