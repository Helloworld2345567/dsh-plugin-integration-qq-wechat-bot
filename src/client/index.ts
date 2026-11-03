import {StatisticsPanel} from './statistics.js';
import {AutomationPanel} from './automation.js';
import {AdminClient} from './admin-client.js';
import {panelStyles} from './styles.js';
import {botStatus,createUI,list} from './ui.js';
import {singingCard} from './singing.js';
import {musicCard} from './music.js';
import {loadServiceProfiles,useVoiceModel,voiceModelPicker,voiceLibraryPanel,type VoiceModelRole} from './voice-models.js';
import {currentProfileAcceptance,currentProfileHealth,currentProfileValidation} from './profile-status.js';

/* Use the Harness module loader's React instance. */
declare const window:Window & {__ModuleLoader__:any;__BOT_INTEGRATION__?:{endpoint:string;token:string}};
window.__ModuleLoader__.load({id:'dsh-plugin-integration-qq-wechat-bot',factory(require:(id:string)=>any){
  const React=require('react');const h=React.createElement;
  async function api(action:string,input:any={},signal?:AbortSignal){
    const boot=window.__BOT_INTEGRATION__;if(!boot)throw Error('机器人服务尚未就绪，请刷新页面');
    const strictCommand=action==='capability.acceptance'||action==='service.refresh'||action==='service.settings.save';
    const response=await fetch(boot.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${boot.token}`},body:JSON.stringify(strictCommand?{version:1,kind:'command',name:action,input}:{action,input}),signal});
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
    const [serviceProfiles,setServiceProfiles]=React.useState([]);const [profileHealth,setProfileHealth]=React.useState({});const [profileAcceptance,setProfileAcceptance]=React.useState({});
    const [voiceLibrary,setVoiceLibrary]=React.useState(null);const [voiceLibraryDraft,setVoiceLibraryDraft]=React.useState(null);
    const clientRef=React.useRef(null);const loadSequence=React.useRef(0);const dialogRef=React.useRef(null);const mutationRef=React.useRef(false);
    const ui=createUI(React,busy,setError);
    const client=()=>{if(!clientRef.current){const boot=window.__BOT_INTEGRATION__;if(!boot)throw Error('机器人服务尚未就绪，请刷新页面');clientRef.current=new AdminClient(boot);}return clientRef.current as AdminClient;};
    const query=async(name:string,input:any={},signal?:AbortSignal)=>client().query(name,input,signal);
    const refresh=async()=>{const next=await query('overview.summary');if(next){setSummary(next);setSummaryError('');}};
    const refreshProfiles=async(signal?:AbortSignal)=>{const next=await loadServiceProfiles(query,signal);if(!signal?.aborted)setServiceProfiles(next);};
    const refreshLibrary=async(signal?:AbortSignal)=>{const next:any=await query('service.settings',{},signal);if(next&&!signal?.aborted){setVoiceLibrary(next);setVoiceLibraryDraft({modelsRoot:next.modelsRoot,gptSovitsUrl:next.gptSovitsUrl});}};
    const refreshBots=async()=>{client().invalidate('bots.list');const next=await query('bots.list');if(next)setBots(next);};
    const refreshImageStatus=async(signal?:AbortSignal)=>{const next=await api('skill.image.status',{},signal);if(!signal?.aborted)setImageSkills(next);};
    const refreshVoiceStatus=async(signal?:AbortSignal)=>{const next=await api('skill.voice.status',{},signal);if(!signal?.aborted)setMediaSkills((old:any)=>Object.fromEntries(Object.entries(next).map(([id,status])=>[id,{...(old[id]??{}),voice:status}])));};
    const refreshSingingStatus=async(signal?:AbortSignal)=>{const next=await api('skill.singing.status',{},signal);if(!signal?.aborted)setMediaSkills((old:any)=>({...old,...Object.fromEntries(Object.entries(next).map(([id,status])=>[id,{...(old[id]??{}),singing:status}]))}));};
    const refreshMusicStatus=async(signal?:AbortSignal)=>{const next=await api('skill.music.status',{},signal);if(!signal?.aborted)setMediaSkills((old:any)=>({...old,...Object.fromEntries(Object.entries(next).map(([id,status])=>[id,{...(old[id]??{}),music:status}]))}));};
    const mutate=async(action:string,input:any={},message='已保存')=>{
      if(mutationRef.current)throw Error('操作进行中，请稍候');mutationRef.current=true;setBusy(true);setError('');setNotice('');
      try{
        const result=await api(action,input);
        if(action.startsWith('config.'))client().invalidate('catalog.config',{id:input.id??input.config?.id});
        if(action.startsWith('automation.'))client().invalidate('automation.list');
        setNotice(message);
        // Refresh failures must not turn a successful write into an apparent failed save.
        try{await refresh();if(action.startsWith('bot.'))await refreshBots();if(action.startsWith('config.')||action==='capability.record'||action==='skill.singing.probe'||action==='skill.music.probe')await Promise.all([...(action.startsWith('config.')?[refreshImageStatus()]:[]),refreshVoiceStatus(),refreshSingingStatus(),refreshMusicStatus()]);}catch{setError('操作已完成，状态刷新失败，请稍后重新打开页面');}
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
    React.useEffect(()=>{if(tab!=='catalog')return;const abort=new AbortController();for(const [action,set] of [['directories',setDirectories],['skill.image.status',setImageSkills],['skill.media.status',setMediaSkills]] as const){void api(action,{},abort.signal).then((next:any)=>{if(abort.signal.aborted)return;if(action==='skill.media.status')setMediaSkills((old:any)=>Object.fromEntries(Object.entries(next).map(([id,status])=>[id,{...(old[id]??{}),...(status as any)}])));else set(next);}).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});}
      void query('catalog.models',{},abort.signal).then((next:any)=>{if(!next||abort.signal.aborted)return;const groups=new Map();for(const model of next.data??next){const rows=groups.get(model.provider)??[];rows.push({id:model.model,name:model.model,inputModalities:model.inputModalities,reasoning:model.reasoning});groups.set(model.provider,rows);}setModels([...groups].map(([id,models])=>({id,models})));}).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});
      void refreshProfiles(abort.signal).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});
      void refreshVoiceStatus(abort.signal).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});
      void refreshSingingStatus(abort.signal).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});
      void refreshMusicStatus(abort.signal).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});
      return()=>abort.abort();},[tab]);
    React.useEffect(()=>{if(tab!=='services')return;const abort=new AbortController();void refreshLibrary(abort.signal).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[tab]);
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
    const tabs=[['overview','总览'],['bots','机器人'],['catalog','人格'],['services','模型服务'],['automation','自动化']];
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
      ...displayBots.map((bot:any)=>h('section',{className:'card',key:bot.id},h('div',{className:'row spread'},identity(bot),h('div',{className:'row'},badge(bot),ui.button('删除',async()=>{
        if(!await confirm(`删除机器人“${bot.name}”（ID：${bot.id}）？将停止任务、清除授权，并永久删除该机器人的全部聊天记录、记忆、附件和自动化记录。此操作无法撤销。`))return;
        setQr((current:any)=>current?.botId===bot.id?null:current);setCredential((current:any)=>current?.id===bot.id?null:current);
        await mutate('bot.delete',{id:bot.id},'机器人已删除');setWorkspaceEdits((current:any)=>{const next={...current};delete next[bot.id];return next;});
      },{className:'quiet danger','aria-label':`删除机器人 ${bot.name}（${bot.id}）`}))),h('p',{className:'muted'},`人格 · ${configs.find((c:any)=>c.id===bot.configId)?.name??bot.configId}`),!bot.credentialConfigured?ui.button('授权',()=>login(bot),{className:'primary',disabled:busy||bot.enabled}):null,
        ui.details('管理',bots?h(React.Fragment,null,
          ui.toggle('运行',bot.enabled,()=>mutate(bot.enabled?'bot.stop':'bot.start',{id:bot.id},bot.enabled?'已停止':'连接已启动')),
          ui.select('人格',bot.configId,configs,v=>mutate('bot.save',{...bot,configId:v},'已切换，下一轮生效')),h('small',null,'切换人格保留会话历史'),
          ui.details(`用户 · ${list(bot.trustedUsers).length} 人`,h('p',{className:'muted'},list(bot.trustedUsers).join('，')||'暂无'),ui.button('编辑',async()=>{const value=await ask('用户 ID（逗号分隔）',list(bot.trustedUsers).join(','));if(value!==null)await mutate('bot.save',{...bot,trustedUsers:value.split(',').map(v=>v.trim()).filter(Boolean)});})),
          ui.details(`目录 · ${bot.workingDirectory?'指定目录':'默认目录'}`,ui.field('工作目录',workspaceEdits[bot.id]??bot.workingDirectory??'',v=>setWorkspaceEdits({...workspaceEdits,[bot.id]:v}),'text',{placeholder:directories.workspaceRoot}),ui.button('保存',async()=>{await mutate('bot.save',{...bot,workingDirectory:workspaceEdits[bot.id]??bot.workingDirectory??''});setWorkspaceEdits((old:any)=>{const next={...old};delete next[bot.id];return next;});})),
          h('div',{className:'actions'},ui.button('重连',()=>mutate('bot.reconnect',{id:bot.id},'已重连'),{disabled:busy||!bot.credentialConfigured}),ui.button('授权',()=>login(bot),{disabled:busy||bot.enabled}),channels.find((c:any)=>c.id===bot.channel)?.capabilities.login.includes('credentials')?ui.button('凭据',()=>setCredential({id:bot.id,accountId:bot.accountId,appSecret:''}),{disabled:busy||bot.enabled}):null),bot.enabled?h('small',null,'更换授权前请先关闭运行'):null):h('p',{role:'status'},'读取配置中…')))),
      credential?h('section',{className:'card','aria-label':'QQ 凭据'},h('h3',null,'QQ 凭据'),h('div',{className:'fields'},ui.field('AppID',credential.accountId,v=>setCredential({...credential,accountId:v})),ui.field('AppSecret',credential.appSecret,v=>setCredential({...credential,appSecret:v}),'password',{autoComplete:'new-password'})),h('div',{className:'actions'},ui.button('保存',async()=>{await mutate('bot.credentials',{id:credential.id,credential:{accountId:credential.accountId,appSecret:credential.appSecret}},'凭据已保存');setCredential(null);},{className:'primary'}),ui.button('取消',()=>setCredential(null)))):null,
      qr?h('section',{className:'card','aria-label':'扫码授权'},h('div',{className:'row spread'},h('h3',null,'扫码授权'),ui.button('关闭',()=>setQr(null))),h('p',{role:'status'},({pending:'等待扫码',confirmed:'授权成功',expired:'二维码已过期',denied:'已取消'} as any)[qr.status]),qr.status==='pending'?h('img',{src:qr.qrImage,width:240,height:240,alt:'机器人授权二维码'}):null):null);
    if(tab==='services')body=voiceLibraryPanel(h,ui,{value:voiceLibrary,draft:voiceLibraryDraft,busy,update:setVoiceLibraryDraft,save:async()=>{if(!voiceLibraryDraft||!voiceLibrary)throw Error('模型服务设置尚未加载');await mutate('service.settings.save',{...voiceLibraryDraft,expectedRevision:voiceLibrary.revision},'模型服务设置已保存');await refreshLibrary();await refreshProfiles();setProfileHealth({});setProfileAcceptance({});},refresh:async()=>{await mutate('service.refresh',{serviceId:'rvc'},'模型目录已刷新');await refreshLibrary();await refreshProfiles();setProfileHealth({});setProfileAcceptance({});}});
    if(tab==='catalog'){
      const selected=edit?{...edit,tools:list(edit.tools),skills:list(edit.skills),hostTools:list(edit.hostTools),media:edit.media??{}}:null;
      const profileKey=(ref:any)=>ref?`${ref.serviceId}/${ref.profileId}`:'';
      const visibleHealth=Object.fromEntries(serviceProfiles.map((profile:any)=>[profileKey(profile),currentProfileHealth(profileHealth[profileKey(profile)],profile)]));
      const visibleAcceptance=Object.fromEntries(serviceProfiles.flatMap((profile:any)=>Object.entries({voice:'gpt-sovits.speak',singing:'rvc.convert',music:'music.acquire'}).map(([role,operation])=>{const key=`${role}:${profileKey(profile)}`;return[key,selected?currentProfileAcceptance(profileAcceptance[key],selected,profile,operation):undefined];})));
      const musicStatus=selected?mediaSkills[selected.id]?.music:undefined,musicProfile=serviceProfiles.find((profile:any)=>profileKey(profile)===profileKey(selected?.media.music?.profileRef));
      const visibleMusicStatus=selected&&musicStatus?{...musicStatus,downloadValidation:currentProfileValidation(musicStatus,selected,musicProfile,'downloadValidation')}:undefined;
      const inspectProfile=async(role:string,ref:any,operation:string)=>{if(!ref||!selected)return;const key=profileKey(ref);const result:any=await query('service.health',ref);setProfileHealth((old:any)=>({...old,[key]:result?.data??result}));const profile=serviceProfiles.find((item:any)=>item.serviceId===ref.serviceId&&item.profileId===ref.profileId);if(profile){const acceptance:any=await query('capability.acceptance',{personaId:selected.id,personaRevision:selected.revision,serviceId:profile.serviceId,profileId:profile.profileId,profileRevision:profile.revision,profileContentHash:profile.contentHash,operation});setProfileAcceptance((old:any)=>({...old,[`${role}:${key}`]:acceptance?.data??acceptance}));}};
      const recordProfileAcceptance=async(role:string,ref:any,operation:string,state:'PASS'|'FAIL',evidence:string)=>{const profile=serviceProfiles.find((item:any)=>item.serviceId===ref?.serviceId&&item.profileId===ref?.profileId);if(!selected||!profile)throw Error('请先选择已登记 Profile');const result:any=await mutate('capability.acceptance',{personaId:selected.id,personaRevision:selected.revision,serviceId:profile.serviceId,profileId:profile.profileId,profileRevision:profile.revision,profileContentHash:profile.contentHash,operation,state,evidenceType:'operator-review',evidence},'已记录当前人格与 Profile revision 的验收结果');setProfileAcceptance((old:any)=>({...old,[`${role}:${profile.serviceId}/${profile.profileId}`]:result?.data??result}));};
      const update=(patch:any)=>{setEdit({...selected,...patch});setDirty(true);setNotice('');};const existing=selected&&configs.some((c:any)=>c.id===selected.id);const personaFile=directories.personas.find((p:any)=>p.id===selected?.id);
      const applyVoiceModel=async(role:VoiceModelRole,profile:any)=>{if(!selected||dirty||!existing)throw Error('先保存或取消当前人格修改，再使用音色');const saved=await mutate('config.save',{config:useVoiceModel(selected,role,profile),expectedRevision:selected.revision},'音色已应用，下一轮生效');setEdit(saved);setDirty(false);};
      const newConfig=async()=>{if(dirty&&!await confirm('放弃未保存修改并新建人格？'))return;++loadSequence.current;setConfigLoading(false);setEdit({schemaVersion:4,id:'',name:'',revision:1,personaPrompt:'你是自然、具体的中文助手。',model:null,media:{voice:{enabled:false,protocol:'edge_tts',replyMode:'on_demand',format:'mp3',voice:'zh-CN-XiaoxiaoNeural'}},tools:['bot_media','bot_voice','bot_send_file','bot_remember','bot_forget_memory','bot_read_social'],skills:['image-generation','media-analysis','voice-generation'],allowHostTools:false,hostTools:[],imageStyle:'',archived:false});setDirty(true);setSection('basic');};
      const fileApply=async(id:string)=>{if(dirty&&!await confirm('应用文件将覆盖未保存修改，继续？'))return;const result=await mutate('config.files.apply',{id},'文件已应用，下一轮生效');setEdit(result);setDirty(false);};
      body=h('section',{'aria-label':'人格'},h('div',{className:'toolbar'},ui.select('人格',existing?selected.id:'',[...(!existing?[{id:'',name:selected?'新建人格':'请选择'}]:[]),...configs],loadConfig,{disabled:busy||configLoading}),ui.button('新建',newConfig),ui.button('导入',async()=>{const id=await ask('人格 ID');if(id)await fileApply(id);})),configLoading?h('p',{role:'status'},'加载中…'):null,
        selected?h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,selected.name||'新建人格'),h('small',null,`${dirty?'未保存':'已保存'} · 关联 ${summaryBots.filter((b:any)=>b.configId===selected.id).length} 个机器人`)),
          h('nav',{className:'subnav','aria-label':'人格分区'},...([['basic','基础'],['media','媒体'],['tools','工具'],['files','文件']]).map(([id,label])=>ui.button(label,()=>setSection(id),{key:id,className:section===id?'selected':'','aria-current':section===id?'page':undefined,disabled:busy||configLoading}))),
          h('fieldset',{disabled:configLoading||busy,style:{border:0,padding:0,margin:0,minWidth:0}},
            section==='basic'?h('div',null,h('div',{className:'fields'},!existing?ui.field('ID',selected.id,v=>update({id:v})):null,ui.field('名称',selected.name,v=>update({name:v})),ui.textarea('人设',selected.personaPrompt,v=>update({personaPrompt:v})),ui.select('提供商',selected.model?.provider??'',[{id:'',name:'请选择'},...models],v=>update({model:v?{provider:v,model:''}:null})),ui.select('模型',selected.model?.model??'',[{id:'',name:'请选择'},...(models.find((p:any)=>p.id===selected.model?.provider)?.models??[])],v=>update({model:{...selected.model,model:v}}))),ui.details('高级',ui.field('推理强度',selected.model?.reasoningEffort??'',v=>update({model:selected.model?{...selected.model,reasoningEffort:v||undefined}:null}),'text',{disabled:!selected.model}),h('small',null,`ID · ${selected.id||'新建'}`))):null,
            section==='tools'?h('div',{className:'stack'},ui.field('工具',selected.tools.join(', '),v=>update({tools:v.split(',').map(x=>x.trim()).filter(Boolean)})),ui.field('技能',selected.skills.join(', '),v=>update({skills:v.split(',').map(x=>x.trim()).filter(Boolean)})),ui.toggle('主机权限',selected.allowHostTools,()=>update({allowHostTools:!selected.allowHostTools})),selected.allowHostTools?ui.field('主机工具',selected.hostTools.join(', '),v=>update({hostTools:v.split(',').map(x=>x.trim()).filter(Boolean)})):null):null,
            section==='media'?h('div',null,...(['voice','singing'] as const).map(role=>voiceModelPicker(h,ui,{role,config:selected,profiles:serviceProfiles,health:profileHealth,busy,dirty,existing:!!existing,apply:applyVoiceModel,inspect:inspectProfile,openLibrary:()=>navigate('services')})),...['image','asr','video','voice'].map(role=>{
              const options=selected.media[role]??{};const status=role==='image'?imageSkills[selected.id]:mediaSkills[selected.id]?.[role];const label=({image:'图片',asr:'语音识别',video:'视频',voice:'语音输出'} as any)[role];const enabled=role==='voice'?options.enabled===true:options.enabled!==false;const set=(patch:any)=>update({media:{...selected.media,[role]:{...options,...patch}}});const provider=options.provider??selected.model?.provider;const ready=status?.keyConfigured||status?.configured;
              const voiceKey=profileKey(options.profileRef),voiceProfile=serviceProfiles.find((profile:any)=>profileKey(profile)===voiceKey),voiceHealth=visibleHealth[voiceKey],voiceAcceptance=visibleAcceptance[`voice:${voiceKey}`]??currentProfileValidation(status,selected,voiceProfile,'synthesisValidation');
              const voiceStatus=dirty?'未保存，保存后检查配置':options.protocol==='edge_tts'?'内置 Edge TTS':`${voiceProfile?.displayName??'未选择 Profile'} · ${status?.state??'missing'} · health ${voiceHealth?.state??'未检查'} · acceptance ${voiceAcceptance?.state??voiceAcceptance?.status??'NOT_RUN'}`;
              return h('section',{key:role,className:'item'},ui.toggle(label,enabled,()=>set({enabled:!enabled})),h('p',{className:'muted'},!enabled?'已关闭':role==='voice'?voiceStatus:role==='image'&&dirty?'未保存，保存后检查配置':!status?'状态未加载':ready?'已就绪':'待配置'),enabled?ui.details('配置',...(role==='image'?[
                ui.field('服务地址',options.baseUrl??'',v=>set({baseUrl:v.trim()||undefined}),'url',{placeholder:'留空使用环境默认地址'}),
                ui.field('密钥环境变量名',options.keyEnv??'',v=>set({keyEnv:v.trim()||undefined}),'text',{placeholder:'留空使用环境默认变量',autoComplete:'off',spellCheck:false}),
                ui.textarea('图片风格',selected.imageStyle,v=>update({imageStyle:v})),h('small',null,'密钥值从后台环境变量读取；此处只填写变量名。连接设置留空时使用环境默认配置。')
              ]:role==='voice'?[
                ui.select('语音类型',options.protocol==='edge_tts'?'edge_tts':'profile',[{id:'edge_tts',name:'内置 Edge TTS'},{id:'profile',name:'服务 Profile'}],v=>v==='edge_tts'?set({protocol:'edge_tts',profileRef:undefined,format:'mp3',voice:'zh-CN-XiaoxiaoNeural'}):set({protocol:undefined,profileRef:options.profileRef,format:'wav',voice:undefined})),
                ui.select('语音回复策略',options.replyMode??'on_demand',[{id:'on_demand',name:'按需语音'},{id:'auto',name:'文字加自动语音'}],v=>set({replyMode:v})),
                ...(options.protocol==='edge_tts'?[ui.select('本机音色',options.voice??'zh-CN-XiaoxiaoNeural',[{id:'zh-CN-XiaoxiaoNeural',name:'中文女声 · 晓晓'},{id:'zh-CN-YunxiNeural',name:'中文男声 · 云希'},{id:'en-US-AriaNeural',name:'英语女声 · Aria'},{id:'ja-JP-NanamiNeural',name:'日语女声 · Nanami'}],v=>set({voice:v||undefined}))]:[
                  h('small',null,'在上方说话音色列表点击“使用”即可保存选择。'),
                  h('small',null,'仅显示已登记 Profile 的名称、模型标签和状态；missing/blocked/disabled/revoked 不会自动回退。'),
                  h('div',{className:'actions'},ui.button('检查 health',()=>inspectProfile('voice',options.profileRef,'gpt-sovits.speak'),{disabled:dirty||!options.profileRef}),ui.button('登记验收',async()=>{const evidence=await ask('填写真实合成与试听依据');if(evidence?.trim())await recordProfileAcceptance('voice',options.profileRef,'gpt-sovits.speak','PASS',evidence.trim());},{disabled:dirty||!options.profileRef}))
                ]),h('small',null,'自动语音保留文字；health 只表示当前可探测，真实合成验收单独绑定人格与 Profile revision。')
              ]:[ui.select('提供商',options.provider??'',[{id:'',name:'跟随主模型'},...models],v=>set({provider:v||undefined,model:undefined})),ui.select('模型',options.model??'',[{id:'',name:'跟随主模型'},...(models.find((p:any)=>p.id===provider)?.models??[])],v=>set({model:v||undefined})),role==='asr'?ui.select('协议',options.protocol??'chat_completions',[{id:'chat_completions',name:'聊天'},{id:'transcriptions',name:'转写'}],v=>set({protocol:v})):null]),status?.error&&!['IMAGE_SKILL_DISABLED','MEDIA_ANALYSIS_DISABLED','VOICE_DISABLED','VOICE_OUTPUT_DISABLED'].includes(status.error)?h('p',{className:'error',role:'alert'},status.error):null,ui.button('恢复默认',()=>{const media={...selected.media};delete media[role];update({media});})):null);
            }),musicCard(h,ui,selected,dirty,visibleMusicStatus,serviceProfiles,visibleHealth,visibleAcceptance,update,mutate,ask,inspectProfile,recordProfileAcceptance),singingCard(h,ui,selected,dirty,mediaSkills[selected.id]?.singing,serviceProfiles,visibleHealth,visibleAcceptance,update,mutate,ask,inspectProfile,recordProfileAcceptance)):null,
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
