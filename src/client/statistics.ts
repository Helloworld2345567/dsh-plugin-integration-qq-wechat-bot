import type {StatsResult} from '../core/stats.js';
import {botStatus} from './ui.js';
import type {Translate} from './locale.js';

type Api=(action:string,input?:unknown,signal?:AbortSignal)=>Promise<any>;
const number=(n:number|undefined)=>new Intl.NumberFormat('zh-CN').format(n??0);

export function StatisticsPanel({React,api,bots,t,compact=false}:{React:any;api:Api;bots:any[];t:Translate;onError?:(message:string)=>void;compact?:boolean}){
  const h=React.createElement;
  const time=(n:number|undefined)=>n?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(n):t('unknown');
  const kindNames:Record<string,string>={agent:t('mainSession'),subagent:t('subagent'),compaction:t('compaction'),media:t('media'),progress:t('progress')};
  const [range,setRange]=React.useState('today');const [botId,setBot]=React.useState('');
  const [model,setModel]=React.useState('');const [kind,setKind]=React.useState('');const [from,setFrom]=React.useState('');const [to,setTo]=React.useState('');
  const [data,setData]:[StatsResult|null,(value:StatsResult|null)=>void]=React.useState(null);
  const [error,setError]=React.useState('');
  React.useEffect(()=>{
    const controller=new AbortController();let running=false;
    setData(null);setError('');
    const refresh=async()=>{if(running||!compact&&range==='custom'&&(!from||!to))return;running=true;try{if(!compact&&range==='custom'&&from>to)throw Error(t('dateOrderInvalid'));const result=await api('stats.query',compact?{range:'today'}:{range,...(botId?{botId}:{}),...(model?{model}:{}),...(kind?{kind}:{}),...(range==='custom'?{from,to}:{})},controller.signal);if(!controller.signal.aborted){setData(result);setError('');}}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{running=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),4000);return()=>{controller.abort();clearInterval(timer);};
  },[range,botId,model,kind,from,to,compact]);
  const select=(label:string,value:string,change:(v:string)=>void,items:Array<[string,string]>)=>h('label',null,label,h('select',{value,onChange:(e:any)=>change(e.target.value)},...items.map(([id,text])=>h('option',{key:id,value:id},text))));
  const table=(heads:string[],rows:any[][],empty=t('empty'))=>h('div',{className:'stats-table-wrap'},h('table',{className:'stats-table'},h('thead',null,h('tr',null,...heads.map(x=>h('th',{key:x,scope:'col'},x)))),h('tbody',null,...(rows.length?rows.map((cells,i)=>h('tr',{key:i},...cells.map((cell,j)=>h('td',{key:j},cell)))):[h('tr',{key:'empty'},h('td',{colSpan:heads.length,className:'muted'},empty))]))));
  const card=(label:string,value:string,detail:string)=>h('section',{className:'stats-card',key:label},h('small',null,label),h('strong',null,value),h('small',null,detail));
  const reported=(value:number,unknown:number)=>unknown?t('reportedUnknown',{value:number(value),unknown:number(unknown)}):number(value);
  const s=data?.summary;const max=Math.max(1,...(data?.trend??[]).map(row=>row.knownTokens));
  if(compact)return h('div',null,error?h('p',{className:'error',role:'alert'},error):null,!s?h('p',{className:'muted',role:'status'},t('loading')):h('div',{className:'row spread',style:{marginTop:16}},h('span',null,`${t('received')} `,h('strong',null,number(s.received))),h('span',null,`${t('sent')} `,h('strong',null,number(s.sent))),h('span',null,'Token ',h('strong',null,number(s.knownTokens))),h('small',{className:'full'},t('todayUnknown',{count:number(s.unknownUsageCalls)}))));
  return h('section',{'aria-label':t('stats')},
    error?h('p',{className:'error',role:'alert'},error):null,
    h('div',{className:'fields'},select(t('timeRange'),range,setRange,[['today',t('today')],['7d',t('days7')],['30d',t('days30')],['all',t('all')],['custom',t('custom')]]),select(t('bots'),botId,setBot,[['',t('all')],...bots.map(b=>[b.id,b.name] as [string,string])])),
    h('details',null,h('summary',null,t('filter')),h('div',{className:'fields'},select(t('category'),kind,setKind,[['',t('all')],...Object.entries(kindNames)]),h('label',null,t('model'),h('input',{value:model,onChange:(e:any)=>setModel(e.target.value),placeholder:t('all')})))),
    range==='custom'?h('div',{className:'fields'},h('label',null,t('startDate'),h('input',{type:'date',value:from,onChange:(e:any)=>setFrom(e.target.value)})),h('label',null,t('endDate'),h('input',{type:'date',value:to,onChange:(e:any)=>setTo(e.target.value)}))):null,
    !data?h('p',{role:'status'},range==='custom'?t('chooseDate'):t('loading')):h(React.Fragment,null,
      h('div',{className:'stats-cards'},card(t('received'),number(s!.received),t('deduplicated')),card(t('sent'),number(s!.sent),t('unknownCount',{count:number(s!.unknown)})),card('Token',number(s!.knownTokens),t('unknownCalls',{count:number(s!.unknownUsageCalls)}))),
      h('p',{className:'muted'},t('summaryStates',{failed:number(s!.failed),cancelled:number(s!.cancelled),pending:number(s!.pending)})),
      h('section',null,h('h3',null,t('usageTrend')),...data.trend.map(day=>h('div',{key:day.date,className:'stats-trend'},h('span',null,day.date),h('div',{className:'stats-bar-track',role:'img','aria-label':`${day.date} ${number(day.knownTokens)} token`},h('div',{className:'stats-bar',style:{width:`${day.knownTokens/max*100}%`}})),h('span',null,t('trendRow',{tokens:number(day.knownTokens),received:number(day.received),sent:number(day.sent)})))),data.trend.length?null:h('p',{className:'empty'},t('noCalls'))),
      h('details',null,h('summary',null,t('botDetails')),table([t('bots'),t('channel'),t('status'),t('receiveShort'),t('sendShort'),t('unknown'),t('failureCancel'),'Token'],data.bots.map(b=>[b.name,b.channel,botStatus(b.status,t),number(b.received),number(b.sent),number(b.unknown),`${number(b.failed)} / ${number(b.cancelled)}`,number(b.knownTokens)]))),
      h('details',null,h('summary',null,t('modelDetails')),table([t('botModel'),t('category'),t('calls'),t('input'),t('cache'),t('outputTokens'),t('reasoning')],data.models.map(m=>[`${m.botId} · ${m.provider}/${m.model}`,kindNames[m.kind],number(m.calls),number(m.inputTokens),`${reported(m.cacheReadTokens,m.unknownCacheReadCalls)} / ${reported(m.cacheWriteTokens,m.unknownCacheWriteCalls)}`,number(m.outputTokens),reported(m.reasoningTokens,m.unknownReasoningCalls)]))),
      h('details',null,h('summary',null,t('groupDetails')),table([t('bots'),t('group'),t('status'),t('recent')],data.groups.map(g=>[g.botId,g.name?`${g.name} / ${g.groupId}`:g.groupId,({observed:t('observed'),joined:t('joined'),left:t('left')})[g.state],time(g.lastSeenAt)])))
    ));
}
