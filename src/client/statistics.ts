import type {StatsResult} from '../core/stats.js';

type Api=(action:string,input?:unknown,signal?:AbortSignal)=>Promise<any>;
const number=(n:number|undefined)=>new Intl.NumberFormat('zh-CN').format(n??0);
const time=(n:number|undefined)=>n?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(n):'未知';
const kindNames:Record<string,string>={agent:'主会话',subagent:'子任务',compaction:'上下文压缩',media:'媒体'};
const phases:Record<string,string>={draft:'待修改',validating:'验证中',validated:'验证通过',queued:'已排队',draining:'等待任务完成',applying:'应用中',restarting:'重启中',reconnecting:'重连中',succeeded:'已生效',rolling_back:'回退中','rolling-back':'回退中','rolled-back':'已回退',failed:'失败',preparing:'准备发布'};

export function StatisticsPanel({React,api,bots}:{React:any;api:Api;bots:any[]}){
  const h=React.createElement;const [range,setRange]=React.useState('today');const [botId,setBot]=React.useState('');
  const [model,setModel]=React.useState('');const [kind,setKind]=React.useState('');const [from,setFrom]=React.useState('');const [to,setTo]=React.useState('');
  const [data,setData]:[StatsResult|null,(value:StatsResult|null)=>void]=React.useState(null);const [error,setError]=React.useState('');const [updated,setUpdated]=React.useState(0);
  React.useEffect(()=>{
    const controller=new AbortController();let running=false;
    const refresh=async()=>{if(running)return;if(range==='custom'&&(!from||!to)){setData(null);return;}running=true;try{const result=await api('stats.query',{range,...(botId?{botId}:{}),...(model?{model}:{}),...(kind?{kind}:{}),...(range==='custom'?{from,to}:{})},controller.signal);if(!controller.signal.aborted){setData(result);setError('');setUpdated(Date.now());}}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{running=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),4000);return()=>{controller.abort();clearInterval(timer);};
  },[range,botId,model,kind,from,to]);
  const select=(label:string,value:string,change:(v:string)=>void,items:Array<[string,string]>)=>h('label',null,label,h('select',{value,onChange:(e:any)=>change(e.target.value)},...items.map(([id,text])=>h('option',{key:id,value:id},text))));
  const table=(heads:string[],rows:any[][],empty='暂无记录')=>h('div',{className:'stats-table-wrap'},h('table',{className:'stats-table'},h('thead',null,h('tr',null,...heads.map(x=>h('th',{key:x,scope:'col'},x)))),h('tbody',null,...(rows.length?rows.map((cells,i)=>h('tr',{key:i},...cells.map((cell,j)=>h('td',{key:j},cell)))):[h('tr',{key:'empty'},h('td',{colSpan:heads.length,className:'muted'},empty))]))));
  const card=(label:string,value:string,detail:string)=>h('section',{className:'stats-card',key:label},h('small',null,label),h('strong',null,value),h('small',null,detail));
  const reported=(value:number,unknown:number)=>`${number(value)}${unknown?`（${number(unknown)} 次未报告）`:''}`;
  const s=data?.summary;const max=Math.max(1,...(data?.trend??[]).map(row=>row.knownTokens));
  return h('section',{'aria-label':'机器人统计'},
    h('div',{className:'row'},select('时间范围',range,setRange,[['today','今天'],['7d','近 7 天'],['30d','近 30 天'],['all','全部'],['custom','自定义']]),select('机器人',botId,setBot,[['','所有机器人'],...bots.map(b=>[b.id,b.name] as [string,string])]),select('调用类别',kind,setKind,[['','全部调用'],...Object.entries(kindNames)]),h('label',null,'模型名称（用量筛选）',h('input',{value:model,onChange:(e:any)=>setModel(e.target.value),placeholder:'全部模型'}))),
    range==='custom'?h('div',{className:'row'},h('label',null,'开始日期（北京时间）',h('input',{type:'date',value:from,onChange:(e:any)=>setFrom(e.target.value)})),h('label',null,'结束日期（不含当天）',h('input',{type:'date',value:to,onChange:(e:any)=>setTo(e.target.value)}))):null,
    h('p',{className:'muted'},'模型与类别仅筛选模型用量；消息按机器人和时间统计。在线状态与群列表反映当前状态。'),
    error?h('p',{role:'alert',className:'error'},error):null,
    !data?h('p',{role:'status'},range==='custom'?'选择起止日期后查询。':'正在读取统计…'):h(React.Fragment,null,
      h('div',{className:'stats-cards'},card('机器人在线',`${number(s!.onlineBots)} / ${number(s!.totalBots)}`,'以真实连接、心跳或轮询结果判定'),card('已知 token',number(s!.knownTokens),`${number(s!.calls)} 次调用；${number(s!.unknownUsageCalls)} 次用量未知`),card('平台接受消息',number(s!.sent),`${number(s!.unknown)} 条发送结果未知；不等于已读`),card('接收消息',number(s!.received),'去重后的私聊、群消息与命令'),card('发送失败 / 取消',`${number(s!.failed)} / ${number(s!.cancelled)}`,`${number(s!.pending)} 条等待发送或等待回执`)),
      h('p',{className:'muted'},`采集开始：${time(data.coverage.collectionStartedAt)}；最后刷新：${time(updated)}。历史仅补录可证明归属的数据；${number(data.coverage.unknownSentTime)} 条历史发送缺少时间。`),
      h('section',{className:'card'},h('h3',null,'按机器人'),table(['机器人','渠道','状态','收到','发送','未知发送','失败 / 取消','已知 token','用量未知'],data.bots.map(b=>[b.name,b.channel==='qq'?'QQ':'微信',b.status,number(b.received),number(b.sent),number(b.unknown),`${number(b.failed)} / ${number(b.cancelled)}`,number(b.knownTokens),`${number(b.unknownUsageCalls)} / ${number(b.calls)}`]))),
      h('section',{className:'card'},h('h3',null,'模型调用'),table(['机器人 / 模型','类别','调用','未缓存输入','缓存读 / 写','输出','推理（已含输出）','未知用量'],data.models.map(m=>[`${m.botId} · ${m.provider}/${m.model}`,kindNames[m.kind],number(m.calls),number(m.inputTokens),`${reported(m.cacheReadTokens,m.unknownCacheReadCalls)} / ${reported(m.cacheWriteTokens,m.unknownCacheWriteCalls)}`,number(m.outputTokens),reported(m.reasoningTokens,m.unknownReasoningCalls),number(m.unknownUsageCalls)])),h('small',null,'缓存、推理字段未返回时，仅累计已报告值；推理不会重复计入总量。')),
      h('section',{className:'card'},h('h3',null,'每日用量与消息'),...data.trend.map(day=>h('div',{key:day.date,className:'stats-trend'},h('span',null,day.date),h('div',{className:'stats-bar-track',role:'img','aria-label':`${day.date} 已知 ${number(day.knownTokens)} token`},h('div',{className:'stats-bar',style:{width:`${day.knownTokens/max*100}%`}})),h('span',null,`${number(day.knownTokens)} token · 收 ${number(day.received)} / 发 ${number(day.sent)}`))),data.trend.length?null:h('p',{className:'muted'},'所选范围暂无带时间的记录。')),
      h('section',{className:'card'},h('h3',null,'已知群记录'),h('p',{className:'muted'},'QQ 名单来自实际群消息或加入 / 退出事件，完整性未知。微信 iLink 接入不支持群聊。'),table(['机器人','群名称 / ID','证据状态','最近活动'],data.groups.map(g=>[g.botId,g.name?`${g.name} / ${g.groupId}`:g.groupId,({observed:'观察到群消息',joined:'加入已确认',left:'退出已确认'})[g.state],time(g.lastSeenAt)]))),
    ));
}

