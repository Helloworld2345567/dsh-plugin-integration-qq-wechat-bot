import {StatisticsPanel} from './statistics.js';
import {AutomationPanel} from './automation.js';
import {AdminClient} from './admin-client.js';
import {panelStyles} from './styles.js';
import {botStatus,createUI,list} from './ui.js';
import {botSettingsSections} from './bot-settings-panel.js';
import {loadServiceProfiles} from './voice-models.js';
import {LOCALE_NS,chinese,zh,en,message,renderText,errorText,uiError,PanelError,displayLocale,diagnosticText,reportDiagnostics,type DisplayText,type Translate} from './locale.js';
import {panelHeader,panelSidebar,statusPill} from './layout.js';
import {BotsPanel,type BotEditorSection} from './bots-panel.js';
import {ServicesPanel} from './services-panel.js';
import {loadPanelServiceHealth,modelLibraryLabel,serviceHealthLabel} from './service-health.js';
import {personaPanel,type PersonaEditorSection} from './persona-panel.js';
import {installHostLeaveGuard} from './host-leave-guard.js';

/* Use the Harness module loader's React instance. */
declare const window:Window & {__ModuleLoader__:any;__BOT_INTEGRATION__?:{endpoint:string;token:string}};
window.__ModuleLoader__.load({id:'dsh-plugin-integration-qq-wechat-bot',factory(require:(id:string)=>any){
  const React=require('react');const h=React.createElement;let t:Translate=chinese;let locale:any;let settingsForm:any;
  const serviceDraft=(settings:any)=>({modelsRoot:settings.modelsRoot,gptSovitsUrl:settings.gptSovitsUrl,breezeTtsUrl:settings.breezeTtsUrl??'http://127.0.0.1:8080',gptSovitsProjectRoot:settings.gptSovitsProjectRoot??'',breezeTtsProjectRoot:settings.breezeTtsProjectRoot??'',breezeTtsVoicesRoot:settings.breezeTtsVoicesRoot??''});
  async function api(action:string,input:any={},signal?:AbortSignal){
    const boot=window.__BOT_INTEGRATION__;if(!boot)throw uiError('serviceNotReady',t);
    const strictCommand=action==='service.refresh'||action==='service.start'||action==='service.settings.save'||action==='service.settings.pick-directory'||action==='bot.service.start'||action==='bot.service.stop';
    const response=await fetch(boot.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${boot.token}`},body:JSON.stringify(strictCommand?{version:1,kind:'command',name:action,input}:{action,input}),signal});
    const body=await response.json();if(!response.ok)throw new PanelError(body.error||t('operationFailed'),body.message,body.issues);return body.result;
  }
  function App(){
    const localeSnapshot=React.useSyncExternalStore?.(locale.subscribe.bind(locale),locale.getSnapshot.bind(locale))??locale.getSnapshot?.();
    const activeLocale=displayLocale(localeSnapshot?.active);
    const settingsSnapshot=React.useSyncExternalStore?.(settingsForm?.subscribe.bind(settingsForm)??(()=>()=>{}),settingsForm?.getSnapshot.bind(settingsForm)??(()=>undefined))??settingsForm?.getSnapshot();
    const text=(value:DisplayText|undefined)=>renderText(value,t,activeLocale);
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
    const [serviceProfiles,setServiceProfiles]=React.useState([]);
    const [voiceLibrary,setVoiceLibrary]=React.useState(null);const [voiceLibraryDraft,setVoiceLibraryDraft]=React.useState(null);const [serviceHealth,setServiceHealth]=React.useState({} as Record<string,any>);
    const [selectedBotId,setSelectedBotId]=React.useState('');
    const [botSection,setBotSection]=React.useState('run' as BotEditorSection);
    const [botDraft,setBotDraft]=React.useState(null as {id:string;settings:any}|null);
    const [languageSaving,setLanguageSaving]=React.useState(false);
    const clientRef=React.useRef(null);const loadSequence=React.useRef(0);const dialogRef=React.useRef(null);const mutationRef=React.useRef(false);const sessionRevisionRef=React.useRef('');const sessionsRef=React.useRef([] as any[]);
    const panelRef=React.useRef(null);const leaveGuardRef=React.useRef(null);
    const ui=createUI(React,busy,setError);
    const client=()=>{if(!clientRef.current){const boot=window.__BOT_INTEGRATION__;if(!boot)throw uiError('serviceNotReady',t);clientRef.current=new AdminClient(boot);}return clientRef.current as AdminClient;};
    const query=async(name:string,input:any={},signal?:AbortSignal)=>client().query(name,input,signal);
    const refresh=async()=>{const next:any=await query('overview.summary');if(next){let merged={...next,sessions:next.sessions??sessionsRef.current};if(next.sessionRevision&&next.sessionRevision!==sessionRevisionRef.current){sessionRevisionRef.current=next.sessionRevision;try{const page:any=await query('overview.sessions',{limit:100});sessionsRef.current=page?.items??[];merged={...next,sessions:sessionsRef.current};}catch{/* session details are optional; summary remains usable */}}setSummary(merged);setSummaryError('');}};
    const refreshProfiles=async(signal?:AbortSignal)=>{const next=await loadServiceProfiles(query,signal,t);if(!signal?.aborted)setServiceProfiles(next);return next;};
    const refreshLibrary=async(signal?:AbortSignal)=>{const next:any=await query('service.settings',{},signal);if(next&&!signal?.aborted){setVoiceLibrary(next);setVoiceLibraryDraft(serviceDraft(next));}};
    const refreshServiceStatus=async(signal?:AbortSignal)=>{
      signal?.throwIfAborted();setServiceHealth({});
      const [,profiles]=await Promise.all([refreshLibrary(signal),refreshProfiles(signal)]);
      const health=await loadPanelServiceHealth(query,profiles,signal);
      if(!signal?.aborted)setServiceHealth(health);
    };
    const refreshBots=async()=>{client().invalidate('bots.list');const next=await query('bots.list');if(next)setBots(next);};
    const refreshBotMediaStatus=async(signal?:AbortSignal)=>{
      const [image,media]=await Promise.all([api('skill.image.status',{scope:'bots'},signal),api('skill.media.status',{scope:'bots'},signal)]);
      if(!signal?.aborted){setImageSkills(image);setMediaSkills(media);}
    };
    const mutate=async(action:string,input:any={},noticeMessage:DisplayText=message('saved'))=>{
      if(mutationRef.current)throw uiError('operationBusy',t);mutationRef.current=true;setBusy(true);setError('');setNotice('');
      try{
        const result=await api(action,input);
        if(action.startsWith('config.'))client().invalidate('catalog.config',{id:input.id??input.config?.id});
        if(action.startsWith('automation.'))client().invalidate('automation.list');
        setNotice(noticeMessage);
        // Refresh failures must not turn a successful write into an apparent failed save.
        try{await refresh();if(action.startsWith('bot.'))await refreshBots();if(action==='bot.save')await refreshBotMediaStatus();}catch{setError(message('refreshFailed'));}
        return result;
      }finally{mutationRef.current=false;setBusy(false);}
    };
    const ask=(title:DisplayText,value=''):Promise<string|null>=>new Promise(resolve=>setQuestion({title,value,resolve,confirm:false}));
    const confirm=(title:DisplayText):Promise<boolean>=>new Promise(resolve=>setQuestion({title,value:'',resolve,confirm:true}));
    const answer=(value:any)=>{question?.resolve(value);setQuestion(null);};
    const savedServiceDraft=voiceLibrary?serviceDraft(voiceLibrary):null;
    const serviceSettingsDirty=!!voiceLibraryDraft&&!!savedServiceDraft&&(Object.keys(savedServiceDraft) as (keyof typeof savedServiceDraft)[]).some(key=>voiceLibraryDraft[key]!==savedServiceDraft[key]);
    const hasUnsaved=dirty||!!botDraft||Object.keys(workspaceEdits).length>0||serviceSettingsDirty;
    leaveGuardRef.current={hasUnsaved,dialogOpen:!!question,confirmLeave:()=>confirm(message('unsavedChanges'))};
    const discardDrafts=()=>{++loadSequence.current;setConfigLoading(false);setEdit(null);setDirty(false);setBotDraft(null);setWorkspaceEdits({});if(savedServiceDraft)setVoiceLibraryDraft(savedServiceDraft);};
    const navigate=async(next:string)=>{
      if(next===tab)return;
      if(hasUnsaved&&!await confirm(message('unsavedChanges')))return;
      if(hasUnsaved)discardDrafts();
      ++loadSequence.current;setConfigLoading(false);setTab(next);if(next==='automation')setAutomationVisited(true);setError('');setNotice('');
    };
    const loadConfig=async(id:string)=>{
      if(dirty&&!await confirm(message('unsavedPersonaSwitch')))return;
      const sequence=++loadSequence.current;setConfigLoading(true);setError('');setNotice('');
      try{const config=await query('catalog.config',{id});if(config&&sequence===loadSequence.current){setEdit(config);setDirty(false);}}
      finally{if(sequence===loadSequence.current)setConfigLoading(false);}
    };
    React.useEffect(()=>{let stopped=false,running=false;const poll=async()=>{if(running)return;running=true;try{await refresh();}catch(e){if(!stopped)setSummaryError(errorText(e));}finally{running=false;}};
      void poll();const timer=setInterval(()=>{if(!stopped)void poll();},4000);return()=>{stopped=true;clearInterval(timer);clientRef.current?.cancel('overview.summary');};},[]);
    React.useEffect(()=>{if(tab!=='bots')return;const abort=new AbortController();void query('bots.list',{},abort.signal).then((next:any)=>{if(next&&!abort.signal.aborted)setBots(next);}).catch((e:Error)=>{if(!abort.signal.aborted)setError(errorText(e));});void api('directories',{},abort.signal).then(setDirectories).catch(()=>{});return()=>abort.abort();},[tab]);
    React.useEffect(()=>{if(!['catalog','bots','services','overview'].includes(tab))return;const abort=new AbortController();if(tab==='catalog'||tab==='bots')for(const [action,set] of [['directories',setDirectories],['skill.image.status',setImageSkills],['skill.media.status',setMediaSkills]] as const){void api(action,action.startsWith('skill.')?{scope:'bots'}:{},abort.signal).then((next:any)=>{if(abort.signal.aborted)return;if(action==='skill.media.status')setMediaSkills((old:any)=>Object.fromEntries(Object.entries(next).map(([id,status])=>[id,{...(old[id]??{}),...(status as any)}])));else set(next);}).catch((e:Error)=>{if(!abort.signal.aborted)setError(errorText(e));});}
      if(tab==='bots'){
        void query('catalog.models',{},abort.signal).then((next:any)=>{if(!next||abort.signal.aborted)return;const groups=new Map();for(const model of next.data??next){const rows=groups.get(model.provider)??[];rows.push({id:model.model,name:model.model,inputModalities:model.inputModalities,reasoning:model.reasoning});groups.set(model.provider,rows);}setModels([...groups].map(([id,models])=>({id,models})));}).catch((e:Error)=>{if(!abort.signal.aborted)setError(errorText(e));});
        void refreshProfiles(abort.signal).catch((e:Error)=>{if(!abort.signal.aborted)setError(errorText(e));});
      }
      void (tab==='overview'||tab==='services'?refreshServiceStatus(abort.signal):refreshLibrary(abort.signal)).catch((e:Error)=>{if(!abort.signal.aborted)setError(errorText(e));});
      return()=>abort.abort();},[tab]);
    const configs=(summary?.configs??[]).filter((c:any)=>!c.archived);
    React.useEffect(()=>{if(tab==='catalog'&&!edit&&configs[0])void loadConfig(configs[0].id).catch((e:Error)=>setError(errorText(e)));},[tab,configs[0]?.id]);
    React.useEffect(()=>{if(!qr?.attempt||qr.status!=='pending')return;const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
      const poll=async()=>{try{const next=await api('login.poll',{attempt:qr.attempt},abort.signal);if(abort.signal.aborted)return;if(next.status!=='pending'){setQr((old:any)=>({...old,status:next.status}));await refresh();await refreshBots();return;}timer=setTimeout(()=>void poll(),2000);}catch(e){if(!abort.signal.aborted)setError(errorText(e));}};void poll();return()=>{abort.abort();clearTimeout(timer);};},[qr?.attempt]);
    React.useEffect(()=>{if(!question)return;const previous=document.activeElement as HTMLElement|null;dialogRef.current?.querySelector('textarea,button')?.focus();return()=>previous?.focus();},[!!question]);
    React.useEffect(()=>{if(!hasUnsaved)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[hasUnsaved]);
    React.useEffect(()=>panelRef.current?installHostLeaveGuard(panelRef.current,{hasUnsaved:()=>leaveGuardRef.current.hasUnsaved,dialogOpen:()=>leaveGuardRef.current.dialogOpen,confirmLeave:()=>leaveGuardRef.current.confirmLeave(),onError:(error:unknown)=>setError(errorText(error))}):undefined,[]);
    const channels=(summary?.channels?.length?summary.channels:[{id:'qq',capabilities:{login:['qr','credentials']}},{id:'weixin',capabilities:{login:['qr']}}]).map((channel:any)=>({...channel,displayName:channel.id==='qq'?t('qqOfficial'):channel.id==='weixin'?t('weixinIlink'):channel.displayName??channel.id}));
    const summaryBots=(summary?.bots??[]).filter((b:any)=>!b.archived);
    const displayBots=(bots??summaryBots).filter((b:any)=>!b.archived).map((b:any)=>({...b,...summaryBots.find((s:any)=>s.id===b.id)}));
    const activeBot=displayBots.find((bot:any)=>bot.id===selectedBotId)??displayBots[0];
    const channelName=(id:string)=>channels.find((c:any)=>c.id===id)?.displayName??id;
    const badge=(bot:any)=>h('span',{className:`badge${bot.status==='error'?' warning':''}`},botStatus(bot.status,t));
    const identity=(bot:any)=>h('div',{className:'identity'},h('span',{className:'avatar','aria-hidden':true},bot.channel==='qq'?'Q':'W'),h('div',null,h('strong',null,bot.name),h('p',{className:'muted'},channelName(bot.channel))));
    const login=async(bot:any)=>{const next=await mutate('login.begin',{id:bot.id},message('scanToAuthorize'));setQr({...next,botId:bot.id});};
    const pickDirectory=async(current:string|undefined,locale=activeLocale)=>{const result=await api('service.settings.pick-directory',{current:current||undefined,locale});return typeof result?.path==='string'?result.path:undefined;};
    const tabs=[['overview',t('overview')],['bots',t('bots')],['services',t('services')],['catalog',t('personas')],['automation',t('automation')]];
    const overviewServices=h('section',{className:'card overview-services'},
      h('div',{className:'row spread'},h('h3',null,t('services')),ui.button(t('manage'),()=>navigate('services'),{className:'quiet'})),
      h('div',{className:'overview-service-grid'},
        h('div',{className:'overview-service-item'},h('strong',null,t('robotService')),h('span',{className:'badge'},summary?.health?.serviceRunning===true?t('online'):t('stopped'))),
        h('div',{className:'overview-service-item'},h('strong',null,'GPT-SoVITS'),h('span',{className:'badge',title:diagnosticText(serviceHealth['gpt-sovits'],activeLocale)},serviceHealthLabel(serviceHealth['gpt-sovits'],t))),
        h('div',{className:'overview-service-item'},h('strong',null,'Breeze TTS'),h('span',{className:'badge',title:diagnosticText(serviceHealth['breeze-tts'],activeLocale)},serviceHealthLabel(serviceHealth['breeze-tts'],t))),
        h('div',{className:'overview-service-item'},h('strong',null,t('stsModelDirectory')),h('span',{className:'badge',title:reportDiagnostics(voiceLibrary?.reports?.rvc,activeLocale)},modelLibraryLabel(voiceLibrary?.reports?.rvc,t))),
      ),
    );
    let body:any;
    if(tab==='overview')body=h('section',{'aria-label':t('overview')},
      summary?h('div',{className:'stats-cards'},...[
        [t('onlineCount'),`${summaryBots.filter((b:any)=>b.status==='connected').length} / ${summaryBots.length}`],[t('tasks'),summary.health.activeTasks],[t('pending'),summary.counts.pendingDeliveries]
      ].map(([label,value])=>h('div',{className:'stats-card',key:label},h('small',null,label),h('strong',null,value)))):h('p',{role:'status'},t('loading')),
      h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,t('usage')),ui.button(stats?t('collapse'):t('statistics'),()=>setStats(!stats),{'aria-expanded':stats,'aria-controls':'bot-statistics',className:'quiet'})),h('div',{id:'bot-statistics'},h(StatisticsPanel,{React,api,bots:summaryBots,t,locale:activeLocale,compact:!stats,onError:setError}))),
      h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,t('connections')),ui.button(t('manage'),()=>navigate('bots'),{className:'quiet'})),...summaryBots.map((bot:any)=>h('div',{key:bot.id,className:'item row spread'},identity(bot),badge(bot))),summary&&!summaryBots.length?h('p',{className:'empty'},t('noBots')):null),
      summary?.sessions?.length?h('section',{className:'card'},h('h3',null,t('sessionModels')),...summary.sessions.slice(0,100).map((session:any)=>{const model=session.effectiveModel??session.modelOverride??session.model;return h('div',{className:'item row spread',key:session.id},h('span',null,t('sessionModel',{channel:session.channelId??session.platform??t('unknown'),model:model?`${model.provider} / ${model.model}`:t('none')})),h('small',{className:'muted'},session.personaId??''));})):null,
      overviewServices,
      h('section',{className:'card'},h('h3',null,t('quickActions')),h('div',{className:'actions'},ui.button(t('newBot'),()=>navigate('bots'),{className:'primary'}),ui.button(t('createPersona'),()=>navigate('catalog')),ui.button(t('openServiceSettings'),()=>navigate('services')))),
    );
    if(tab==='bots'){
      const savedSettings=activeBot?.settings;
      const settings=botDraft&&botDraft.id===activeBot?.id?botDraft.settings:savedSettings;
      const updateSettings=(patch:any)=>{setBotDraft((previous:any)=>({id:activeBot.id,settings:{...(previous?.id===activeBot.id?previous.settings:settings),...patch}}));setNotice('');};
      const configSections=settings?botSettingsSections({h,ui,t,editor:{...settings,media:settings.media??{},tools:list(settings.tools),skills:list(settings.skills)},models,profiles:serviceProfiles,busy,dirty:botDraft?.id===activeBot?.id,imageStatus:imageSkills[activeBot.id],mediaStatus:mediaSkills[activeBot.id],update:updateSettings,refreshServices:async(services:string[])=>{for(const serviceId of services)await mutate('service.refresh',{serviceId},message('refreshed'));await refreshServiceStatus();}}):{};
      const selectBot=async(id:string)=>{
        if(id===activeBot?.id)return;
        if((botDraft||Object.keys(workspaceEdits).length)&&!await confirm(message('unsavedChanges')))return;
        setBotDraft(null);setWorkspaceEdits({});setSelectedBotId(id);setError('');setNotice('');
      };
      const saveBotSettings=async()=>{
        if(!activeBot||!botDraft||botDraft.id!==activeBot.id)return;
        const result=await mutate('bot.save',{...activeBot,settings:botDraft.settings},message('savedNextTurn'));
        if(result?.id)setBots((current:any[])=>current?.map(bot=>bot.id===result.id?{...bot,...result}:bot));
        setBotDraft(null);
      };
      const saveBotPatch=(bot:any,patch:any,noticeMessage:DisplayText=message('saved'))=>{const next={...bot,...patch};delete next.settings;return mutate('bot.save',next,noticeMessage);};
      const createForm=newOpen?h('section',{className:'card create-form'},h('h3',null,t('newBot')),h('div',{className:'fields'},ui.field(t('id'),newBot.id,v=>setNewBot({...newBot,id:v})),ui.field(t('name'),newBot.name,v=>setNewBot({...newBot,name:v})),ui.select(t('channel'),newBot.channel,channels.map((c:any)=>({id:c.id,name:c.displayName})),v=>setNewBot({...newBot,channel:v})),ui.select(t('persona'),newBot.configId,configs,v=>setNewBot({...newBot,configId:v}))),ui.button(t('create'),async()=>{if(!newBot.id.trim()||!newBot.name.trim())throw uiError('requiredBotFields',t);await mutate('bot.save',newBot,message('created'));setNewOpen(false);setNewBot({...newBot,id:'',name:''});},{className:'primary'})):null;
      const credentialForm=credential?h('section',{className:'card','aria-label':t('qqCredentials')},h('h3',null,t('qqCredentials')),h('div',{className:'fields'},ui.field('AppID',credential.accountId,v=>setCredential({...credential,accountId:v})),ui.field('AppSecret',credential.appSecret,v=>setCredential({...credential,appSecret:v}),'password',{autoComplete:'new-password'})),h('div',{className:'actions'},ui.button(t('save'),async()=>{await mutate('bot.credentials',{id:credential.id,credential:{accountId:credential.accountId,appSecret:credential.appSecret}},message('credentialsSaved'));setCredential(null);},{className:'primary'}),ui.button(t('cancel'),()=>setCredential(null)))):null;
      const qrForm=qr?h('section',{className:'card','aria-label':t('scanAuth')},h('div',{className:'row spread'},h('h3',null,t('scanAuth')),ui.button(t('close'),()=>setQr(null))),h('p',{role:'status'},({pending:t('waitingScan'),confirmed:t('authSucceeded'),expired:t('qrExpired'),denied:t('cancelled')} as any)[qr.status]),qr.status==='pending'?h('img',{src:qr.qrImage,width:240,height:240,alt:t('qrAlt')}):null):null;
      body=BotsPanel({React,ui,t,bots:displayBots,configs,channels,summary,busy,selectedBotId,section:botSection,onSectionChange:setBotSection,configSections,configLoading:false,configDirty:botDraft?.id===activeBot?.id&&!!botDraft,onSaveConfig:saveBotSettings,onDiscardConfig:()=>setBotDraft(null),onSelect:selectBot,onCreate:()=>setNewOpen(!newOpen),createForm,onServiceToggle:()=>mutate(summary?.health?.serviceRunning===true?'bot.service.stop':'bot.service.start',{},summary?.health?.serviceRunning===true?message('botServiceStopped'):message('botServiceStarted')),onBotToggle:(bot:any,running:boolean)=>mutate(running?'bot.stop':'bot.start',{id:bot.id},running?message('stopped'):message('connectionStarted')),onPersonaChange:(bot:any,configId:string)=>saveBotPatch(bot,{configId},message('switchedNextTurn')),onReconnect:(bot:any)=>mutate('bot.reconnect',{id:bot.id},message('reconnected')),onAuthorize:login,onCredentials:(bot:any)=>setCredential({id:bot.id,accountId:bot.accountId,appSecret:''}),onDelete:async(bot:any)=>{if(!await confirm(message('deleteBotConfirm',{name:bot.name,id:bot.id})))return;setQr((current:any)=>current?.botId===bot.id?null:current);setCredential((current:any)=>current?.id===bot.id?null:current);await mutate('bot.delete',{id:bot.id},message('botDeleted'));if(activeBot?.id===bot.id){setSelectedBotId('');setBotDraft(null);}setWorkspaceEdits((current:any)=>{const next={...current};delete next[bot.id];return next;});},onWorkingDirectoryChange:(bot:any,value:string)=>setWorkspaceEdits((current:any)=>{const next={...current};if(value===(bot.workingDirectory??''))delete next[bot.id];else next[bot.id]=value;return next;}),onBrowseDirectory:async(bot:any)=>{const value=await pickDirectory(workspaceEdits[bot.id]??bot.workingDirectory);if(value)setWorkspaceEdits({...workspaceEdits,[bot.id]:value});},onDefaultDirectory:(bot:any)=>setWorkspaceEdits({...workspaceEdits,[bot.id]:''}),onSaveWorkingDirectory:async(bot:any)=>{await saveBotPatch(bot,{workingDirectory:workspaceEdits[bot.id]??bot.workingDirectory??''});setWorkspaceEdits((old:any)=>{const next={...old};delete next[bot.id];return next;});},workspaceEdits,onAddTrustedUser:async(bot:any)=>{const users=list(bot.trustedUsers);const value=await ask(message('userId'));const next=value?.trim();if(next&&!users.includes(next))await saveBotPatch(bot,{trustedUsers:[...users,next]},message('saved'));},onRemoveTrustedUser:(bot:any,user:string)=>{const users=list(bot.trustedUsers).filter(item=>item!==user);return saveBotPatch(bot,{trustedUsers:users},message('saved'));},credential,credentialForm,qr,qrForm});
    }
    if(tab==='catalog'){
      const selected=edit;
      const existing=!!selected&&configs.some((config:any)=>config.id===selected.id);
      const update=(patch:any)=>{setEdit({...selected,...patch});setDirty(true);setNotice('');};
      const newConfig=async()=>{
        if(dirty&&!await confirm(message('discardAndCreate')))return;
        ++loadSequence.current;setConfigLoading(false);
        setEdit({schemaVersion:4,id:'',name:'',revision:1,personaPrompt:t('defaultPersonaPrompt'),model:null,media:{voice:{enabled:false,protocol:'edge_tts',replyMode:'on_demand',format:'mp3',voice:'zh-CN-XiaoxiaoNeural'}},tools:['bot_media','bot_voice','bot_send_file','bot_remember','bot_forget_memory','bot_read_social'],skills:['image-generation','media-analysis','voice-generation'],allowHostTools:false,hostTools:[],imageStyle:'',progressReply:{enabled:true,intervalSeconds:60},archived:false});
        setDirty(true);setSection('basic');
      };
      const copyConfig=async()=>{
        if(!existing||dirty&&!await confirm(message('unsavedChanges')))return;
        const newId=await ask(message('personaId'));if(!newId?.trim())return;
        const name=await ask(message('name'),`${selected.name} ${t('copySuffix')}`);if(!name?.trim())return;
        const result=await mutate('config.copy',{id:selected.id,newId:newId.trim(),name:name.trim()},message('personaCopied'));setEdit(result);setDirty(false);
      };
      const fileApply=async(id:string)=>{if(dirty&&!await confirm(message('applyFilesConfirm')))return;const result=await mutate('config.files.apply',{id},message('filesApplied'));setEdit(result);setDirty(false);};
      const personaFile=directories.personas.find((item:any)=>item.id===selected?.id);
      const basicSection=selected?h('div',{className:'section-grid'},h('div',{className:'fields'},
        ui.field(t('id'),selected.id,value=>update({id:value}),'text',{disabled:busy||existing}),
        ui.field(t('name'),selected.name,value=>update({name:value})),
        ui.textarea(t('personaPrompt'),selected.personaPrompt,value=>update({personaPrompt:value}),{rows:12}),
      )):null;
      const filesSection=selected?h('section',{className:'section-card'},
        h('div',{className:'row spread'},h('h3',null,t('configFiles')),h('span',{className:'badge'},personaFile?.state==='error'?t('notSynced'):personaFile?.state==='draft'?t('hasDraft'):t('synced'))),
        h('div',{className:'item'},'persona.md'),h('div',{className:'item'},'config.json'),
        h('p',{className:'path'},personaFile?.directory??t('generatedAfterSave')),
        existing?h('div',{className:'actions'},ui.button(t('openDirectory'),()=>mutate('config.directory.open',{configId:selected.id},message('openedDirectory'))),ui.button(t('applyFiles'),()=>fileApply(selected.id))):null,
        personaFile?.error?h('p',{className:'error',role:'alert'},text(personaFile.message?{...personaFile.message,fallback:personaFile.error}:personaFile.error)):null,
      ):null;
      const savePersona=async()=>{if(!selected.id.trim()||!selected.name.trim())throw uiError('requiredBotFields',t);const next=await mutate('config.save',{config:selected,expectedRevision:selected.revision},message('savedNextTurn'));setEdit(next);setDirty(false);};
      const discardPersona=async()=>{if(existing){const next=await query('catalog.config',{id:selected.id});setEdit(next);}else setEdit(null);setDirty(false);};
      body=personaPanel({h,ui,t,configs:configs.map((config:any)=>({...config,relatedBots:summaryBots.filter((bot:any)=>bot.configId===config.id).length})),selected,existing,busy,configLoading,dirty,section:(section==='files'?'files':'basic') as PersonaEditorSection,relatedBots:summaryBots.filter((bot:any)=>bot.configId===selected?.id).length,sections:{basic:basicSection,files:filesSection},selectPersona:loadConfig,createPersona:newConfig,copyPersona:copyConfig,importPersona:async()=>{const id=await ask(message('personaId'));if(id?.trim())await fileApply(id.trim());},setSection:setSection,save:savePersona,discard:discardPersona});
    }
    const saveMessageLocale=async(value:string)=>{if(!settingsForm||languageSaving)return;setLanguageSaving(true);setError('');setNotice('');try{if(!await settingsForm.set('messageLocale',value))throw uiError('messageLocaleSaveFailed',t);setNotice(message('saved'));}finally{setLanguageSaving(false);}};
    if(tab==='services'){
      const settings=voiceLibraryDraft&&voiceLibrary;
      const settingsDirty=serviceSettingsDirty;
      const choose=async(key:'modelsRoot'|'gptSovitsProjectRoot'|'breezeTtsProjectRoot'|'breezeTtsVoicesRoot')=>{if(!voiceLibraryDraft)return;setBusy(true);setError('');try{const result=await pickDirectory(voiceLibraryDraft[key]||undefined,activeLocale);if(result){const next={...voiceLibraryDraft,[key]:result};if(key==='breezeTtsProjectRoot'&&!voiceLibraryDraft.breezeTtsVoicesRoot)next.breezeTtsVoicesRoot=`${result.replace(/[\\/]$/,'')}\\voices`;setVoiceLibraryDraft(next);}}catch(error){setError(errorText(error));}finally{setBusy(false);}};
      const saveSettings=async()=>{if(!voiceLibraryDraft||!voiceLibrary)return;await mutate('service.settings.save',{...voiceLibraryDraft,expectedRevision:voiceLibrary.revision},message('saved'));await refreshServiceStatus();};
      const refreshServices=async()=>{for(const serviceId of ['rvc','gpt-sovits','breeze-tts'])await mutate('service.refresh',{serviceId},message('refreshed'));await refreshServiceStatus();};
      const start=async(serviceId:'gpt-sovits'|'breeze-tts')=>{if(settingsDirty){setError(message('saveServiceFirst'));return;}setBusy(true);setError('');setNotice('');setServiceHealth((old:any)=>({...old,[serviceId]:{state:'unknown'}}));try{const result:any=await api('service.start',{serviceId},AbortSignal.timeout(60_000));const data=result?.data;if(data?.state==='already-running')setNotice(message('serviceAlreadyRunning'));else setNotice(message('serviceStarted'));await refreshServiceStatus();}catch(error){setError(errorText(error));}finally{setBusy(false);}};
      body=ServicesPanel({React,ui,t,locale:activeLocale,messageLocale:settingsSnapshot?.value?.messageLocale??'zh',languageWritable:settingsSnapshot?.status==='ready'&&settingsSnapshot?.writable===true,languageSaving,onMessageLocaleChange:saveMessageLocale,summary,settings, draft:voiceLibraryDraft,dirty:settingsDirty,busy,health:serviceHealth,onDraftChange:(patch:any)=>setVoiceLibraryDraft({...voiceLibraryDraft,...patch}),onSave:saveSettings,onRefresh:refreshServices,onStart:start,onPickDirectory:choose,onToggleRobotService:()=>mutate(summary?.health?.serviceRunning===true?'bot.service.stop':'bot.service.start',{},summary?.health?.serviceRunning===true?message('botServiceStopped'):message('botServiceStarted'))});
    }
    if(tab==='automation')body=null;
    const errors=[summaryError,error].filter(Boolean).map(text);
    const running=summary?.health?.serviceRunning===true;
    const nav=panelSidebar(h,{title:t('panelTitle'),label:t('panelNavigation'),items:tabs.map(([id,label])=>({id,label})),active:tab,disabled:busy||!!question,onNavigate:(next:string)=>{void navigate(next).catch((e:Error)=>setError(errorText(e)));}});
    const header=panelHeader(h,{title:t('panelTitle'),status:h('div',{className:'global-status'},statusPill(h,running?t('online'):t('stopped'),running?'success':'neutral'),ui.button(running?t('stopBotService'):t('startBotService'),()=>mutate(running?'bot.service.stop':'bot.service.start',{},running?message('botServiceStopped'):message('botServiceStarted')),{className:'quiet',disabled:busy||!summary?.health,'aria-label':running?t('stopBotService'):t('startBotService')}))});
    const content=h('div',{className:'app-content'},header,errors.length?h('div',{className:'error',role:'alert'},[...new Set(errors)].join('\n')):null,notice?h('div',{className:'notice',role:'status'},text(notice)):null,body,
      automationVisited?h('div',{hidden:tab!=='automation'},h(AutomationPanel,{React,query,mutate,configs,bots:summaryBots,confirm,onError:setError,busy,t,locale:activeLocale,active:tab==='automation'})):null,
      question?h('div',{className:'dialog-backdrop'},h('form',{ref:dialogRef,className:'card dialog',role:'dialog','aria-modal':true,'aria-label':text(question.title),onSubmit:(event:any)=>{event.preventDefault();answer(question.confirm?true:question.value);},onKeyDown:(event:any)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();answer(question.confirm?false:null);}if(event.key==='Tab'){const nodes=Array.from(dialogRef.current?.querySelectorAll('textarea,button:not(:disabled)')??[]) as HTMLElement[];const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}},h('h3',null,text(question.title)),question.confirm?null:ui.textarea(t('content'),question.value,v=>setQuestion({...question,value:v})),h('div',{className:'actions'},h('button',{type:'submit',className:'primary'},t('confirm')),ui.button(t('cancel'),()=>answer(question.confirm?false:null),{disabled:false})))):null);
    return h('main',{ref:panelRef,className:'bot-admin'},h('style',null,panelStyles),h('div',{className:'app-shell'},nav,h('div',{className:'app-main'},content)));
  }
  return {inject:['slots','locale','configForms'],apply(ctx:any){locale=ctx.locale;settingsForm=ctx.configForms?.get('bot-integration');ctx.effect(()=>ctx.locale.register(LOCALE_NS,{zh,en}));t=ctx.locale.bind(LOCALE_NS);ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'bot-integration',order:35,label:()=>t('nav'),locale:LOCALE_NS},App));}};
}});
