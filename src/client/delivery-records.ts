import type {DeliveryRecordView as Row} from '../core/client-contracts.js';
import {errorText,message,renderText,type DisplayText,type LocaleKey,type Translate} from './locale.js';
import {createUI,type Api} from './ui.js';

const states={
  pending:'deliveryQueued',sending:'deliverySending',sent:'deliveryAccepted',
  failed:'deliveryFailed',unknown:'deliveryUnknown',cancelled:'deliveryCancelled',
} satisfies Record<Row['state'],LocaleKey>;
const phases={prepare:'deliveryPrepare',upload:'deliveryUpload',commit:'deliveryCommit'} satisfies Record<NonNullable<Row['attempt']>['phase'],LocaleKey>;
type Page={items:Row[];nextCursor:string|null};
interface Props{
  React:any;t:Translate;locale:'zh'|'en';bots:{id:string;name:string;enabled:boolean}[];running:boolean;
  query:Api;api:Api;confirm:(title:DisplayText,description:DisplayText)=>Promise<boolean>;
}

export function DeliveryRecords({React,t,locale,bots,running,query,api,confirm}:Props){
  const h=React.createElement;
  const [open,setOpen]=React.useState(false),[bot,setBot]=React.useState(''),[state,setState]=React.useState('');
  const [page,setPage]=React.useState(null as Page|null),[loading,setLoading]=React.useState(false);
  const [revision,setRevision]=React.useState(0),[error,setError]=React.useState(undefined as DisplayText|undefined);
  const [retrying,setRetrying]=React.useState(''),retryRef=React.useRef('');
  const request=React.useRef(0);
  async function load(cursor?:string){
    const generation=++request.current;
    setLoading(true);setError(undefined);
    try{
      const result:Page=await query('overview.deliveries',{limit:25,...bot?{botId:bot}:{},...state?{state}:{},...cursor?{cursor}:{}});
      if(request.current===generation)setPage((old:Page|null)=>({...result,items:cursor?[...(old?.items??[]),...result.items]:result.items}));
    }catch(e){
      if(request.current===generation)setError(e instanceof Error&&e.message.includes('PAGE_STALE')?message('deliveryStale'):errorText(e));
    }finally{if(request.current===generation)setLoading(false);}
  }
  React.useEffect(()=>{
    if(open)void load();
    return()=>{++request.current;};
  },[open,bot,state,revision]);
  const refresh=()=>setRevision((value:number)=>value+1);
  const changeFilter=(setter:(value:string)=>void,value:string)=>{++request.current;setPage(null);setError(undefined);setter(value);};
  async function retry(row:Row){
    if(retryRef.current||row.purpose==='progress')return;
    retryRef.current=row.id;setRetrying(row.id);
    try{
      if(row.state==='unknown'&&!await confirm(message('deliveryResend'),message('deliveryUnknownWarning')))return;
      await api('delivery.retry',{id:row.id,...row.state==='unknown'?{confirmUnknown:true}:{}});
      refresh();
    }catch(e){setError(errorText(e));}
    finally{retryRef.current='';setRetrying('');}
  }
  const ui=createUI(React,false,setError,t),names=new Map(bots.map(item=>[item.id,item]));
  const localTime=(at?:number)=>at===undefined?undefined:new Date(at).toLocaleString(locale==='zh'?'zh-CN':'en-US');
  function record(row:Row){
    const owner=names.get(row.botId),attempt=row.attempt;
    const detail=(label:string,value:string|number|undefined)=>value===undefined?null:h('div',null,h('dt',null,label),h('dd',null,value));
    const diagnostics=[...new Set([row.error,attempt?.platformMessage,attempt?.causeMessage,attempt?.lastError].filter(Boolean))].join(' · ');
    return h('details',{className:'delivery-record',key:row.id},
      h('summary',null,[owner?.name??row.botId,t(states[row.state]),t(row.purpose==='progress'?'progress':row.output.type==='asset'?'deliveryAttachment':'deliveryText'),localTime(row.createdAt)].filter(Boolean).join(' · ')),
      h('dl',null,detail(t('deliveryId'),row.id),detail(t('deliverySessionTurn'),`${row.sessionId} / ${row.turnId}`),
        detail(t('deliveryAttempt'),attempt?.number),detail(t('deliveryAttemptAt'),localTime(attempt?.startedAt)),detail(t('deliveryAcceptedAt'),localTime(row.sentAt)),detail(t('deliveryReceipt'),row.receipt),
        detail(t('deliveryPhase'),attempt?.phase?t(phases[attempt.phase]):undefined),detail(t('deliveryCode'),[attempt?.httpStatus,attempt?.platformCode,attempt?.causeCode].filter(Boolean).join(' · ')||undefined),
        detail(t('deliveryTrace'),attempt?.platformTraceId),detail(t('error'),diagnostics||undefined)),
      row.purpose!=='progress'&&(row.state==='failed'||row.state==='unknown')?ui.button(t(row.state==='unknown'?'deliveryResend':'deliveryRetry'),()=>retry(row),{className:'quiet',disabled:loading||!!retrying||!running||!owner?.enabled,title:!running||!owner?.enabled?t('deliveryStartFirst'):undefined}):null);
  }
  return h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,t('deliveryRecords')),
    ui.button(t(open?'collapse':'details'),()=>setOpen(!open),{className:'quiet','aria-expanded':open,'aria-controls':'bot-delivery-records'})),
    open?h('div',{id:'bot-delivery-records'},
      h('div',{className:'fields'},ui.select(t('bots'),bot,[{id:'',name:t('all')},...bots.map(item=>({id:item.id,name:item.name}))],value=>changeFilter(setBot,value)),
        ui.select(t('status'),state,[{id:'',name:t('all')},...Object.entries(states).map(([id,key])=>({id,name:t(key)}))],value=>changeFilter(setState,value))),
      loading?h('p',{className:'muted',role:'status'},t('loading')):null,
      error?h('p',{className:'error',role:'alert'},renderText(error,t,locale)):null,
      page&&!page.items.length?h('p',{className:'muted'},t('empty')):null,...(page?.items??[]).map(record),
      h('div',{className:'actions'},ui.button(t('refresh'),refresh,{className:'quiet',disabled:loading}),
        page?.nextCursor?ui.button(t('loadMore'),()=>load(page.nextCursor),{className:'quiet',disabled:loading}):null)):null);
}
