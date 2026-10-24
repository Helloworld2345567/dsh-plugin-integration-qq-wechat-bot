import type {StatsResult} from '../core/stats.js';
import {botStatus} from './ui.js';

type Api=(action:string,input?:unknown,signal?:AbortSignal)=>Promise<any>;
const number=(n:number|undefined)=>new Intl.NumberFormat('zh-CN').format(n??0);
const time=(n:number|undefined)=>n?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(n):'未知';
const kindNames:Record<string,string>={agent:'主会话',subagent:'子任务',compaction:'压缩',media:'媒体'};

export function StatisticsPanel({React,api,bots,compact=false}:{React:any;api:Api;bots:any[];onError?:(message:string)=>void;compact?:boolean}){
  const h=React.createElement;
  const [range,setRange]=React.useState('today');const [botId,setBot]=React.useState('');
  const [model,setModel]=React.useState('');const [kind,setKind]=React.useState('');const [from,setFrom]=React.useState('');const [to,setTo]=React.useState('');
  const [data,setData]:[StatsResult|null,(value:StatsResult|null)=>void]=React.useState(null);
  const [error,setError]=React.useState('');
  React.useEffect(()=>{
    const controller=new AbortController();let running=false;
    setData(null);setError('');
    const refresh=async()=>{if(running||!compact&&range==='custom'&&(!from||!to))return;running=true;try{if(!compact&&range==='custom'&&from>to)throw Error('起日不能晚于止日');const result=await api('stats.query',compact?{range:'today'}:{range,...(botId?{botId}:{}),...(model?{model}:{}),...(kind?{kind}:{}),...(range==='custom'?{from,to}:{})},controller.signal);if(!controller.signal.aborted){setData(result);setError('');}}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{running=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),4000);return()=>{controller.abort();clearInterval(timer);};
  },[range,botId,model,kind,from,to,compact]);
  const select=(label:string,value:string,change:(v:string)=>void,items:Array<[string,string]>)=>h('label',null,label,h('select',{value,onChange:(e:any)=>change(e.target.value)},...items.map(([id,text])=>h('option',{key:id,value:id},text))));
  const table=(heads:string[],rows:any[][],empty='暂无')=>h('div',{className:'stats-table-wrap'},h('table',{className:'stats-table'},h('thead',null,h('tr',null,...heads.map(x=>h('th',{key:x,scope:'col'},x)))),h('tbody',null,...(rows.length?rows.map((cells,i)=>h('tr',{key:i},...cells.map((cell,j)=>h('td',{key:j},cell)))):[h('tr',{key:'empty'},h('td',{colSpan:heads.length,className:'muted'},empty))]))));
  const card=(label:string,value:string,detail:string)=>h('section',{className:'stats-card',key:label},h('small',null,label),h('strong',null,value),h('small',null,detail));
  const reported=(value:number,unknown:number)=>`${number(value)}${unknown?`（${number(unknown)} 未知）`:''}`;
  const s=data?.summary;const max=Math.max(1,...(data?.trend??[]).map(row=>row.knownTokens));
  if(compact)return h('div',null,error?h('p',{className:'error',role:'alert'},error):null,!s?h('p',{className:'muted',role:'status'},'读取中…'):h('div',{className:'row spread',style:{marginTop:16}},h('span',null,'接收 ',h('strong',null,number(s.received))),h('span',null,'发送 ',h('strong',null,number(s.sent))),h('span',null,'Token ',h('strong',null,number(s.knownTokens))),h('small',{className:'full'},`今天 · ${number(s.unknownUsageCalls)} 次用量未知`)));
  return h('section',{'aria-label':'统计'},
    error?h('p',{className:'error',role:'alert'},error):null,
    h('div',{className:'fields'},select('时间',range,setRange,[['today','今天'],['7d','7天'],['30d','30天'],['all','全部'],['custom','自定']]),select('机器人',botId,setBot,[['','全部'],...bots.map(b=>[b.id,b.name] as [string,string])])),
    h('details',null,h('summary',null,'筛选'),h('div',{className:'fields'},select('类别',kind,setKind,[['','全部'],...Object.entries(kindNames)]),h('label',null,'模型',h('input',{value:model,onChange:(e:any)=>setModel(e.target.value),placeholder:'全部'})))),
    range==='custom'?h('div',{className:'fields'},h('label',null,'起日',h('input',{type:'date',value:from,onChange:(e:any)=>setFrom(e.target.value)})),h('label',null,'止日',h('input',{type:'date',value:to,onChange:(e:any)=>setTo(e.target.value)}))):null,
    !data?h('p',{role:'status'},range==='custom'?'请选择日期':'读取中…'):h(React.Fragment,null,
      h('div',{className:'stats-cards'},card('接收',number(s!.received),'去重'),card('发送',number(s!.sent),`${number(s!.unknown)} 未知`),card('Token',number(s!.knownTokens),`${number(s!.unknownUsageCalls)} 次未知`)),
      h('p',{className:'muted'},`失败 ${number(s!.failed)} · 取消 ${number(s!.cancelled)} · 待处理 ${number(s!.pending)}`),
      h('section',null,h('h3',null,'用量趋势'),...data.trend.map(day=>h('div',{key:day.date,className:'stats-trend'},h('span',null,day.date),h('div',{className:'stats-bar-track',role:'img','aria-label':`${day.date} ${number(day.knownTokens)} token`},h('div',{className:'stats-bar',style:{width:`${day.knownTokens/max*100}%`}})),h('span',null,`${number(day.knownTokens)} Token · 收 ${number(day.received)} / 发 ${number(day.sent)}`))),data.trend.length?null:h('p',{className:'empty'},'暂无调用记录')),
      h('details',null,h('summary',null,'机器人明细'),table(['机器人','渠道','状态','收','发','未知','失败/取消','Token'],data.bots.map(b=>[b.name,b.channel,botStatus(b.status),number(b.received),number(b.sent),number(b.unknown),`${number(b.failed)} / ${number(b.cancelled)}`,number(b.knownTokens)]))),
      h('details',null,h('summary',null,'模型明细'),table(['机器人/模型','类别','调用','输入','缓存','输出','推理'],data.models.map(m=>[`${m.botId} · ${m.provider}/${m.model}`,kindNames[m.kind],number(m.calls),number(m.inputTokens),`${reported(m.cacheReadTokens,m.unknownCacheReadCalls)} / ${reported(m.cacheWriteTokens,m.unknownCacheWriteCalls)}`,number(m.outputTokens),reported(m.reasoningTokens,m.unknownReasoningCalls)]))),
      h('details',null,h('summary',null,'群组明细'),table(['机器人','群组','状态','最近'],data.groups.map(g=>[g.botId,g.name?`${g.name} / ${g.groupId}`:g.groupId,({observed:'已观察',joined:'已加入',left:'已退出'})[g.state],time(g.lastSeenAt)])))
    ));
}
