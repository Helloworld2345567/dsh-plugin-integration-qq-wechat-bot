import type {StatsResult} from '../core/stats.js';

type Api=(action:string,input?:unknown,signal?:AbortSignal)=>Promise<any>;
const number=(n:number|undefined)=>new Intl.NumberFormat('zh-CN').format(n??0);
const time=(n:number|undefined)=>n?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(n):'未知';
const kindNames:Record<string,string>={agent:'主会话',subagent:'子任务',compaction:'压缩',media:'媒体'};

export function StatisticsPanel({React,api,bots,onError}:{React:any;api:Api;bots:any[];onError:(message:string)=>void}){
  const h=React.createElement;
  const [range,setRange]=React.useState('today');const [botId,setBot]=React.useState('');
  const [model,setModel]=React.useState('');const [kind,setKind]=React.useState('');const [from,setFrom]=React.useState('');const [to,setTo]=React.useState('');
  const [data,setData]:[StatsResult|null,(value:StatsResult|null)=>void]=React.useState(null);
  React.useEffect(()=>{
    const controller=new AbortController();let running=false;
    const refresh=async()=>{if(running||range==='custom'&&(!from||!to))return;running=true;try{const result=await api('stats.query',{range,...(botId?{botId}:{}),...(model?{model}:{}),...(kind?{kind}:{}),...(range==='custom'?{from,to}:{})},controller.signal);if(!controller.signal.aborted){setData(result);onError('');}}catch(e){if(!controller.signal.aborted)onError((e as Error).message);}finally{running=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),4000);return()=>{controller.abort();clearInterval(timer);};
  },[range,botId,model,kind,from,to]);
  const select=(label:string,value:string,change:(v:string)=>void,items:Array<[string,string]>)=>h('label',null,label,h('select',{value,onChange:(e:any)=>change(e.target.value)},...items.map(([id,text])=>h('option',{key:id,value:id},text))));
  const table=(heads:string[],rows:any[][],empty='暂无')=>h('div',{className:'stats-table-wrap'},h('table',{className:'stats-table'},h('thead',null,h('tr',null,...heads.map(x=>h('th',{key:x,scope:'col'},x)))),h('tbody',null,...(rows.length?rows.map((cells,i)=>h('tr',{key:i},...cells.map((cell,j)=>h('td',{key:j},cell)))):[h('tr',{key:'empty'},h('td',{colSpan:heads.length,className:'muted'},empty))]))));
  const card=(label:string,value:string,detail:string)=>h('section',{className:'stats-card',key:label},h('small',null,label),h('strong',null,value),h('small',null,detail));
  const reported=(value:number,unknown:number)=>`${number(value)}${unknown?`（${number(unknown)} 未知）`:''}`;
  const s=data?.summary;const max=Math.max(1,...(data?.trend??[]).map(row=>row.knownTokens));
  return h('section',{'aria-label':'统计'},
    h('div',{className:'row'},select('时间',range,setRange,[['today','今天'],['7d','7天'],['30d','30天'],['all','全部'],['custom','自定']]),select('机器人',botId,setBot,[['','全部'],...bots.map(b=>[b.id,b.name] as [string,string])]),select('类别',kind,setKind,[['','全部'],...Object.entries(kindNames)]),h('label',null,'模型',h('input',{value:model,onChange:(e:any)=>setModel(e.target.value),placeholder:'全部'}))),
    range==='custom'?h('div',{className:'row'},h('label',null,'起日',h('input',{type:'date',value:from,onChange:(e:any)=>setFrom(e.target.value)})),h('label',null,'止日',h('input',{type:'date',value:to,onChange:(e:any)=>setTo(e.target.value)}))):null,
    !data?h('p',{role:'status'},range==='custom'?'请选择日期':'读取中…'):h(React.Fragment,null,
      h('div',{className:'stats-cards'},card('在线',`${number(s!.onlineBots)} / ${number(s!.totalBots)}`,'状态'),card('Token',number(s!.knownTokens),`${number(s!.calls)} 次 · ${number(s!.unknownUsageCalls)} 未知`),card('发送',number(s!.sent),`${number(s!.unknown)} 未知`),card('接收',number(s!.received),'去重'),card('异常',`${number(s!.failed)} / ${number(s!.cancelled)}`,`${number(s!.pending)} 待处理`)),
      h('section',{className:'card'},h('h3',null,'机器人'),table(['机器人','渠道','状态','收','发','未知','失败/取消','Token'],data.bots.map(b=>[b.name,b.channel,b.status,number(b.received),number(b.sent),number(b.unknown),`${number(b.failed)} / ${number(b.cancelled)}`,number(b.knownTokens)]))),
      h('section',{className:'card'},h('h3',null,'模型'),table(['机器人/模型','类别','调用','输入','缓存','输出','推理'],data.models.map(m=>[`${m.botId} · ${m.provider}/${m.model}`,kindNames[m.kind],number(m.calls),number(m.inputTokens),`${reported(m.cacheReadTokens,m.unknownCacheReadCalls)} / ${reported(m.cacheWriteTokens,m.unknownCacheWriteCalls)}`,number(m.outputTokens),reported(m.reasoningTokens,m.unknownReasoningCalls)]))),
      h('section',{className:'card'},h('h3',null,'趋势'),...data.trend.map(day=>h('div',{key:day.date,className:'stats-trend'},h('span',null,day.date),h('div',{className:'stats-bar-track',role:'img','aria-label':`${day.date} ${number(day.knownTokens)} token`},h('div',{className:'stats-bar',style:{width:`${day.knownTokens/max*100}%`}})),h('span',null,`${number(day.knownTokens)} · 收 ${number(day.received)} / 发 ${number(day.sent)}`))),data.trend.length?null:h('p',{className:'muted'},'暂无')),
      h('section',{className:'card'},h('h3',null,'群组'),table(['机器人','群组','状态','最近'],data.groups.map(g=>[g.botId,g.name?`${g.name} / ${g.groupId}`:g.groupId,({observed:'已观察',joined:'已加入',left:'已退出'})[g.state],time(g.lastSeenAt)])))
    ));
}
