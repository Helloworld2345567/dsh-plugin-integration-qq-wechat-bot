import {StatisticsPanel} from './statistics.js';
import {AutomationPanel} from './automation.js';
import {AdminClient} from './admin-client.js';
import {panelStyles} from './styles.js';
import {botStatus,createUI,list} from './ui.js';

/* Use the Harness module loader's React instance. */
declare const window:Window & {__ModuleLoader__:any;__BOT_INTEGRATION__?:{endpoint:string;token:string}};
window.__ModuleLoader__.load({id:'dsh-plugin-integration-qq-wechat-bot',factory(require:(id:string)=>any){
  const React=require('react');const h=React.createElement;
  async function api(action:string,input:any={},signal?:AbortSignal){
    const boot=window.__BOT_INTEGRATION__;if(!boot)throw Error('机器人服务尚未就绪，请刷新页面');
    const response=await fetch(boot.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${boot.token}`},body:JSON.stringify({action,input}),signal});
    const body=await response.json();if(!response.ok)throw Error(body.error||'操作失败');return body.result;
  }
  function App(){
    const [tab,setTab]=React.useState('overview');
    const [summary,setSummary]=React.useState(null);const [summaryError,setSummaryError]=React.useState('');
    const [error,setError]=React.useState('');const [notice,setNotice]=React.useState('');const [busy,setBusy]=React.useState(false);
    const [bots,setBots]=React.useState(null);const [edit,setEdit]=React.useState(null);const [dirty,setDirty]=React.useState(false);
    const [configLoading,setConfigLoading]=React.useState(false);const [section,setSection]=React.useState('basic');
    const [models,setModels]=React.useState([]);const [directories,setDirectories]=React.useState({personas:[],workspaceRoot:''});
    const [imageSkills,setImageSkills]=React.useState({});const [mediaSkills,setMediaSkills]=React.useState({});
    const [newOpen,setNewOpen]=React.useState(false);const [newBot,setNewBot]=React.useState({id:'',name:'',channel:'qq',configId:'default',trustedUsers:[]});
    const [workspaceEdits,setWorkspaceEdits]=React.useState({} as Record<string,string>);
    const [credential,setCredential]=React.useState(null);const [qr,setQr]=React.useState(null);const [stats,setStats]=React.useState(false);
    const [question,setQuestion]=React.useState(null);
    const [automationVisited,setAutomationVisited]=React.useState(false);
    const clientRef=React.useRef(null);const loadSequence=React.useRef(0);const dialogRef=React.useRef(null);const mutationRef=React.useRef(false);
    const ui=createUI(React,busy,setError);
    const client=()=>{if(!clientRef.current){const boot=window.__BOT_INTEGRATION__;if(!boot)throw Error('机器人服务尚未就绪，请刷新页面');clientRef.current=new AdminClient(boot);}return clientRef.current as AdminClient;};
    const query=async(name:string,input:any={},signal?:AbortSignal)=>client().query(name,input,signal);
    const refresh=async()=>{const next=await query('overview.summary');if(next){setSummary(next);setSummaryError('');}};
    const refreshBots=async()=>{client().invalidate('bots.list');const next=await query('bots.list');if(next)setBots(next);};
    const mutate=async(action:string,input:any={},message='已保存')=>{
      if(mutationRef.current)throw Error('操作进行中，请稍候');mutationRef.current=true;setBusy(true);setError('');setNotice('');
      try{
        const result=await api(action,input);
        if(action.startsWith('config.'))client().invalidate('catalog.config',{id:input.id??input.config?.id});
        if(action.startsWith('automation.'))client().invalidate('automation.list');
        setNotice(message);
        // Refresh failures must not turn a successful write into an apparent failed save.
        try{await refresh();if(action.startsWith('bot.'))await refreshBots();}catch{setError('操作已完成，状态刷新失败，请稍后重新打开页面');}
        return result;
      }finally{mutationRef.current=false;setBusy(false);}
    };
    const ask=(title:string,value=''):Promise<string|null>=>new Promise(resolve=>setQuestion({title,value,resolve,confirm:false}));
    const confirm=(title:string):Promise<boolean>=>new Promise(resolve=>setQuestion({title,value:'',resolve,confirm:true}));
    const answer=(value:any)=>{question?.resolve(value);setQuestion(null);};
    const navigate=(next:string)=>{setTab(next);if(next==='automation')setAutomationVisited(true);setError('');setNotice('');};
    const loadConfig=async(id:string)=>{
      if(dirty&&!await confirm('当前人格有未保存修改，放弃修改并切换？'))return;
      const sequence=++loadSequence.current;setConfigLoading(true);setError('');setNotice('');
      try{const config=await query('catalog.config',{id});if(config&&sequence===loadSequence.current){setEdit(config);setDirty(false);}}
      finally{if(sequence===loadSequence.current)setConfigLoading(false);}
    };
    React.useEffect(()=>{let stopped=false,running=false;const poll=async()=>{if(running)return;running=true;try{await refresh();}catch(e){if(!stopped)setSummaryError((e as Error).message);}finally{running=false;}};
      void poll();const timer=setInterval(()=>{if(!stopped)void poll();},4000);return()=>{stopped=true;clearInterval(timer);clientRef.current?.cancel('overview.summary');};},[]);
    React.useEffect(()=>{if(tab!=='bots')return;const abort=new AbortController();void query('bots.list',{},abort.signal).then((next:any)=>{if(next&&!abort.signal.aborted)setBots(next);}).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});void api('directories',{},abort.signal).then(setDirectories).catch(()=>{});return()=>abort.abort();},[tab]);
    React.useEffect(()=>{if(tab!=='catalog')return;const abort=new AbortController();for(const [action,set] of [['models',setModels],['directories',setDirectories],['skill.image.status',setImageSkills],['skill.media.status',setMediaSkills]] as const){void api(action,{},abort.signal).then((next:any)=>{if(!abort.signal.aborted)set(next);}).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});}return()=>abort.abort();},[tab]);
    const configs=(summary?.configs??[]).filter((c:any)=>!c.archived);
    React.useEffect(()=>{if(tab==='catalog'&&!edit&&configs[0])void loadConfig(configs[0].id).catch((e:Error)=>setError(e.message));},[tab,configs[0]?.id]);
    React.useEffect(()=>{if(!qr?.attempt||qr.status!=='pending')return;const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
      const poll=async()=>{try{const next=await api('login.poll',{attempt:qr.attempt},abort.signal);if(abort.signal.aborted)return;if(next.status!=='pending'){setQr((old:any)=>({...old,status:next.status}));await refresh();await refreshBots();return;}timer=setTimeout(()=>void poll(),2000);}catch(e){if(!abort.signal.aborted)setError((e as Error).message);}};void poll();return()=>{abort.abort();clearTimeout(timer);};},[qr?.attempt]);
    React.useEffect(()=>{if(!question)return;const previous=document.activeElement as HTMLElement|null;dialogRef.current?.querySelector('textarea,button')?.focus();return()=>previous?.focus();},[!!question]);
    React.useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
    const channels=summary?.channels?.length?summary.channels:[{id:'qq',displayName:'QQ 官方',capabilities:{login:['qr','credentials']}},{id:'weixin',displayName:'微信 iLink',capabilities:{login:['qr']}}];
    const summaryBots=(summary?.bots??[]).filter((b:any)=>!b.archived);
    const displayBots=(bots??summaryBots).filter((b:any)=>!b.archived).map((b:any)=>({...b,...summaryBots.find((s:any)=>s.id===b.id)}));
    const channelName=(id:string)=>channels.find((c:any)=>c.id===id)?.displayName??id;
    const badge=(bot:any)=>h('span',{className:`badge${bot.status==='error'?' warning':''}`},botStatus(bot.status));
    const identity=(bot:any)=>h('div',{className:'identity'},h('span',{className:'avatar','aria-hidden':true},bot.channel==='qq'?'Q':'W'),h('div',null,h('strong',null,bot.name),h('p',{className:'muted'},channelName(bot.channel))));
    const login=async(bot:any)=>{const next=await mutate('login.begin',{id:bot.id},'请扫码授权');setQr({...next,botId:bot.id});};
    const tabs=[['overview','总览'],['bots','机器人'],['catalog','人格'],['automation','自动化']];
    let body:any;
    if(tab==='overview')body=h('section',{'aria-label':'总览'},
      summary?h('div',{className:'stats-cards'},...[
        ['在线',`${summaryBots.filter((b:any)=>b.status==='connected').length} / ${summaryBots.length}`],['任务',summary.health.activeTasks],['待发',summary.counts.pendingDeliveries]
      ].map(([label,value])=>h('div',{className:'stats-card',key:label},h('small',null,label),h('strong',null,value)))):h('p',{role:'status'},'读取中…'),
      h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,'连接'),ui.button('管理',()=>navigate('bots'),{className:'quiet'})),...summaryBots.map((bot:any)=>h('div',{key:bot.id,className:'item row spread'},identity(bot),badge(bot))),summary&&!summaryBots.length?h('p',{className:'empty'},'暂无机器人，点击管理开始创建'):null),
      h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,'用量'),ui.button(stats?'收起':'统计',()=>setStats(!stats),{'aria-expanded':stats,'aria-controls':'bot-statistics',className:'quiet'})),h('div',{id:'bot-statistics'},h(StatisticsPanel,{React,api,bots:summaryBots,compact:!stats,onError:setError}))));
    if(tab==='bots')body=h('section',{'aria-label':'机器人'},
      h('div',{className:'toolbar spread'},h('small',null,`${displayBots.length} 个机器人`),ui.button(newOpen?'取消':'新建',()=>setNewOpen(!newOpen),{className:'primary','aria-expanded':newOpen})),
      newOpen?h('section',{className:'card'},h('h3',null,'新建机器人'),h('div',{className:'fields'},ui.field('ID',newBot.id,v=>setNewBot({...newBot,id:v})),ui.field('名称',newBot.name,v=>setNewBot({...newBot,name:v})),ui.select('渠道',newBot.channel,channels.map((c:any)=>({id:c.id,name:c.displayName})),v=>setNewBot({...newBot,channel:v})),ui.select('人格',newBot.configId,configs,v=>setNewBot({...newBot,configId:v}))),ui.button('创建',async()=>{if(!newBot.id.trim()||!newBot.name.trim())throw Error('请填写 ID 和名称');await mutate('bot.save',newBot,'已创建');setNewOpen(false);setNewBot({...newBot,id:'',name:''});},{className:'primary'})):null,
      ...displayBots.map((bot:any)=>h('section',{className:'card',key:bot.id},h('div',{className:'row spread'},identity(bot),badge(bot)),h('p',{className:'muted'},`人格 · ${configs.find((c:any)=>c.id===bot.configId)?.name??bot.configId}`),!bot.credentialConfigured?ui.button('授权',()=>login(bot),{className:'primary',disabled:busy||bot.enabled}):null,
        ui.details('管理',bots?h(React.Fragment,null,
          ui.toggle('运行',bot.enabled,()=>mutate(bot.enabled?'bot.stop':'bot.start',{id:bot.id},bot.enabled?'已停止':'连接已启动')),
          ui.select('人格',bot.configId,configs,v=>mutate('bot.save',{...bot,configId:v},'已切换，下一轮生效')),h('small',null,'切换人格保留会话历史'),
          ui.details(`用户 · ${list(bot.trustedUsers).length} 人`,h('p',{className:'muted'},list(bot.trustedUsers).join('，')||'暂无'),ui.button('编辑',async()=>{const value=await ask('用户 ID（逗号分隔）',list(bot.trustedUsers).join(','));if(value!==null)await mutate('bot.save',{...bot,trustedUsers:value.split(',').map(v=>v.trim()).filter(Boolean)});})),
          ui.details(`目录 · ${bot.workingDirectory?'指定目录':'默认目录'}`,ui.field('工作目录',workspaceEdits[bot.id]??bot.workingDirectory??'',v=>setWorkspaceEdits({...workspaceEdits,[bot.id]:v}),'text',{placeholder:directories.workspaceRoot}),ui.button('保存',async()=>{await mutate('bot.save',{...bot,workingDirectory:workspaceEdits[bot.id]??bot.workingDirectory??''});setWorkspaceEdits((old:any)=>{const next={...old};delete next[bot.id];return next;});})),
          h('div',{className:'actions'},ui.button('重连',()=>mutate('bot.reconnect',{id:bot.id},'已重连'),{disabled:busy||!bot.credentialConfigured}),ui.button('授权',()=>login(bot),{disabled:busy||bot.enabled}),channels.find((c:any)=>c.id===bot.channel)?.capabilities.login.includes('credentials')?ui.button('凭据',()=>setCredential({id:bot.id,accountId:bot.accountId,appSecret:''}),{disabled:busy||bot.enabled}):null),bot.enabled?h('small',null,'更换授权前请先关闭运行'):null):h('p',{role:'status'},'读取配置中…')))),
      credential?h('section',{className:'card','aria-label':'QQ 凭据'},h('h3',null,'QQ 凭据'),h('div',{className:'fields'},ui.field('AppID',credential.accountId,v=>setCredential({...credential,accountId:v})),ui.field('AppSecret',credential.appSecret,v=>setCredential({...credential,appSecret:v}),'password',{autoComplete:'new-password'})),h('div',{className:'actions'},ui.button('保存',async()=>{await mutate('bot.credentials',{id:credential.id,credential:{accountId:credential.accountId,appSecret:credential.appSecret}},'凭据已保存');setCredential(null);},{className:'primary'}),ui.button('取消',()=>setCredential(null)))):null,
      qr?h('section',{className:'card','aria-label':'扫码授权'},h('div',{className:'row spread'},h('h3',null,'扫码授权'),ui.button('关闭',()=>setQr(null))),h('p',{role:'status'},({pending:'等待扫码',confirmed:'授权成功',expired:'二维码已过期',denied:'已取消'} as any)[qr.status]),qr.status==='pending'?h('img',{src:qr.qrImage,width:240,height:240,alt:'机器人授权二维码'}):null):null);
    if(tab==='catalog'){
      const selected=edit?{...edit,tools:list(edit.tools),skills:list(edit.skills),hostTools:list(edit.hostTools),media:edit.media??{}}:null;
      const update=(patch:any)=>{setEdit({...selected,...patch});setDirty(true);setNotice('');};const existing=selected&&configs.some((c:any)=>c.id===selected.id);const personaFile=directories.personas.find((p:any)=>p.id===selected?.id);
      const newConfig=async()=>{if(dirty&&!await confirm('放弃未保存修改并新建人格？'))return;++loadSequence.current;setConfigLoading(false);setEdit({schemaVersion:2,id:'',name:'',revision:1,personaPrompt:'你是自然、具体的中文助手。',model:null,media:{},tools:['bot_media','bot_send_file','bot_remember','bot_forget_memory','bot_read_social'],skills:['image-generation','media-analysis'],allowHostTools:false,hostTools:[],imageStyle:'',archived:false});setDirty(true);setSection('basic');};
      const fileApply=async(id:string)=>{if(dirty&&!await confirm('应用文件将覆盖未保存修改，继续？'))return;const result=await mutate('config.files.apply',{id},'文件已应用，下一轮生效');setEdit(result);setDirty(false);};
      body=h('section',{'aria-label':'人格'},h('div',{className:'toolbar'},ui.select('人格',existing?selected.id:'',[...(!existing?[{id:'',name:selected?'新建人格':'请选择'}]:[]),...configs],loadConfig,{disabled:busy||configLoading}),ui.button('新建',newConfig),ui.button('导入',async()=>{const id=await ask('人格 ID');if(id)await fileApply(id);})),configLoading?h('p',{role:'status'},'加载中…'):null,
        selected?h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,selected.name||'新建人格'),h('small',null,`${dirty?'未保存':'已保存'} · 关联 ${summaryBots.filter((b:any)=>b.configId===selected.id).length} 个机器人`)),
          h('nav',{className:'subnav','aria-label':'人格分区'},...([['basic','基础'],['media','媒体'],['tools','工具'],['files','文件']]).map(([id,label])=>ui.button(label,()=>setSection(id),{key:id,className:section===id?'selected':'','aria-current':section===id?'page':undefined,disabled:busy||configLoading}))),
          h('fieldset',{disabled:configLoading||busy,style:{border:0,padding:0,margin:0,minWidth:0}},
            section==='basic'?h('div',null,h('div',{className:'fields'},!existing?ui.field('ID',selected.id,v=>update({id:v})):null,ui.field('名称',selected.name,v=>update({name:v})),ui.textarea('人设',selected.personaPrompt,v=>update({personaPrompt:v})),ui.select('提供商',selected.model?.provider??'',[{id:'',name:'请选择'},...models],v=>update({model:v?{provider:v,model:''}:null})),ui.select('模型',selected.model?.model??'',[{id:'',name:'请选择'},...(models.find((p:any)=>p.id===selected.model?.provider)?.models??[])],v=>update({model:{...selected.model,model:v}}))),ui.details('高级',ui.field('推理强度',selected.model?.reasoningEffort??'',v=>update({model:selected.model?{...selected.model,reasoningEffort:v||undefined}:null}),'text',{disabled:!selected.model}),h('small',null,`ID · ${selected.id||'新建'}`))):null,
            section==='tools'?h('div',{className:'stack'},ui.field('工具',selected.tools.join(', '),v=>update({tools:v.split(',').map(x=>x.trim()).filter(Boolean)})),ui.field('技能',selected.skills.join(', '),v=>update({skills:v.split(',').map(x=>x.trim()).filter(Boolean)})),ui.toggle('主机权限',selected.allowHostTools,()=>update({allowHostTools:!selected.allowHostTools})),selected.allowHostTools?ui.field('主机工具',selected.hostTools.join(', '),v=>update({hostTools:v.split(',').map(x=>x.trim()).filter(Boolean)})):null):null,
            section==='media'?h('div',null,...['image','asr','video'].map(role=>{
              const options=selected.media[role]??{};const status=role==='image'?imageSkills[selected.id]:mediaSkills[selected.id]?.[role];const label=({image:'图片',asr:'语音',video:'视频'} as any)[role];const enabled=options.enabled!==false;const set=(patch:any)=>update({media:{...selected.media,[role]:{...options,...patch}}});const provider=options.provider??selected.model?.provider;
              return h('section',{key:role,className:'item'},ui.toggle(label,enabled,()=>set({enabled:!enabled})),h('p',{className:'muted'},!enabled?'已关闭':!status?'状态未加载':status.keyConfigured?'已就绪':'待配置'),enabled?ui.details('配置',...(role==='image'?[
                ui.textarea('图片风格',selected.imageStyle,v=>update({imageStyle:v})),h('small',null,status?.overridden?'使用人格配置':'继承环境配置'),...([['baseUrl','地址'],['model','模型'],['keyEnv','密钥变量']] as const).map(([key,name])=>ui.field(name,options[key]??'',v=>set({[key]:v||undefined})))
              ]:[ui.select('提供商',options.provider??'',[{id:'',name:'跟随主模型'},...models],v=>set({provider:v||undefined,model:undefined})),ui.select('模型',options.model??'',[{id:'',name:'跟随主模型'},...(models.find((p:any)=>p.id===provider)?.models??[])],v=>set({model:v||undefined})),role==='asr'?ui.select('协议',options.protocol??'chat_completions',[{id:'chat_completions',name:'聊天'},{id:'transcriptions',name:'转写'}],v=>set({protocol:v})):null]),status?.error&&!['IMAGE_SKILL_DISABLED','MEDIA_ANALYSIS_DISABLED'].includes(status.error)?h('p',{className:'error',role:'alert'},status.error):null,ui.button('恢复默认',()=>{const media={...selected.media};delete media[role];update({media});})):null);
            })):null,
            section==='files'?h('div',{className:'stack'},h('div',{className:'row spread'},h('strong',null,'配置文件'),h('span',{className:'badge'},personaFile?.state==='error'?'未同步':personaFile?.state==='draft'?'有草稿':'已同步')),h('small',null,'config.json · persona.md'),existing?h('div',{className:'actions'},ui.button('目录',()=>mutate('config.directory.open',{configId:selected.id},'已打开目录')),ui.button('应用文件',()=>fileApply(selected.id))):h('p',{className:'muted'},'保存人格后可管理文件'),personaFile?.error?h('p',{className:'error',role:'alert'},personaFile.error):null,ui.details('路径与标识',h('small',{className:'path'},personaFile?.directory??'保存后生成'),h('small',null,`ID · ${selected.id}`))):null),
          h('div',{className:'save-bar'},h('small',null,'保存后下一轮生效'),ui.button('保存',async()=>{if(!selected.id.trim()||!selected.name.trim())throw Error('请填写 ID 和名称');const next=await mutate('config.save',{config:selected,expectedRevision:selected.revision},'已保存，下一轮生效');setEdit(next);setDirty(false);},{className:'primary',disabled:busy||configLoading||!dirty}))):!configLoading?h('p',{className:'empty'},'选择或新建一个人格'):null);
    }
    if(tab==='automation')body=null;
    const errors=[summaryError,error].filter(Boolean);
    return h('main',{className:'bot-admin'},h('style',null,panelStyles),h('header',{className:'row spread'},h('div',null,h('h2',null,'机器人'),h('small',null,'QQ · 微信'))),h('nav',{className:'main-nav','aria-label':'面板导航'},...tabs.map(([id,label])=>ui.button(label,()=>navigate(id),{key:id,'aria-current':tab===id?'page':undefined,disabled:busy}))),errors.length?h('div',{className:'error',role:'alert'},[...new Set(errors)].join('\n')):null,notice?h('div',{className:'notice',role:'status'},notice):null,body,
      automationVisited?h('div',{hidden:tab!=='automation'},h(AutomationPanel,{React,query,mutate,configs,bots:summaryBots,confirm,onError:setError,busy,active:tab==='automation'})):null,
      question?h('div',{className:'dialog-backdrop'},h('form',{ref:dialogRef,className:'card dialog',role:'dialog','aria-modal':true,'aria-label':question.title,onSubmit:(event:any)=>{event.preventDefault();answer(question.confirm?true:question.value);},onKeyDown:(event:any)=>{if(event.key==='Escape'){event.preventDefault();answer(question.confirm?false:null);}if(event.key==='Tab'){const nodes=Array.from(dialogRef.current?.querySelectorAll('textarea,button:not(:disabled)')??[]) as HTMLElement[];const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}},h('h3',null,question.title),question.confirm?null:ui.textarea('内容',question.value,v=>setQuestion({...question,value:v})),h('div',{className:'actions'},h('button',{type:'submit',className:'primary'},'确认'),ui.button('取消',()=>answer(question.confirm?false:null),{disabled:false})))):null);
  }
  return {inject:['slots'],apply(ctx:any){ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'bot-integration',order:35,label:'机器人面板'},App));}};
}});
