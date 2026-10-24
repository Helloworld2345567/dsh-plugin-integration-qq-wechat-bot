import {createUI,dateInput,scheduledTime,type Api,type Mutation} from './ui.js';

export function AutomationPanel({React,query,mutate,configs,bots,confirm,onError,busy,active=true}:{React:any;query:Api;mutate:Mutation;configs:any[];bots:any[];confirm:(message:string)=>Promise<boolean>;onError:(message:string)=>void;busy:boolean;active?:boolean}){
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
    try{const result=await query('automation.list',{},signal);if(signal?.aborted)return;if(!result)throw Error('状态未读取，请重试');setData(result);}
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
    if(pendingRef.current)throw Error('操作进行中，请稍候');pendingRef.current=true;setPending(true);
    try{await mutate(action,input,message);try{await reload();}catch{onError('操作已完成，但列表刷新失败。请刷新列表确认结果。');}}
    finally{pendingRef.current=false;setPending(false);}
  };
  return h('section',{'aria-label':'自动化'},
    h('div',{className:'fields'},ui.select('人格',selectedId,configs,id=>{setConfigId(id);setScopeKey('');setCreating(false);}),
      ui.select('目标会话',scope?.scopeKey??'',scopeNames,key=>{setScopeKey(key);setCreating(false);},{disabled:busy||pending||loading||!scope})),
    loading?h('p',{role:'status'},'读取中…'):loadError?h('div',null,h('p',{className:'error',role:'alert'},loadError),ui.button('刷新',()=>reload(),{className:'primary'})):!scope?h('p',{className:'empty'},'此人格暂无私聊会话，收到私聊后可设置自动化。'):h(React.Fragment,null,
      h('section',{className:'card'},ui.toggle('主动会话',proactive.enabled,async()=>{
        await update('automation.proactive',{scopeKey:scope.scopeKey,action:proactive.enabled?'off':'on',args:''},'已更新');
      }),h('p',{className:'muted'},`每日最多 ${proactive.dailyLimit} 次 · ${proactive.quietFrom}–${proactive.quietTo} 静默 · ${proactive.timezone}`),
      ui.details('设置',h('div',{className:'fields'},
        ui.field('每日上限',value.dailyLimit,v=>patch('dailyLimit',Number(v)),'number',{min:1,max:10}),
        ui.field('静默开始',value.quietFrom,v=>patch('quietFrom',v),'time'),ui.field('静默结束',value.quietTo,v=>patch('quietTo',v),'time')),
        ui.toggle('网页搜索',value.allowWeb,()=>patch('allowWeb',!value.allowWeb)),
        h('div',{className:'row spread'},h('small',null,Object.keys(draft).length?'未保存':''),ui.button('保存',async()=>{
          if(!Number.isInteger(value.dailyLimit)||value.dailyLimit<1||value.dailyLimit>10)throw Error('每日上限应为 1–10 次');
          await update('automation.proactive',{scopeKey:scope.scopeKey,action:'set',args:Object.entries(draft).map(([k,v])=>`${k}=${v}`).join(' ')},'已保存');
          setDrafts((old:any)=>{const next={...old};delete next[scope.scopeKey];return next;});
        },{className:'primary',disabled:busy||!Object.keys(draft).length})))),
      h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,'定时任务'),ui.button(creating?'取消':'新建',()=>setCreating(!creating))),
        creating?h('div',{className:'detail-body'},ui.textarea('目标',schedule.prompt,v=>setSchedule({...schedule,prompt:v})),
          h('div',{className:'fields'},ui.field('执行时间',schedule.runAt,v=>setSchedule({...schedule,runAt:v}),'datetime-local'),
            ui.field('时区',schedule.timezone,v=>setSchedule({...schedule,timezone:v}))),
          h('small',null,'按所选时区执行'),ui.button('创建',async()=>{
            const at=scheduledTime(schedule.runAt,schedule.timezone);const delayMs=at-Date.now();
            if(delayMs<1000)throw Error('执行时间必须晚于当前时间');
            if(!schedule.prompt.trim())throw Error('请输入任务目标');
            await update('automation.schedule',{scopeKey:scope.scopeKey,action:'create',args:JSON.stringify({delayMs,timezone:schedule.timezone,prompt:schedule.prompt.trim()})},'已创建');
            setCreating(false);setSchedule({...schedule,prompt:''});
          },{className:'primary'})):null,
        !jobs.length&&!creating?h('p',{className:'empty'},'暂无任务'):null,
        ...jobs.map((job:any)=>h('div',{className:'item',key:job.id},
          h('div',{className:'row spread'},h('strong',null,job.prompt.slice(0,80)),ui.button('删除',async()=>{
            if(await confirm('删除此定时任务？'))await update('automation.schedule',{scopeKey:job.scopeKey,action:'delete',args:job.id},'已删除');
          },{className:'quiet danger'})),
          h('p',{className:'muted'},`${job.timezone} · ${job.nextAt?new Intl.DateTimeFormat('zh-CN',{timeZone:job.timezone,dateStyle:'short',timeStyle:'short'}).format(job.nextAt):'暂无下次执行'}`),
          ui.toggle('启用任务',job.enabled,async()=>{await update('automation.schedule',{scopeKey:job.scopeKey,action:job.enabled?'pause':'resume',args:job.id},'已更新');}),
          job.prompt.length>80?ui.details('详情',h('p',null,job.prompt)):null)))));
}
