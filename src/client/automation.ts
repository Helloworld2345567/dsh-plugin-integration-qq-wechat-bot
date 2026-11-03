import {createUI,dateInput,scheduledTime,type Api,type Mutation} from './ui.js';
import {chinese,type Translate} from './locale.js';

export function AutomationPanel({React,query,mutate,configs,bots,confirm,onError,busy,t=chinese,active=true}:{React:any;query:Api;mutate:Mutation;configs:any[];bots:any[];confirm:(message:string)=>Promise<boolean>;onError:(message:string)=>void;busy:boolean;t?:Translate;active?:boolean}){
  const h=React.createElement;
  const [data,setData]=React.useState(null);
  const [configId,setConfigId]=React.useState('');const [scopeKey,setScopeKey]=React.useState('');
  const [drafts,setDrafts]=React.useState({} as Record<string,any>);
  const [creating,setCreating]=React.useState(false);
  const [schedule,setSchedule]=React.useState({prompt:'',timezone:'Asia/Shanghai',runAt:dateInput(Date.now()+3600000,'Asia/Shanghai')});
  const [loading,setLoading]=React.useState(true);const [loadError,setLoadError]=React.useState('');
  const [pending,setPending]=React.useState(false);const pendingRef=React.useRef(false);
  const ui=createUI(React,busy||pending,onError);
  const assignments=JSON.stringify(bots.map(b=>[b.id,b.configId]));
  const reload=async(signal?:AbortSignal)=>{
    setLoading(true);setLoadError('');
    try{const result=await query('automation.list',{},signal);if(signal?.aborted)return;if(!result)throw Error(t('automationStateFailed'));setData(result);}
    catch(error){if(!signal?.aborted){setData(null);setLoadError((error as Error).message);}throw error;}
    finally{if(!signal?.aborted)setLoading(false);}
  };
  React.useEffect(()=>{if(!active)return;const abort=new AbortController();void reload(abort.signal).catch(()=>{});return()=>abort.abort();},[active,assignments]);
  const selectedId=configs.some(c=>c.id===configId)?configId:configs[0]?.id??'';
  const scopes=(data?.scopes??[]).filter((s:any)=>s.configId===selectedId);
  const scope=scopes.find((s:any)=>s.scopeKey===scopeKey)??scopes[0];
  const proactive=(data?.proactive??[]).find((p:any)=>p.scopeKey===scope?.scopeKey)??{enabled:false,dailyLimit:3,quietFrom:'00:00',quietTo:'09:00',allowWeb:false,timezone:'Asia/Shanghai'};
  const draft=scope?drafts[scope.scopeKey]??{}:{};
  const patch=(key:string,value:any)=>setDrafts((old:any)=>({...old,[scope.scopeKey]:{...old[scope.scopeKey],[key]:value}}));
  const value={...proactive,...draft};
  const jobs=(data?.scheduled??[]).filter((j:any)=>j.scopeKey===scope?.scopeKey);
  const scopeNames=scopes.map((s:any)=>({id:s.scopeKey,name:`${bots.find(b=>b.id===s.botId)?.name??s.botId} · ${s.senderId}`}));
  const update=async(action:string,input:any,message:string)=>{
    if(pendingRef.current)throw Error(t('operationBusy'));pendingRef.current=true;setPending(true);
    try{await mutate(action,input,message);try{await reload();}catch{onError(t('automationRefreshFailed'));}}
    finally{pendingRef.current=false;setPending(false);}
  };
  return h('section',{'aria-label':t('automation')},
    h('div',{className:'fields'},ui.select(t('persona'),selectedId,configs,id=>{setConfigId(id);setScopeKey('');setCreating(false);}),
      ui.select(t('targetSession'),scope?.scopeKey??'',scopeNames,key=>{setScopeKey(key);setCreating(false);},{disabled:busy||pending||loading||!scope})),
    loading?h('p',{role:'status'},t('loading')):loadError?h('div',null,h('p',{className:'error',role:'alert'},loadError),ui.button(t('refresh'),()=>reload(),{className:'primary'})):!scope?h('p',{className:'empty'},t('noPrivateSession')):h(React.Fragment,null,
      h('section',{className:'card'},ui.toggle(t('proactive'),proactive.enabled,async()=>{
        await update('automation.proactive',{scopeKey:scope.scopeKey,action:proactive.enabled?'off':'on',args:''},t('updated'));
      }),h('p',{className:'muted'},t('proactiveSummary',{limit:proactive.dailyLimit,from:proactive.quietFrom,to:proactive.quietTo,timezone:proactive.timezone})),
      proactive.enabled&&proactive.nextAt?h('p',{className:'muted'},t('nextProactive',{time:new Intl.DateTimeFormat('zh-CN',{timeZone:proactive.timezone,dateStyle:'short',timeStyle:'short'}).format(proactive.nextAt)})):null,
      ui.details(t('settings'),h('div',{className:'fields'},
        ui.field(t('dailyLimit'),value.dailyLimit,v=>patch('dailyLimit',Number(v)),'number',{min:1,max:10}),
        ui.field(t('quietFrom'),value.quietFrom,v=>patch('quietFrom',v),'time'),ui.field(t('quietTo'),value.quietTo,v=>patch('quietTo',v),'time')),
        ui.toggle(t('webSearch'),value.allowWeb,()=>patch('allowWeb',!value.allowWeb)),
        h('div',{className:'row spread'},h('small',null,Object.keys(draft).length?t('unsaved'):''),ui.button(t('save'),async()=>{
          if(!Number.isInteger(value.dailyLimit)||value.dailyLimit<1||value.dailyLimit>10)throw Error(t('dailyLimitInvalid'));
          await update('automation.proactive',{scopeKey:scope.scopeKey,action:'set',args:Object.entries(draft).map(([k,v])=>`${k}=${v}`).join(' ')},t('saved'));
          setDrafts((old:any)=>{const next={...old};delete next[scope.scopeKey];return next;});
        },{className:'primary',disabled:busy||!Object.keys(draft).length})))),
      h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,t('scheduledTasks')),ui.button(creating?t('cancel'):t('createNew'),()=>setCreating(!creating))),
        creating?h('div',{className:'detail-body'},ui.textarea(t('target'),schedule.prompt,v=>setSchedule({...schedule,prompt:v})),
          h('div',{className:'fields'},ui.field(t('runAt'),schedule.runAt,v=>setSchedule({...schedule,runAt:v}),'datetime-local'),
            ui.field(t('timezone'),schedule.timezone,v=>setSchedule({...schedule,timezone:v}))),
          h('small',null,t('timezoneHint')),ui.button(t('create'),async()=>{
            const at=scheduledTime(schedule.runAt,schedule.timezone,t);const delayMs=at-Date.now();
            if(delayMs<1000)throw Error(t('timeMustBeFuture'));
            if(!schedule.prompt.trim())throw Error(t('targetRequired'));
            await update('automation.schedule',{scopeKey:scope.scopeKey,action:'create',args:JSON.stringify({delayMs,timezone:schedule.timezone,prompt:schedule.prompt.trim()})},t('created'));
            setCreating(false);setSchedule({...schedule,prompt:''});
          },{className:'primary'})):null,
        !jobs.length&&!creating?h('p',{className:'empty'},t('noTasks')):null,
        ...jobs.map((job:any)=>h('div',{className:'item',key:job.id},
          h('div',{className:'row spread'},h('strong',null,job.prompt.slice(0,80)),ui.button(t('delete'),async()=>{
            if(await confirm(t('deleteScheduleConfirm')))await update('automation.schedule',{scopeKey:job.scopeKey,action:'delete',args:job.id},t('deleted'));
          },{className:'quiet danger'})),
          h('p',{className:'muted'},`${job.timezone} · ${job.nextAt?new Intl.DateTimeFormat('zh-CN',{timeZone:job.timezone,dateStyle:'short',timeStyle:'short'}).format(job.nextAt):t('noNextRun')}`),
          job.state==='completed'?h('span',{className:'muted'},t('completed')):ui.toggle(t('enableTask'),job.enabled,async()=>{await update('automation.schedule',{scopeKey:job.scopeKey,action:job.enabled?'pause':'resume',args:job.id},t('updated'));}),
          job.prompt.length>80?ui.details(t('details'),h('p',null,job.prompt)):null)))));
}