export function EvolutionPanel({React,api}:{React:any;api:Api}){
  const h=React.createElement;const [rows,setRows]=React.useState([] as any[]);const [error,setError]=React.useState('');
  React.useEffect(()=>{const controller=new AbortController();let busy=false;const refresh=async()=>{if(busy)return;busy=true;try{const result=await api('evolution.list',{},controller.signal);if(!controller.signal.aborted){setRows(result);setError('');}}catch(e){if(!controller.signal.aborted)setError((e as Error).message);}finally{busy=false;}};void refresh();const timer=setInterval(()=>void refresh(),4000);return()=>{controller.abort();clearInterval(timer);};},[]);
  return h('section',{'aria-label':'自进化记录'},h('h3',null,'自进化记录'),h('p',null,'在可信私聊使用 /evolve 提出修改要求。人格和技能下一轮生效；代码升级等待在途任务完成。'),error?h('p',{role:'alert',className:'error'},error):null,!rows.length?h('p',{className:'muted'},'暂无改进任务。'):null,...rows.map((row:any)=>h('section',{className:'card',key:row.id},h('div',{className:'row'},h('strong',null,row.goal),h('span',null,phases[row.phase]??row.phase)),h('p',{className:'muted'},`${row.id} · ${time(row.updatedAt)} · ${row.configId}`),row.error?h('p',{className:'error'},row.error):null,row.validation?.length?h('p',null,row.validation.map((v:any)=>`${v.name}: ${v.status}`).join(' · ')):null,h('details',null,h('summary',null,'版本与修改记录'),h('pre',null,JSON.stringify({kind:row.kind,changes:row.changes,beforeRevision:row.before?.revision,afterRevision:row.after?.revision,artifact:row.artifact,events:row.events},null,2))))));
}
