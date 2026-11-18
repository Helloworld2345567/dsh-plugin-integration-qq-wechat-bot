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
import {WorkspaceStoragePanel} from './workspace-storage-panel.js';
import {ServicesPanel,serviceSettingKeys} from './services-panel.js';
import {workflowFileBrowser} from './workflow-file-browser.js';
import {loadPanelServiceHealth,modelLibraryLabel,serviceHealthLabel} from './service-health.js';
import {personaPanel,type PersonaEditorSection} from './persona-panel.js';
import {installHostLeaveGuard} from './host-leave-guard.js';

/* Use the Harness module loader's React instance. */
declare const window:Window & {__ModuleLoader__:any;__BOT_INTEGRATION__?:{endpoint:string;token:string}};
window.__ModuleLoader__.load({id:'dsh-plugin-integration-qq-wechat-bot',factory(require:(id:string)=>any){
  const React=require('react');const h=React.createElement;let t:Translate=chinese;let locale:any;let settingsForm:any;
  const defaultWindowsPath=(...parts:string[])=>[String.fromCharCode(69)+':',...parts].join(String.fromCharCode(92));
  const equal=(left:any,right:any)=>JSON.stringify(left)===JSON.stringify(right);
  const emptyBot=()=>({id:'',name:'',channel:'qq',configId:'default',trustedUsers:[]});
  const serviceDraft=(settings:any)=>({
    modelsRoot:settings.modelsRoot,gptSovitsUrl:settings.gptSovitsUrl,breezeTtsUrl:settings.breezeTtsUrl??'http://127.0.0.1:8080',
    gptSovitsProjectRoot:settings.gptSovitsProjectRoot??'',breezeTtsProjectRoot:settings.breezeTtsProjectRoot??'',breezeTtsVoicesRoot:settings.breezeTtsVoicesRoot??'',
    imageProtocol:settings.imageProtocol??'openai',openAiBaseUrl:settings.openAiBaseUrl??'',openAiModel:settings.openAiModel??'',openAiKeyEnv:settings.openAiKeyEnv??'OPENAI_API_KEY',googleBaseUrl:settings.googleBaseUrl??'https://generativelanguage.googleapis.com/v1beta',googleModel:settings.googleModel??'gemini-2.5-flash-image',googleKeyEnv:settings.googleKeyEnv??'GEMINI_API_KEY',comfyUiBaseUrl:settings.comfyUiBaseUrl??'http://127.0.0.1:8188',comfyUiWorkflowPath:settings.comfyUiWorkflowPath??defaultWindowsPath('COMFYUI','workflows','Krea2Standard-api.json'),
    musicHome:settings.musicHome??defaultWindowsPath('Music'),musicSources:Array.isArray(settings.musicSources)?[...settings.musicSources]:['MiguMusicClient','KuwoMusicClient'],
  });
  async function api(action:string,input:any={},signal?:AbortSignal){
    const boot=window.__BOT_INTEGRATION__;if(!boot)throw uiError('serviceNotReady',t);
    const strictCommand=action==='service.refresh'||action==='service.start'||action==='service.settings.save'||action==='service.settings.pick-directory'||action==='service.settings.pick-file'||action==='bot.service.start'||action==='bot.service.stop'||action==='session.delete'||action==='session.export'||action==='workspace.cleanup'||action==='workspace.pin';
    const response=await fetch(boot.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${boot.token}`},body:JSON.stringify(strictCommand?{version:1,kind:'command',name:action,input}:{action,input}),signal});
    const body=await response.json();if(!response.ok)throw new PanelError(body.error||t('operationFailed'),body.message,body.issues);return body.result;
  }
  function useModal(ref:any,visible:boolean){
    React.useEffect(()=>{
      if(!visible||!ref.current)return;
      const dialog=ref.current,previous=document.activeElement as HTMLElement|null;
      if(!dialog.open)dialog.showModal();
      return()=>{if(dialog.open)dialog.close();if(previous?.isConnected)previous.focus();};
    },[visible]);
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
    const [botDraft,setBotDraft]=React.useState(null as any);
    const [languageSaving,setLanguageSaving]=React.useState(false);
    const [serviceSaving,setServiceSaving]=React.useState(false);const [serviceRefreshing,setServiceRefreshing]=React.useState(false);const [pickingPath,setPickingPath]=React.useState('');
    const [fileBrowser,setFileBrowser]=React.useState(null as any);
    const [personaBaseline,setPersonaBaseline]=React.useState(edit as any);
    const [selectedService,setSelectedService]=React.useState('robot');
    const [languageDraft,setLanguageDraft]=React.useState(null as string|null);
    const [starting,setStarting]=React.useState([] as string[]);
    const [pickError,setPickError]=React.useState(null as {key:string;message:DisplayText}|null);
    const [fieldErrors,setFieldErrors]=React.useState({} as Record<string,DisplayText>);
    const [automationDirty,setAutomationDirty]=React.useState(false);
    const [commands,setCommands]=React.useState([] as string[]);
    const clientRef=React.useRef(null);const loadSequence=React.useRef(0);const dialogRef=React.useRef(null);const mutationRef=React.useRef(false);const sessionRevisionRef=React.useRef('');const sessionsRef=React.useRef([] as any[]);
    const serviceSaveRef=React.useRef(false);const serviceRefreshRef=React.useRef(false);const serviceRefreshAgainRef=React.useRef(false);const serviceSettingsEpoch=React.useRef(0);const pickerRef=React.useRef(null as AbortController|null);
    const panelRef=React.useRef(null);const leaveGuardRef=React.useRef(null);
    const authDialogRef=React.useRef(null);
    const createDialogRef=React.useRef(null);const credentialDialogRef=React.useRef(null);
    const automationDraftRef=React.useRef(null as any);const draftActionsRef=React.useRef({} as Record<string,{save:()=>Promise<unknown>;discard:()=>void}>);
    const serviceStartRef=React.useRef(new Set<string>());
    const commandRef=React.useRef(new Set<string>());
    const serviceBaselineRef=React.useRef(voiceLibrary);serviceBaselineRef.current=voiceLibrary;
    const ui=createUI(React,busy,setError,t);
    const client=()=>{if(!clientRef.current){const boot=window.__BOT_INTEGRATION__;if(!boot)throw uiError('serviceNotReady',t);clientRef.current=new AdminClient(boot);}return clientRef.current as AdminClient;};
    const query=async(name:string,input:any={},signal?:AbortSignal)=>client().query(name,input,signal);
    const refresh=async()=>{const next:any=await query('overview.summary');if(next){let merged={...next,sessions:next.sessions??sessionsRef.current};if(next.sessionRevision&&next.sessionRevision!==sessionRevisionRef.current){sessionRevisionRef.current=next.sessionRevision;try{const page:any=await query('overview.sessions',{limit:100});sessionsRef.current=page?.items??[];merged={...next,sessions:sessionsRef.current};}catch{/* session details are optional; summary remains usable */}}setSummary(merged);setBots((current:any[]|null)=>current?.map(bot=>({...bot,...next.bots?.find((item:any)=>item.id===bot.id)}))??null);setSummaryError('');}};
    const refreshProfiles=async(signal?:AbortSignal)=>{const next=await loadServiceProfiles(query,signal,t);if(!signal?.aborted)setServiceProfiles(next);return next;};
    const refreshLibrary=async(signal?:AbortSignal,reportsOnly=false)=>{
      const epoch=serviceSettingsEpoch.current,next:any=await query('service.settings',{},signal);
      if(next&&!signal?.aborted&&epoch===serviceSettingsEpoch.current&&!serviceSaveRef.current){
        const previous=serviceBaselineRef.current;
        if(reportsOnly&&previous){const updated={...previous,reports:next.reports,refreshing:next.refreshing};serviceBaselineRef.current=updated;setVoiceLibrary(updated);}
        else{
          const baseline=previous?serviceDraft(previous):null,latest=serviceDraft(next);
          serviceBaselineRef.current=next;setVoiceLibrary(next);
          setVoiceLibraryDraft((current:any)=>current&&baseline?Object.fromEntries(Object.keys(latest).map(key=>[key,equal(current[key],baseline[key as keyof typeof baseline])?latest[key as keyof typeof latest]:current[key]])):current??latest);
        }
      }
      return next;
    };
    const refreshServiceStatus=async(signal?:AbortSignal,reportsOnly=false)=>{
      signal?.throwIfAborted();
      const [,profiles]=await Promise.all([refreshLibrary(signal,reportsOnly),refreshProfiles(signal)]);
      const health=await loadPanelServiceHealth(query,profiles,signal);
      if(!signal?.aborted)setServiceHealth(health);
    };
    const refreshBots=async()=>{client().invalidate('bots.list');const next=await query('bots.list');if(next)setBots(next);};
    const refreshBotMediaStatus=async(signal?:AbortSignal)=>{
      const [image,media]=await Promise.all([api('skill.image.status',{scope:'bots'},signal),api('skill.media.status',{scope:'bots'},signal)]);
      if(!signal?.aborted){setImageSkills(image);setMediaSkills(media);}
    };
    const mutate=async(action:string,requestInput:any={},noticeMessage:DisplayText=message('saved'),local=false)=>{
      if(!local&&mutationRef.current)throw uiError('operationBusy',t);if(!local){mutationRef.current=true;setBusy(true);}setError('');setNotice('');
      try{
        const input=typeof requestInput==='function'?await requestInput():requestInput;
        const result=await api(action,input);
        if(action.startsWith('bot.'))client().invalidate('overview.summary');
        if(action.startsWith('config.'))client().invalidate('catalog.config',{id:input.id??input.config?.id});
        if(action.startsWith('automation.'))client().invalidate('automation.list');
        if(action==='session.delete'){client().invalidate('overview.summary');client().invalidate('overview.sessions',{limit:100});sessionRevisionRef.current='';}
        setNotice(noticeMessage);
        // Refresh failures must not turn a successful write into an apparent failed save.
        try{await refresh();if(action.startsWith('bot.'))await refreshBots();if(action==='bot.save')await refreshBotMediaStatus();}catch{setError(message('refreshFailed'));}
        return result;
      }finally{if(!local){mutationRef.current=false;setBusy(false);}}
    };
    const runCommand=async(key:string,action:string,input:any,noticeMessage:DisplayText)=>{
      const pending=commandRef.current??(commandRef.current=new Set<string>());
      if(pending.has(key))return;
      pending.add(key);setCommands([...pending]);
      try{return await mutate(action,input,noticeMessage,true);}
      finally{pending.delete(key);setCommands([...pending]);}
    };
    const ask=(title:DisplayText,value=''):Promise<string|null>=>new Promise(resolve=>setQuestion({title,value,resolve,confirm:false}));
    const confirm=(title:DisplayText):Promise<boolean>=>new Promise(resolve=>setQuestion({title,value:'',resolve,confirm:true}));
    const answer=(value:any)=>{question?.resolve(value);setQuestion(null);};
    const resolveDraft=async(save:()=>Promise<unknown>,discard:()=>void):Promise<boolean>=>{
      if(busy||serviceSaving||languageSaving)throw uiError('operationBusy',t);
      const choice=await new Promise<string>(resolve=>setQuestion({title:message('unsavedChanges'),mode:'leave',resolve}));
      if(choice==='save'){await save();return true;}
      if(choice==='discard'){discard();return true;}
      return false;
    };
    const validationError=(error:unknown)=>{
      const issues=error instanceof PanelError?error.issues:undefined;
      const errors=Object.fromEntries((issues??[]).map(issue=>[issue.path.replace(/^(config|settings)\./,''),issue.message]));
      if(issues?.length)setFieldErrors(errors);
      if(tab==='services'){const entry=Object.entries(serviceSettingKeys).find(([,keys])=>keys.some(key=>key in errors));if(entry){pickerRef.current?.abort();pickerRef.current=null;setPickingPath('');setFileBrowser(null);setSelectedService(entry[0]);}}
      setError(errorText(error));
      if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>panelRef.current?.querySelector('[aria-invalid="true"]')?.focus());
    };
    const savedServiceDraft=voiceLibrary?serviceDraft(voiceLibrary):null;
    const serviceSettingsDirty=!!voiceLibraryDraft&&!!savedServiceDraft&&(Object.keys(savedServiceDraft) as (keyof typeof savedServiceDraft)[]).some(key=>Array.isArray(voiceLibraryDraft[key])||Array.isArray(savedServiceDraft[key])?JSON.stringify(voiceLibraryDraft[key])!==JSON.stringify(savedServiceDraft[key]):voiceLibraryDraft[key]!==savedServiceDraft[key]);
    const languageDirty=languageDraft!==null&&languageDraft!==(settingsSnapshot?.value?.messageLocale??'zh');
    const newBotDirty=newOpen&&!equal(newBot,emptyBot());
    const credentialDirty=!!credential&&(!!credential.appSecret||credential.accountId!==credential.baselineAccountId);
    const hasUnsaved=dirty||!!botDraft||Object.keys(workspaceEdits).length>0||serviceSettingsDirty||languageDirty||newBotDirty||credentialDirty||automationDirty;
    const discardDrafts=()=>{++loadSequence.current;setConfigLoading(false);setEdit(personaBaseline);setDirty(false);setBotDraft(null);setWorkspaceEdits({});if(savedServiceDraft)setVoiceLibraryDraft(savedServiceDraft);setLanguageDraft(null);setNewOpen(false);setNewBot(emptyBot());setCredential(null);automationDraftRef.current?.discard();};
    const saveDrafts=async()=>{for(const scope of Object.values(draftActionsRef.current) as {save:()=>Promise<unknown>}[])await scope.save();if(automationDraftRef.current?.dirty)await automationDraftRef.current.save();};
    leaveGuardRef.current={hasUnsaved,dialogOpen:!!question||newOpen||!!credential||!!qr||!!fileBrowser,confirmLeave:()=>resolveDraft(saveDrafts,discardDrafts)};
    draftActionsRef.current={};
    const navigate=async(next:string)=>{
      if(next===tab)return;
      if(hasUnsaved&&!await resolveDraft(saveDrafts,discardDrafts))return;
      pickerRef.current?.abort();pickerRef.current=null;setPickingPath('');setFileBrowser(null);
      ++loadSequence.current;setConfigLoading(false);setTab(next);if(next==='automation')setAutomationVisited(true);setError('');setNotice('');
    };
    const loadConfig=async(id:string)=>{
      if(dirty&&!await resolveDraft(()=>draftActionsRef.current.persona.save(),()=>{setEdit(personaBaseline);setDirty(false);}))return;
      const sequence=++loadSequence.current;setConfigLoading(true);setError('');setNotice('');
      try{const config=await query('catalog.config',{id});if(config&&sequence===loadSequence.current){setEdit(config);setPersonaBaseline(config);setDirty(false);}}
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
    React.useEffect(()=>()=>pickerRef.current?.abort(),[]);
    useModal(authDialogRef,!!qr);
    React.useEffect(()=>{if(!qr?.attempt||qr.status!=='pending')return;const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
      const poll=async()=>{try{const next=await api('login.poll',{attempt:qr.attempt},abort.signal);if(abort.signal.aborted)return;if(next.status!=='pending'){setQr((old:any)=>({...old,status:next.status}));await refresh();await refreshBots();return;}timer=setTimeout(()=>void poll(),2000);}catch(e){if(!abort.signal.aborted){setError(errorText(e));setQr((old:any)=>old?.attempt===qr.attempt&&old.status==='pending'?{...old,status:'error',error:errorText(e)}:old);}}};void poll();return()=>{abort.abort();clearTimeout(timer);};},[qr?.attempt]);
    useModal(dialogRef,!!question);
    useModal(createDialogRef,newOpen);
    useModal(credentialDialogRef,!!credential);
    React.useEffect(()=>{if(!hasUnsaved)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[hasUnsaved]);
    React.useEffect(()=>panelRef.current?installHostLeaveGuard(panelRef.current,{hasUnsaved:()=>leaveGuardRef.current.hasUnsaved,dialogOpen:()=>leaveGuardRef.current.dialogOpen,confirmLeave:()=>leaveGuardRef.current.confirmLeave(),onError:(error:unknown)=>setError(errorText(error))}):undefined,[]);
    const channels=(summary?.channels?.length?summary.channels:[{id:'qq',capabilities:{login:['qr','credentials']}},{id:'weixin',capabilities:{login:['qr']}}]).map((channel:any)=>({...channel,displayName:channel.id==='qq'?t('qqOfficial'):channel.id==='weixin'?t('weixinIlink'):channel.displayName??channel.id}));
    const summaryBots=(summary?.bots??[]).filter((b:any)=>!b.archived);
    const displayBots=(bots??summaryBots).filter((b:any)=>!b.archived).map((b:any)=>{const status=summaryBots.find((s:any)=>s.id===b.id);return{...status,...b,status:status?.status??b.status,credentialConfigured:status?.credentialConfigured??b.credentialConfigured};});
    const activeBot=displayBots.find((bot:any)=>bot.id===selectedBotId)??displayBots[0];
    const channelName=(id:string)=>channels.find((c:any)=>c.id===id)?.displayName??id;
    const badge=(bot:any)=>h('span',{className:`badge${bot.status==='error'?' warning':''}`},botStatus(bot.status,t));
    const identity=(bot:any)=>h('div',{className:'identity'},h('span',{className:'avatar','aria-hidden':true},bot.channel==='qq'?'Q':'W'),h('div',null,h('strong',null,bot.name),h('p',{className:'muted'},channelName(bot.channel))));
    const login=async(bot:any)=>{
      setQr({botId:bot.id,botName:bot.name,status:'loading'});
      try{const next=await runCommand(bot.id,'login.begin',{id:bot.id},message('scanToAuthorize'));setQr((current:any)=>current?.botId===bot.id?{...next,botId:bot.id,botName:bot.name}:current);}
      catch(error){setQr((current:any)=>current?.botId===bot.id?{...current,status:'error',error:errorText(error)}:current);}
    };
    const pickDirectory=async(current:string|undefined,locale=activeLocale,signal?:AbortSignal)=>{const result=await api('service.settings.pick-directory',{current:current||undefined,locale},signal);return typeof result?.path==='string'?result.path:undefined;};
    const closeFileBrowser=()=>{pickerRef.current?.abort();pickerRef.current=null;setPickingPath('');setFileBrowser(null);};
    const chooseDirectory=async(key:string,current:string|undefined,apply:(path:string)=>void)=>{
      closeFileBrowser();
      const controller=new AbortController();pickerRef.current=controller;setPickingPath(key);setPickError(null);
      try{const path=await pickDirectory(current,activeLocale,controller.signal);if(path&&!controller.signal.aborted)apply(path);}
      catch(error){if(!controller.signal.aborted)setPickError({key,message:errorText(error)});}
      finally{if(pickerRef.current===controller){pickerRef.current=null;setPickingPath('');}}
    };
    const browseWorkflowFiles=async(current:string)=>{
      pickerRef.current?.abort();
      const controller=new AbortController();pickerRef.current=controller;setPickingPath('comfyUiWorkflowPath');
      setFileBrowser((previous:any)=>({...previous,location:current,loading:true,error:'',entries:[]}));
      try{
        const result=await api('service.settings.pick-file',{current,locale:activeLocale},AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]));
        if(!controller.signal.aborted)setFileBrowser({...result,location:result.directory,loading:false,error:''});
      }catch(error){if(!controller.signal.aborted)setFileBrowser((previous:any)=>({...previous,loading:false,error:text(errorText(error))}));}
      finally{if(pickerRef.current===controller)pickerRef.current=null;}
    };
    const tabs=[['overview',t('overview')],['bots',t('bots')],['services',t('services')],['catalog',t('personas')],['automation',t('automation')]];
    const overviewServices=h('section',{className:'card overview-services'},
      h('div',{className:'row spread'},h('h3',null,t('services')),ui.button(t('manage'),()=>navigate('services'),{className:'quiet'})),
      h('div',{className:'overview-service-grid'},
        h('div',{className:'overview-service-item'},h('strong',null,t('robotService')),h('span',{className:'badge'},summary?.health?(summary.health.serviceRunning?t('online'):t('stopped')):t('unknown'))),
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
      summary?.sessions?.length?h('section',{className:'card'},h('h3',null,t('sessionModels')),...summary.sessions.slice(0,100).map((session:any)=>{
        const model=session.effectiveModel??session.modelOverride??session.model;
        const created=session.createdAt?new Date(session.createdAt).toLocaleString(activeLocale==='en'?'en-US':'zh-CN'):'';
        return h('div',{className:'item row spread',key:session.id},
          h('div',null,h('span',null,t('sessionModel',{channel:session.channelId??session.platform??t('unknown'),model:model?`${model.provider} / ${model.model}`:t('none')})),h('div',null,h('small',{className:'muted',title:session.id},[session.personaId,session.id.slice(0,12),created].filter(Boolean).join(' · ')))),
          h('div',{className:'actions'},ui.button(t('exportSession'),async()=>{const result=await mutate('session.export',{id:session.id});setNotice(message('sessionExported',{path:result.path}));},{className:'quiet',disabled:busy||!!question||!session.persisted}),ui.button(t('delete'),async()=>{if(await confirm(message('deleteSessionConfirm',{id:session.id})))await mutate('session.delete',{id:session.id},message('sessionDeleted'));},{className:'danger quiet','aria-label':t('deleteSessionLabel',{id:session.id}),disabled:busy||!!question})),
        );
      })):null,
      overviewServices,
      h('section',{className:'card'},h('h3',null,t('quickActions')),h('div',{className:'actions'},ui.button(t('newBot'),()=>navigate('bots'),{className:'primary'}),ui.button(t('createPersona'),()=>navigate('catalog')),ui.button(t('openServiceSettings'),()=>navigate('services')))),
    );
    if(tab==='bots'){
      const savedSettings=activeBot?.settings;
      const settings=botDraft&&botDraft.id===activeBot?.id?botDraft.settings:savedSettings;
      const updateBotDraft=(patch:any)=>{setBotDraft((previous:any)=>{
        const baseline=previous?.id===activeBot.id?previous.baseline:{settings:savedSettings,configId:activeBot.configId};
        const next={...(previous?.id===activeBot.id?previous:{id:activeBot.id,...baseline,baseline}),...patch};
        return equal({settings:next.settings,configId:next.configId},baseline)?null:next;
      });setNotice('');setFieldErrors({});};
      const updateSettings=(patch:any)=>updateBotDraft({settings:{...settings,...patch}});
      const configSections=settings?botSettingsSections({h,ui,t,editor:{...settings,media:settings.media??{},tools:list(settings.tools),skills:list(settings.skills)},models,profiles:serviceProfiles,fieldErrors:Object.fromEntries(Object.entries(fieldErrors).map(([key,value])=>[key,text(value as DisplayText)])),busy,dirty:botDraft?.id===activeBot?.id,imageStatus:imageSkills[activeBot.id],mediaStatus:mediaSkills[activeBot.id],update:updateSettings,refreshServices:async(services:string[])=>{for(const serviceId of services)await api('service.refresh',{serviceId});await refreshProfiles();setNotice(message('refreshed'));}}):{};
      const selectBot=async(id:string)=>{
        if(id===activeBot?.id)return;
        if((botDraft||Object.keys(workspaceEdits).length)&&!await resolveDraft(saveDrafts,discardDrafts))return;
        closeFileBrowser();setPickError(null);
        setBotDraft(null);setWorkspaceEdits({});setSelectedBotId(id);setError('');setNotice('');
      };
      const saveBotSettings=async()=>{
        if(!activeBot||!botDraft||botDraft.id!==activeBot.id)return;
        await saveBotPatch(activeBot,{settings:botDraft.settings,configId:botDraft.configId??activeBot.configId},message('savedNextTurn')).catch((error:unknown)=>{validationError(error);throw error;});
        setBotDraft(null);
      };
      if(botDraft)draftActionsRef.current.bot={save:saveBotSettings,discard:()=>setBotDraft(null)};
      const saveBotPatch=async(bot:any,patch:any,noticeMessage:DisplayText=message('saved'))=>{
        if(commandRef.current?.has(bot.id))throw uiError('operationBusy',t);
        const result=await mutate('bot.save',async()=>{
          client().invalidate('bots.list');
          const records:any=await query('bots.list'),baseline=records?.find((item:any)=>item.id===bot.id);
          if(!baseline)throw uiError('selectBotPersona',t);
          const next={...baseline,...patch};if(!('settings' in patch))delete next.settings;
          return next;
        },noticeMessage);
        if(result?.id)setBots((current:any[]) => (current??displayBots).map(item=>item.id===result.id?{...item,...result}:item));
        return result;
      };
      const updateWorkspace=(bot:any,value:string)=>setWorkspaceEdits((current:any)=>{const next={...current};if(value===(bot.workingDirectory??''))delete next[bot.id];else next[bot.id]=value;return next;});
      const saveWorkspace=async(bot:any)=>{if(!(bot.id in workspaceEdits))return;closeFileBrowser();await saveBotPatch(bot,{workingDirectory:workspaceEdits[bot.id]});setWorkspaceEdits((old:any)=>{const next={...old};delete next[bot.id];return next;});try{setDirectories(await api('directories'));}catch{setError(message('refreshFailed'));}};
      for(const id of Object.keys(workspaceEdits)){const bot=displayBots.find((item:any)=>item.id===id);if(bot)draftActionsRef.current[`workspace:${id}`]={save:()=>saveWorkspace(bot),discard:()=>updateWorkspace(bot,bot.workingDirectory??'')};}
      const createBot=async(authorize=true)=>{
        if(!newBot.id.trim()||!newBot.name.trim()){setFieldErrors({[!newBot.id.trim()?'id':'name']:message('requiredBotFields')});throw uiError('requiredBotFields',t);}
        const bot=await mutate('bot.save',newBot,message('created'));
        setBots((current:any[])=>[...(current??displayBots).filter(item=>item.id!==bot.id),bot]);
        closeFileBrowser();setSelectedBotId(bot.id);setBotSection('auth');setBotDraft(null);setWorkspaceEdits({});
        setNewOpen(false);setNewBot(emptyBot());
        if(authorize)await login(bot);
      };
      const closeCreate=async()=>{if(newBotDirty&&!await resolveDraft(()=>createBot(false),()=>setNewBot(emptyBot())))return;setNewOpen(false);};
      const saveCredentials=async()=>{await mutate('bot.credentials',{id:credential.id,credential:{accountId:credential.accountId,appSecret:credential.appSecret}},message('credentialsSaved'));setCredential(null);};
      const closeCredentials=async()=>{if(credentialDirty&&!await resolveDraft(saveCredentials,()=>setCredential(null)))return;setCredential(null);};
      if(newBotDirty)draftActionsRef.current.newBot={save:()=>createBot(false),discard:()=>{setNewOpen(false);setNewBot(emptyBot());}};
      if(credentialDirty)draftActionsRef.current.credentials={save:saveCredentials,discard:()=>setCredential(null)};
      const createForm=newOpen?h('dialog',{ref:createDialogRef,className:'card dialog',role:'dialog','aria-modal':true,'aria-label':t('newBot'),onKeyDown:(event:any)=>{if(event.key==='Escape')event.stopPropagation();},onCancel:(event:any)=>{event.preventDefault();event.stopPropagation();void closeCreate().catch(validationError);}},
        h('form',{onSubmit:(event:any)=>{event.preventDefault();void createBot().catch(validationError);}},h('h3',null,t('newBot')),
          h('div',{className:'fields'},ui.field(t('id'),newBot.id,v=>setNewBot({...newBot,id:v}),'text',{id:'new-bot-id',required:true,autoFocus:true,error:text(fieldErrors.id)}),ui.field(t('name'),newBot.name,v=>setNewBot({...newBot,name:v}),'text',{id:'new-bot-name',required:true,error:text(fieldErrors.name)}),ui.select(t('channel'),newBot.channel,channels.map((c:any)=>({id:c.id,name:c.displayName})),v=>setNewBot({...newBot,channel:v})),ui.select(t('persona'),newBot.configId,configs,v=>setNewBot({...newBot,configId:v}))),
          h('div',{className:'actions'},ui.button(t('cancel'),closeCreate),h('button',{type:'submit',className:'primary',disabled:busy},t('create'))))):null;
      const credentialForm=credential?h('dialog',{ref:credentialDialogRef,className:'card dialog',role:'dialog','aria-modal':true,'aria-label':t('qqCredentials'),onKeyDown:(event:any)=>{if(event.key==='Escape')event.stopPropagation();},onCancel:(event:any)=>{event.preventDefault();event.stopPropagation();void closeCredentials().catch(validationError);}},
        h('form',{onSubmit:(event:any)=>{event.preventDefault();void saveCredentials().catch(validationError);}},h('h3',null,t('qqCredentials')),
          h('div',{className:'fields'},ui.field('AppID',credential.accountId,v=>setCredential({...credential,accountId:v}),'text',{required:true,autoFocus:true}),ui.field('AppSecret',credential.appSecret,v=>setCredential({...credential,appSecret:v}),'password',{required:true,autoComplete:'new-password'})),
          h('div',{className:'actions'},ui.button(t('cancel'),closeCredentials),h('button',{type:'submit',className:'primary',disabled:busy},t('save'))))):null;
      body=BotsPanel({React,ui,t,bots:displayBots.map((bot:any)=>botDraft?.id===bot.id?{...bot,configId:botDraft.configId??bot.configId}:bot),configs,channels,summary,busy,commandPending:commands.includes(activeBot?.id),selectedBotId,section:botSection,onSectionChange:(next:any)=>{closeFileBrowser();setBotSection(next);},configSections,configLoading:false,configDirty:botDraft?.id===activeBot?.id&&!!botDraft,onSaveConfig:saveBotSettings,onDiscardConfig:()=>setBotDraft(null),onSelect:selectBot,onCreate:async()=>{if((botDraft||Object.keys(workspaceEdits).length)&&!await resolveDraft(saveDrafts,discardDrafts))return;setFieldErrors({});setNewOpen(true);},createForm,onServiceToggle:()=>mutate(summary?.health?.serviceRunning===true?'bot.service.stop':'bot.service.start',{},summary?.health?.serviceRunning===true?message('botServiceStopped'):message('botServiceStarted')),onBotToggle:(bot:any,running:boolean)=>runCommand(bot.id,running?'bot.stop':'bot.start',{id:bot.id},running?message('stopped'):message('connectionStarted')),onPersonaChange:(_bot:any,configId:string)=>updateBotDraft({configId}),onReconnect:(bot:any)=>runCommand(bot.id,'bot.reconnect',{id:bot.id},message('reconnected')),onAuthorize:login,onCredentials:(bot:any)=>setCredential({id:bot.id,accountId:bot.accountId??'',baselineAccountId:bot.accountId??'',appSecret:''}),onDelete:async(bot:any)=>{if(!await confirm(message('deleteBotConfirm',{name:bot.name,id:bot.id})))return;if(pickingPath===`workspace:${bot.id}`)closeFileBrowser();setQr((current:any)=>current?.botId===bot.id?null:current);setCredential((current:any)=>current?.id===bot.id?null:current);await mutate('bot.delete',{id:bot.id},message('botDeleted'));setBots((current:any[]) => (current??displayBots).filter(item=>item.id!==bot.id));if(activeBot?.id===bot.id){setSelectedBotId('');setBotDraft(null);}setWorkspaceEdits((current:any)=>{const next={...current};delete next[bot.id];return next;});},onWorkingDirectoryChange:(bot:any,value:string)=>{if(pickingPath===`workspace:${bot.id}`)closeFileBrowser();updateWorkspace(bot,value);},onBrowseDirectory:(bot:any)=>chooseDirectory(`workspace:${bot.id}`,workspaceEdits[bot.id]??bot.workingDirectory,value=>updateWorkspace(bot,value)),onDefaultDirectory:(bot:any)=>{closeFileBrowser();updateWorkspace(bot,'');},onSaveWorkingDirectory:saveWorkspace,onRevertWorkingDirectory:(bot:any)=>{closeFileBrowser();updateWorkspace(bot,bot.workingDirectory??'');},workspacePicking:pickingPath===`workspace:${activeBot?.id}`,onCancelPick:closeFileBrowser,workspacePickError:pickError?.key===`workspace:${activeBot?.id}`?text(pickError?.message):undefined,workspaceEdits,workspaceDirectories:directories.sessions??[],storagePanel:activeBot&&botSection==='workspace'?h(WorkspaceStoragePanel,{key:activeBot.id,React,t,botId:activeBot.id,query,api,confirm,onError:setError,onNotice:setNotice}):null,onAddTrustedUser:async(bot:any)=>{const users=list(bot.trustedUsers);const value=await ask(message('userId'));const next=value?.trim();if(next&&!users.includes(next))await saveBotPatch(bot,{trustedUsers:[...users,next]},message('saved'));},onRemoveTrustedUser:(bot:any,user:string)=>{const users=list(bot.trustedUsers).filter(item=>item!==user);return saveBotPatch(bot,{trustedUsers:users},message('saved'));},credential,credentialForm});
    }
    if(tab==='catalog'){
      const selected=edit;
      const existing=!!selected&&configs.some((config:any)=>config.id===selected.id);
      const update=(patch:any)=>{const next={...selected,...patch};setEdit(next);setDirty(!equal(next,personaBaseline));setNotice('');setFieldErrors({});};
      const newConfig=async()=>{
        if(dirty&&!await resolveDraft(()=>draftActionsRef.current.persona.save(),()=>{setEdit(personaBaseline);setDirty(false);}))return;
        ++loadSequence.current;setConfigLoading(false);
        setEdit({schemaVersion:4,id:'',name:'',revision:1,personaPrompt:t('defaultPersonaPrompt'),model:null,media:{voice:{enabled:false,protocol:'edge_tts',replyMode:'on_demand',format:'mp3',voice:'zh-CN-XiaoxiaoNeural'}},tools:['bot_media','bot_voice','bot_send_file','bot_remember','bot_forget_memory','bot_read_social'],skills:['image-generation','media-analysis','voice-generation'],allowHostTools:false,hostTools:[],imageStyle:'',progressReply:{enabled:true,intervalSeconds:60},archived:false});
        setPersonaBaseline(null);setDirty(true);setSection('basic');
      };
      const copyConfig=async()=>{
        if(!existing||dirty&&!await resolveDraft(()=>draftActionsRef.current.persona.save(),()=>{setEdit(personaBaseline);setDirty(false);}))return;
        const newId=await ask(message('personaId'));if(!newId?.trim())return;
        const name=await ask(message('name'),`${selected.name} ${t('copySuffix')}`);if(!name?.trim())return;
        const result=await mutate('config.copy',{id:selected.id,newId:newId.trim(),name:name.trim()},message('personaCopied'));setEdit(result);setPersonaBaseline(result);setDirty(false);
      };
      const fileApply=async(id:string)=>{if(!await confirm(message('applyFilesConfirm')))return;const result=await mutate('config.files.apply',{id},message('filesApplied'));setEdit(result);setPersonaBaseline(result);setDirty(false);};
      const personaFile=directories.personas.find((item:any)=>item.id===selected?.id);
      const basicSection=selected?h('div',{className:'section-grid'},h('div',{className:'fields'},
        ui.field(t('id'),selected.id,value=>update({id:value}),'text',{disabled:busy||existing,required:true,id:'persona-id',error:text(fieldErrors.id)}),
        ui.field(t('name'),selected.name,value=>update({name:value}),'text',{required:true,id:'persona-name',error:text(fieldErrors.name)}),
        ui.textarea(t('personaPrompt'),selected.personaPrompt,value=>update({personaPrompt:value}),{rows:12}),
      )):null;
      const filesSection=selected?h('section',{className:'section-card'},
        h('div',{className:'row spread'},h('h3',null,t('configFiles')),h('span',{className:'badge'},personaFile?.state==='error'?t('notSynced'):personaFile?.state==='draft'?t('hasDraft'):t('synced'))),
        h('div',{className:'item'},'persona.md'),h('div',{className:'item'},'config.json'),
        h('p',{className:'path'},personaFile?.directory??t('generatedAfterSave')),
        existing?h('div',{className:'actions'},ui.button(t('openDirectory'),()=>mutate('config.directory.open',{configId:selected.id},message('openedDirectory'))),ui.button(t('applyFiles'),()=>fileApply(selected.id))):null,
        personaFile?.error?h('p',{className:'error',role:'alert'},text(personaFile.message?{...personaFile.message,fallback:personaFile.error}:personaFile.error)):null,
      ):null;
      const savePersona=async()=>{if(!selected.id.trim()||!selected.name.trim()){setFieldErrors({[!selected.id.trim()?'id':'name']:message('requiredBotFields')});throw uiError('requiredBotFields',t);}const next=await mutate('config.save',{config:selected,expectedRevision:selected.revision},message('savedNextTurn'));setEdit(next);setPersonaBaseline(next);setDirty(false);};
      const discardPersona=()=>{setEdit(personaBaseline);setDirty(false);setFieldErrors({});};
      if(dirty)draftActionsRef.current.persona={save:async()=>{try{await savePersona();}catch(error){validationError(error);throw error;}},discard:discardPersona};
      body=personaPanel({h,ui,t,configs:configs.map((config:any)=>({...config,relatedBots:summaryBots.filter((bot:any)=>bot.configId===config.id).length})),selected,existing,busy,configLoading,dirty,section:(section==='files'?'files':'basic') as PersonaEditorSection,relatedBots:summaryBots.filter((bot:any)=>bot.configId===selected?.id).length,sections:{basic:basicSection,files:filesSection},selectPersona:loadConfig,createPersona:newConfig,copyPersona:copyConfig,importPersona:async()=>{const id=await ask(message('personaId'));if(id?.trim())await fileApply(id.trim());},setSection:setSection,save:async()=>{try{await savePersona();}catch(error){validationError(error);throw error;}},discard:discardPersona});
    }
    const saveMessageLocale=async()=>{if(!languageDirty)return;if(!settingsForm||languageSaving)throw uiError('operationBusy',t);setLanguageSaving(true);setError('');setNotice('');try{if(!await settingsForm.set('messageLocale',languageDraft))throw uiError('messageLocaleSaveFailed',t);setLanguageDraft(null);setNotice(message('saved'));}finally{setLanguageSaving(false);}};
    if(languageDirty)draftActionsRef.current.language={save:saveMessageLocale,discard:()=>setLanguageDraft(null)};
    if(tab==='services'){
      const settings=voiceLibraryDraft&&voiceLibrary?{...voiceLibrary,...savedServiceDraft}:null;
      const settingsDirty=serviceSettingsDirty;
      const cancelPick=closeFileBrowser;
      const choose=async(key:'modelsRoot'|'gptSovitsProjectRoot'|'breezeTtsProjectRoot'|'breezeTtsVoicesRoot'|'comfyUiWorkflowPath')=>{
        if(!voiceLibraryDraft)return;
        if(key==='comfyUiWorkflowPath'){await browseWorkflowFiles(voiceLibraryDraft[key]??'');return;}
        await chooseDirectory(key,voiceLibraryDraft[key],path=>setVoiceLibraryDraft((current:any)=>{
          if(!current)return current;
          const next={...current,[key]:path};
          if(key==='breezeTtsProjectRoot'&&!current.breezeTtsVoicesRoot)next.breezeTtsVoicesRoot=`${path.replace(/[\\/]$/,'')}\\voices`;
          return next;
        }));
      };
      const refreshServices=async(manual=true)=>{
        serviceRefreshAgainRef.current=true;
        if(serviceRefreshRef.current)return;
        serviceRefreshRef.current=true;setServiceRefreshing(true);
        if(manual){setError('');setNotice('');}
        try{
          let force=manual;
          do{
            serviceRefreshAgainRef.current=false;
            const latest=await refreshLibrary(undefined,true);
            if(force||latest?.refreshing){
              // Join the active scan; a newer save can replace it while we wait.
              try{await Promise.all([api('service.refresh',{serviceId:'rvc'}),...(force?[api('service.refresh',{serviceId:'music'})]:[])]);}
              catch(error){if(!serviceRefreshAgainRef.current)throw error;}
              force=false;serviceRefreshAgainRef.current=true;
              continue;
            }
            const profiles=await refreshProfiles();setServiceHealth(await loadPanelServiceHealth(query,profiles));
          }while(serviceRefreshAgainRef.current);
          if(manual)setNotice(message('refreshed'));
        }catch(error){setError(manual?errorText(error):message('refreshFailed'));}
        finally{serviceRefreshRef.current=false;setServiceRefreshing(false);}
      };
      const saveSettings=async(keys?:readonly string[])=>{
        if(!voiceLibraryDraft||!voiceLibrary||serviceSaveRef.current)throw uiError('operationBusy',t);
        const draftAtSubmit=voiceLibraryDraft;
        const submitted=keys?{...savedServiceDraft,...Object.fromEntries(keys.map(key=>[key,draftAtSubmit[key]]))}:draftAtSubmit;
        serviceSaveRef.current=true;++serviceSettingsEpoch.current;if(serviceRefreshRef.current)serviceRefreshAgainRef.current=true;setServiceSaving(true);setError('');setNotice('');setFieldErrors({});
        try{
          const result=await api('service.settings.save',{...submitted,expectedRevision:voiceLibrary.revision});
          const saved=result.data,next=serviceDraft(saved);++serviceSettingsEpoch.current;serviceBaselineRef.current=saved;setVoiceLibrary(saved);
          setVoiceLibraryDraft((current:any)=>Object.fromEntries(Object.keys(next).map(key=>[key,(!keys||keys.includes(key))&&equal(current?.[key],draftAtSubmit[key])?next[key as keyof typeof next]:current?.[key]])));
          setNotice(message('saved'));
          if(saved.refreshing)void refreshServices(false);
        }catch(error){validationError(error);throw error;}
        finally{serviceSaveRef.current=false;setServiceSaving(false);}
      };
      const revertSettings=()=>{closeFileBrowser();setPickError(null);setFieldErrors({});setVoiceLibraryDraft(savedServiceDraft);};
      if(settingsDirty)draftActionsRef.current.services={save:()=>saveSettings(),discard:revertSettings};
      const start=async(serviceId:'gpt-sovits'|'breeze-tts'|'comfyui',saveFirst=false)=>{
        const pending=serviceStartRef.current??(serviceStartRef.current=new Set<string>());
        if(pending.has(serviceId))return;
        pending.add(serviceId);setStarting([...pending]);setError('');setNotice('');
        try{
          if(saveFirst)await saveSettings(serviceSettingKeys[serviceId]);
          const result:any=await api('service.start',{serviceId},AbortSignal.timeout(serviceId==='comfyui'?180_000:60_000));
          setNotice(message(result?.data?.state==='already-running'?'serviceAlreadyRunning':'serviceStarted'));
          try{await refreshServiceStatus(undefined,true);}catch{setError(message('refreshFailed'));}
        }catch(error){setError(errorText(error));}
        finally{pending.delete(serviceId);setStarting([...pending]);}
      };
      body=ServicesPanel({React,ui,t,locale:activeLocale,selectedService,onSelectService:(id:any)=>{closeFileBrowser();setPickError(null);setSelectedService(id);},messageLocale:settingsSnapshot?.value?.messageLocale??'zh',messageLocaleDraft:languageDraft??settingsSnapshot?.value?.messageLocale??'zh',onMessageLocaleDraftChange:(value:string)=>setLanguageDraft(value),onSaveMessageLocale:saveMessageLocale,languageWritable:settingsSnapshot?.status==='ready'&&settingsSnapshot?.writable===true,languageSaving,summary,settings,draft:voiceLibraryDraft,dirty:settingsDirty,busy,saving:serviceSaving,refreshing:serviceRefreshing,starting,picking:pickingPath,pickError:pickError?{key:pickError.key,message:text(pickError.message)}:undefined,fieldErrors:Object.fromEntries(Object.entries(fieldErrors).map(([key,value])=>[key,text(value as DisplayText)])),onCancelPick:cancelPick,health:serviceHealth,onDraftChange:(patch:any)=>{if(pickingPath in patch)closeFileBrowser();setFieldErrors({});setVoiceLibraryDraft((current:any)=>({...current,...patch}));},onSave:()=>saveSettings(),onRevert:revertSettings,onRefresh:refreshServices,onStart:start,onPickDirectory:choose,onPickFile:choose,robotPending:commands.includes('$service'),onToggleRobotService:()=>runCommand('$service',summary?.health?.serviceRunning===true?'bot.service.stop':'bot.service.start',{},summary?.health?.serviceRunning===true?message('botServiceStopped'):message('botServiceStarted'))});
    }
    if(tab==='automation')body=null;
    const errors=[summaryError,error].filter(Boolean).map(text);
    const running=summary?.health?.serviceRunning===true;
    const nav=panelSidebar(h,{title:t('panelTitle'),label:t('panelNavigation'),items:tabs.map(([id,label])=>({id,label})),active:tab,disabled:busy||!!question,onNavigate:(next:string)=>{void navigate(next).catch((e:Error)=>setError(errorText(e)));}});
    const header=panelHeader(h,{title:tabs.find(([id])=>id===tab)?.[1]??t('panelTitle'),status:h('div',{className:'global-status'},statusPill(h,summary?.health?(running?t('online'):t('stopped')):t('unknown'),running?'success':'neutral'),ui.button(running?t('stopBotService'):t('startBotService'),()=>runCommand('$service',running?'bot.service.stop':'bot.service.start',{},running?message('botServiceStopped'):message('botServiceStarted')),{className:'quiet',disabled:busy||commands.includes('$service')||!summary?.health,'aria-label':running?t('stopBotService'):t('startBotService')}))});
    const content=h('div',{className:'app-content'},header,errors.length?h('div',{className:'error',role:'alert'},[...new Set(errors)].join('\n')):null,notice?h('div',{className:'notice',role:'status'},text(notice)):null,body,
      qr?h('dialog',{ref:authDialogRef,className:'card dialog auth-dialog',role:'dialog','aria-label':t('scanAuth'),'aria-modal':true,onCancel:(event:any)=>{event.preventDefault();event.stopPropagation();setQr(null);},onKeyDown:(event:any)=>{if(event.key==='Escape')event.stopPropagation();}},
        h('div',{className:'row spread'},h('h3',null,t('scanAuth')),ui.button(t('close'),()=>setQr(null),{disabled:false,autoFocus:true})),
        h('p',{className:'muted'},qr.botName??qr.botId),
        qr.error?h('p',{className:'error',role:'alert'},text(qr.error)):h('p',{role:'status'},({loading:t('loading'),pending:t('waitingScan'),confirmed:t('authSucceeded'),expired:t('qrExpired'),denied:t('cancelled')} as any)[qr.status]),
        qr.status==='pending'?h('img',{src:qr.qrImage,width:240,height:240,alt:t('qrAlt')}):null,
        ['error','expired','denied'].includes(qr.status)?ui.button(t('authorize'),()=>login({id:qr.botId,name:qr.botName}),{className:'primary'}):null,
      ):null,
      workflowFileBrowser({React,ui,t,state:fileBrowser,onBrowse:browseWorkflowFiles,onLocation:(location:string)=>setFileBrowser((previous:any)=>({...previous,location})),onSelect:(file:string)=>{setVoiceLibraryDraft((current:any)=>({...current,comfyUiWorkflowPath:file}));closeFileBrowser();},onCancel:closeFileBrowser}),
      automationVisited?h('div',{hidden:tab!=='automation'},h(AutomationPanel,{React,query,mutate:(action:string,input:any,noticeMessage:DisplayText)=>mutate(action,input,noticeMessage,true),configs,bots:summaryBots,confirm,onError:setError,busy,t,locale:activeLocale,active:tab==='automation',resolveDraft,onDraftState:(state:any)=>{automationDraftRef.current=state;setAutomationDirty(state.dirty);}})):null,
      question?h('dialog',{ref:dialogRef,className:'card dialog',role:'dialog','aria-modal':true,'aria-label':text(question.title),onKeyDown:(event:any)=>{if(event.key==='Escape')event.stopPropagation();},onCancel:(event:any)=>{event.preventDefault();event.stopPropagation();answer(question.mode==='leave'?'cancel':question.confirm?false:null);}},
        h('form',{onSubmit:(event:any)=>{event.preventDefault();answer(question.confirm?true:question.value);}},h('h3',null,text(question.title)),
          question.confirm||question.mode==='leave'?null:ui.textarea(t('content'),question.value,v=>setQuestion({...question,value:v}),{autoFocus:true}),
          question.mode==='leave'?h('div',{className:'actions'},ui.button(t('continueEditing'),()=>answer('cancel'),{disabled:false,autoFocus:true}),ui.button(t('discardChanges'),()=>answer('discard'),{disabled:false}),ui.button(t('saveAndContinue'),()=>answer('save'),{className:'primary',disabled:false})):
            h('div',{className:'actions'},ui.button(t('cancel'),()=>answer(question.confirm?false:null),{disabled:false,autoFocus:question.confirm}),h('button',{type:'submit',className:'primary'},t('confirm'))))):null);
    return h('main',{ref:panelRef,className:'bot-admin'},h('style',null,panelStyles),h('div',{className:'app-shell'},nav,h('div',{className:'app-main'},content)));
  }
  return {inject:['slots','locale','configForms'],apply(ctx:any){locale=ctx.locale;settingsForm=ctx.configForms?.get('bot-integration');ctx.effect(()=>ctx.locale.register(LOCALE_NS,{zh,en}));t=ctx.locale.bind(LOCALE_NS);ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'bot-integration',order:35,label:()=>t('nav'),locale:LOCALE_NS},App));}};
}});
