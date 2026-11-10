import {StatisticsPanel} from './statistics.js';
import {AutomationPanel} from './automation.js';
import {AdminClient} from './admin-client.js';
import {panelStyles} from './styles.js';
import {botStatus,createUI,list} from './ui.js';
import {singingCard} from './singing.js';
import {musicCard} from './music.js';
import {loadServiceProfiles,useVoiceModel,voiceModelPicker,type VoiceModelRole} from './voice-models.js';
import {LOCALE_NS,chinese,zh,type Translate} from './locale.js';
import {panelHeader,panelSidebar,statusPill} from './layout.js';
import {BotsPanel} from './bots-panel.js';
import {ServicesPanel} from './services-panel.js';
import {personaPanel,type PersonaEditorSection} from './persona-panel.js';
import {capabilityGroups} from './panel-model.js';

/* Use the Harness module loader's React instance. */
declare const window:Window & {__ModuleLoader__:any;__BOT_INTEGRATION__?:{endpoint:string;token:string}};
window.__ModuleLoader__.load({id:'dsh-plugin-integration-qq-wechat-bot',factory(require:(id:string)=>any){
  const React=require('react');const h=React.createElement;let t:Translate=chinese;let locale:any;
  async function api(action:string,input:any={},signal?:AbortSignal){
    const boot=window.__BOT_INTEGRATION__;if(!boot)throw Error(t('serviceNotReady'));
    const strictCommand=action==='service.refresh'||action==='service.start'||action==='service.settings.save'||action==='service.settings.pick-directory'||action==='bot.service.start'||action==='bot.service.stop';
    const response=await fetch(boot.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${boot.token}`},body:JSON.stringify(strictCommand?{version:1,kind:'command',name:action,input}:{action,input}),signal});
    const body=await response.json();if(!response.ok)throw Error(body.error||t('operationFailed'));return body.result;
  }
  function App(){
    React.useSyncExternalStore?.(locale.subscribe.bind(locale),locale.getSnapshot.bind(locale));
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
    const clientRef=React.useRef(null);const loadSequence=React.useRef(0);const dialogRef=React.useRef(null);const mutationRef=React.useRef(false);const sessionRevisionRef=React.useRef('');const sessionsRef=React.useRef([] as any[]);
    const ui=createUI(React,busy,setError);
    const client=()=>{if(!clientRef.current){const boot=window.__BOT_INTEGRATION__;if(!boot)throw Error(t('serviceNotReady'));clientRef.current=new AdminClient(boot);}return clientRef.current as AdminClient;};
    const query=async(name:string,input:any={},signal?:AbortSignal)=>client().query(name,input,signal);
    const refresh=async()=>{const next:any=await query('overview.summary');if(next){let merged={...next,sessions:next.sessions??sessionsRef.current};if(next.sessionRevision&&next.sessionRevision!==sessionRevisionRef.current){sessionRevisionRef.current=next.sessionRevision;try{const page:any=await query('overview.sessions',{limit:100});sessionsRef.current=page?.items??[];merged={...next,sessions:sessionsRef.current};}catch{/* session details are optional; summary remains usable */}}setSummary(merged);setSummaryError('');}};
    const refreshProfiles=async(signal?:AbortSignal)=>{const next=await loadServiceProfiles(query,signal,t);if(!signal?.aborted)setServiceProfiles(next);return next;};
    const refreshLibrary=async(signal?:AbortSignal)=>{const next:any=await query('service.settings',{},signal);if(next&&!signal?.aborted){setVoiceLibrary(next);setVoiceLibraryDraft({modelsRoot:next.modelsRoot,gptSovitsUrl:next.gptSovitsUrl,breezeTtsUrl:next.breezeTtsUrl??'http://127.0.0.1:8080',gptSovitsProjectRoot:next.gptSovitsProjectRoot??'',breezeTtsProjectRoot:next.breezeTtsProjectRoot??'',breezeTtsVoicesRoot:next.breezeTtsVoicesRoot??''});}};
    const refreshBots=async()=>{client().invalidate('bots.list');const next=await query('bots.list');if(next)setBots(next);};
    const refreshImageStatus=async(signal?:AbortSignal)=>{const next=await api('skill.image.status',{},signal);if(!signal?.aborted)setImageSkills(next);};
    const mutate=async(action:string,input:any={},message=t('saved'))=>{
      if(mutationRef.current)throw Error(t('operationBusy'));mutationRef.current=true;setBusy(true);setError('');setNotice('');
      try{
        const result=await api(action,input);
        if(action.startsWith('config.'))client().invalidate('catalog.config',{id:input.id??input.config?.id});
        if(action.startsWith('automation.'))client().invalidate('automation.list');
        setNotice(message);
        // Refresh failures must not turn a successful write into an apparent failed save.
        try{await refresh();if(action.startsWith('bot.'))await refreshBots();if(action.startsWith('config.'))await refreshImageStatus();}catch{setError(t('refreshFailed'));}
        return result;
      }finally{mutationRef.current=false;setBusy(false);}
    };
    const ask=(title:string,value=''):Promise<string|null>=>new Promise(resolve=>setQuestion({title,value,resolve,confirm:false}));
    const confirm=(title:string):Promise<boolean>=>new Promise(resolve=>setQuestion({title,value:'',resolve,confirm:true}));
    const answer=(value:any)=>{question?.resolve(value);setQuestion(null);};
    const navigate=(next:string)=>{setTab(next);if(next==='automation')setAutomationVisited(true);setError('');setNotice('');};
    const loadConfig=async(id:string)=>{
      if(dirty&&!await confirm(t('unsavedPersonaSwitch')))return;
      const sequence=++loadSequence.current;setConfigLoading(true);setError('');setNotice('');
      try{const config=await query('catalog.config',{id});if(config&&sequence===loadSequence.current){setEdit(config);setDirty(false);}}
      finally{if(sequence===loadSequence.current)setConfigLoading(false);}
    };
    React.useEffect(()=>{let stopped=false,running=false;const poll=async()=>{if(running)return;running=true;try{await refresh();}catch(e){if(!stopped)setSummaryError((e as Error).message);}finally{running=false;}};
      void poll();const timer=setInterval(()=>{if(!stopped)void poll();},4000);return()=>{stopped=true;clearInterval(timer);clientRef.current?.cancel('overview.summary');};},[]);
    React.useEffect(()=>{if(tab!=='bots')return;const abort=new AbortController();void query('bots.list',{},abort.signal).then((next:any)=>{if(next&&!abort.signal.aborted)setBots(next);}).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});void api('directories',{},abort.signal).then(setDirectories).catch(()=>{});return()=>abort.abort();},[tab]);
    React.useEffect(()=>{if(tab!=='catalog'&&tab!=='services'&&tab!=='overview')return;const abort=new AbortController();if(tab==='catalog')for(const [action,set] of [['directories',setDirectories],['skill.image.status',setImageSkills],['skill.media.status',setMediaSkills]] as const){void api(action,{},abort.signal).then((next:any)=>{if(abort.signal.aborted)return;if(action==='skill.media.status')setMediaSkills((old:any)=>Object.fromEntries(Object.entries(next).map(([id,status])=>[id,{...(old[id]??{}),...(status as any)}])));else set(next);}).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});}
      if(tab==='catalog'){
        void query('catalog.models',{},abort.signal).then((next:any)=>{if(!next||abort.signal.aborted)return;const groups=new Map();for(const model of next.data??next){const rows=groups.get(model.provider)??[];rows.push({id:model.model,name:model.model,inputModalities:model.inputModalities,reasoning:model.reasoning});groups.set(model.provider,rows);}setModels([...groups].map(([id,models])=>({id,models})));}).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});
        void refreshProfiles(abort.signal).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});
      }
      void refreshLibrary(abort.signal).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});
      return()=>abort.abort();},[tab]);
    const configs=(summary?.configs??[]).filter((c:any)=>!c.archived);
    React.useEffect(()=>{if(tab==='catalog'&&!edit&&configs[0])void loadConfig(configs[0].id).catch((e:Error)=>setError(e.message));},[tab,configs[0]?.id]);
    React.useEffect(()=>{if(!qr?.attempt||qr.status!=='pending')return;const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;
      const poll=async()=>{try{const next=await api('login.poll',{attempt:qr.attempt},abort.signal);if(abort.signal.aborted)return;if(next.status!=='pending'){setQr((old:any)=>({...old,status:next.status}));await refresh();await refreshBots();return;}timer=setTimeout(()=>void poll(),2000);}catch(e){if(!abort.signal.aborted)setError((e as Error).message);}};void poll();return()=>{abort.abort();clearTimeout(timer);};},[qr?.attempt]);
    React.useEffect(()=>{if(!question)return;const previous=document.activeElement as HTMLElement|null;dialogRef.current?.querySelector('textarea,button')?.focus();return()=>previous?.focus();},[!!question]);
    React.useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
    const channels=summary?.channels?.length?summary.channels:[{id:'qq',displayName:t('qqOfficial'),capabilities:{login:['qr','credentials']}},{id:'weixin',displayName:t('weixinIlink'),capabilities:{login:['qr']}}];
    const summaryBots=(summary?.bots??[]).filter((b:any)=>!b.archived);
    const displayBots=(bots??summaryBots).filter((b:any)=>!b.archived).map((b:any)=>({...b,...summaryBots.find((s:any)=>s.id===b.id)}));
    const channelName=(id:string)=>channels.find((c:any)=>c.id===id)?.displayName??id;
    const badge=(bot:any)=>h('span',{className:`badge${bot.status==='error'?' warning':''}`},botStatus(bot.status,t));
    const identity=(bot:any)=>h('div',{className:'identity'},h('span',{className:'avatar','aria-hidden':true},bot.channel==='qq'?'Q':'W'),h('div',null,h('strong',null,bot.name),h('p',{className:'muted'},channelName(bot.channel))));
    const login=async(bot:any)=>{const next=await mutate('login.begin',{id:bot.id},t('scanToAuthorize'));setQr({...next,botId:bot.id});};
    const pickDirectory=async(current:string|undefined)=>{const result=await api('service.settings.pick-directory',{current:current||undefined});return typeof result?.path==='string'?result.path:undefined;};
    const tabs=[['overview',t('overview')],['bots',t('bots')],['services',t('services')],['catalog',t('personas')],['automation',t('automation')]];
    const overviewServices=h('section',{className:'card overview-services'},
      h('div',{className:'row spread'},h('h3',null,t('services')),ui.button(t('manage'),()=>navigate('services'),{className:'quiet'})),
      h('div',{className:'overview-service-grid'},
        h('div',{className:'overview-service-item'},h('strong',null,t('robotService')),h('span',{className:'badge'},summary?.health?.serviceRunning===true?t('online'):t('stopped'))),
        h('div',{className:'overview-service-item'},h('strong',null,'GPT-SoVITS'),h('span',{className:'badge'},serviceHealth['gpt-sovits']?.state==='ready'?t('serviceReady'):t('serviceUnavailable'))),
        h('div',{className:'overview-service-item'},h('strong',null,'Breeze TTS'),h('span',{className:'badge'},serviceHealth['breeze-tts']?.state==='ready'?t('serviceReady'):t('serviceUnavailable'))),
        h('div',{className:'overview-service-item'},h('strong',null,t('stsModelDirectory')),h('span',{className:'badge'},voiceLibrary?.modelsRoot?t('configured'):t('pendingConfig'))),
      ),
    );
    let body:any;
    if(tab==='overview')body=h('section',{'aria-label':t('overview')},
      summary?h('div',{className:'stats-cards'},...[
        [t('onlineCount'),`${summaryBots.filter((b:any)=>b.status==='connected').length} / ${summaryBots.length}`],[t('tasks'),summary.health.activeTasks],[t('pending'),summary.counts.pendingDeliveries]
      ].map(([label,value])=>h('div',{className:'stats-card',key:label},h('small',null,label),h('strong',null,value)))):h('p',{role:'status'},t('loading')),
      h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,t('connections')),ui.button(t('manage'),()=>navigate('bots'),{className:'quiet'})),...summaryBots.map((bot:any)=>h('div',{key:bot.id,className:'item row spread'},identity(bot),badge(bot))),summary&&!summaryBots.length?h('p',{className:'empty'},t('noBots')):null),
      summary?.sessions?.length?h('section',{className:'card'},h('h3',null,t('sessionModels')),...summary.sessions.slice(0,100).map((session:any)=>{const model=session.effectiveModel??session.modelOverride??session.model;return h('div',{className:'item row spread',key:session.id},h('span',null,t('sessionModel',{channel:session.channelId??session.platform??t('unknown'),model:model?`${model.provider} / ${model.model}`:t('none')})),h('small',{className:'muted'},session.personaId??''));})):null,
      overviewServices,
      h('section',{className:'card'},h('h3',null,t('quickActions')),h('div',{className:'actions'},ui.button(t('newBot'),()=>navigate('bots'),{className:'primary'}),ui.button(t('createPersona'),()=>navigate('catalog')),ui.button(t('openServiceSettings'),()=>navigate('services')))),
      h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,t('usage')),ui.button(stats?t('collapse'):t('statistics'),()=>setStats(!stats),{'aria-expanded':stats,'aria-controls':'bot-statistics',className:'quiet'})),h('div',{id:'bot-statistics'},h(StatisticsPanel,{React,api,bots:summaryBots,t,compact:!stats,onError:setError}))));
    if(tab==='bots'){
      const createForm=newOpen?h('section',{className:'card create-form'},h('h3',null,t('newBot')),h('div',{className:'fields'},ui.field(t('id'),newBot.id,v=>setNewBot({...newBot,id:v})),ui.field(t('name'),newBot.name,v=>setNewBot({...newBot,name:v})),ui.select(t('channel'),newBot.channel,channels.map((c:any)=>({id:c.id,name:c.displayName})),v=>setNewBot({...newBot,channel:v})),ui.select(t('persona'),newBot.configId,configs,v=>setNewBot({...newBot,configId:v}))),ui.button(t('create'),async()=>{if(!newBot.id.trim()||!newBot.name.trim())throw Error(t('requiredBotFields'));await mutate('bot.save',newBot,t('created'));setNewOpen(false);setNewBot({...newBot,id:'',name:''});},{className:'primary'})):null;
      const credentialForm=credential?h('section',{className:'card','aria-label':t('qqCredentials')},h('h3',null,t('qqCredentials')),h('div',{className:'fields'},ui.field('AppID',credential.accountId,v=>setCredential({...credential,accountId:v})),ui.field('AppSecret',credential.appSecret,v=>setCredential({...credential,appSecret:v}),'password',{autoComplete:'new-password'})),h('div',{className:'actions'},ui.button(t('save'),async()=>{await mutate('bot.credentials',{id:credential.id,credential:{accountId:credential.accountId,appSecret:credential.appSecret}},t('credentialsSaved'));setCredential(null);},{className:'primary'}),ui.button(t('cancel'),()=>setCredential(null)))):null;
      const qrForm=qr?h('section',{className:'card','aria-label':t('scanAuth')},h('div',{className:'row spread'},h('h3',null,t('scanAuth')),ui.button(t('close'),()=>setQr(null))),h('p',{role:'status'},({pending:t('waitingScan'),confirmed:t('authSucceeded'),expired:t('qrExpired'),denied:t('cancelled')} as any)[qr.status]),qr.status==='pending'?h('img',{src:qr.qrImage,width:240,height:240,alt:t('qrAlt')}):null):null;
      body=BotsPanel({React,ui,t,bots:displayBots,configs,channels,summary,busy,selectedBotId,onSelect:setSelectedBotId,onCreate:()=>setNewOpen(!newOpen),createForm,onServiceToggle:()=>mutate(summary?.health?.serviceRunning===true?'bot.service.stop':'bot.service.start',{},summary?.health?.serviceRunning===true?t('botServiceStopped'):t('botServiceStarted')),onBotToggle:(bot:any,running:boolean)=>mutate(running?'bot.stop':'bot.start',{id:bot.id},running?t('stopped'):t('connectionStarted')),onPersonaChange:(bot:any,configId:string)=>mutate('bot.save',{...bot,configId},t('switchedNextTurn')),onReconnect:(bot:any)=>mutate('bot.reconnect',{id:bot.id},t('reconnected')),onAuthorize:login,onCredentials:(bot:any)=>setCredential({id:bot.id,accountId:bot.accountId,appSecret:''}),onDelete:async(bot:any)=>{if(!await confirm(t('deleteBotConfirm',{name:bot.name,id:bot.id})))return;setQr((current:any)=>current?.botId===bot.id?null:current);setCredential((current:any)=>current?.id===bot.id?null:current);await mutate('bot.delete',{id:bot.id},t('botDeleted'));setSelectedBotId('');setWorkspaceEdits((current:any)=>{const next={...current};delete next[bot.id];return next;});},onWorkingDirectoryChange:(bot:any,value:string)=>setWorkspaceEdits({...workspaceEdits,[bot.id]:value}),onBrowseDirectory:async(bot:any)=>{const value=await pickDirectory(workspaceEdits[bot.id]??bot.workingDirectory);if(value)setWorkspaceEdits({...workspaceEdits,[bot.id]:value});},onDefaultDirectory:(bot:any)=>setWorkspaceEdits({...workspaceEdits,[bot.id]:''}),onSaveWorkingDirectory:async(bot:any)=>{await mutate('bot.save',{...bot,workingDirectory:workspaceEdits[bot.id]??bot.workingDirectory??''});setWorkspaceEdits((old:any)=>{const next={...old};delete next[bot.id];return next;});},workspaceEdits,onAddTrustedUser:async(bot:any)=>{const users=list(bot.trustedUsers);const value=await ask(t('userId'));const next=value?.trim();if(next&&!users.includes(next))await mutate('bot.save',{...bot,trustedUsers:[...users,next]},t('saved'));},onRemoveTrustedUser:(bot:any,user:string)=>{const users=list(bot.trustedUsers).filter(item=>item!==user);return mutate('bot.save',{...bot,trustedUsers:users},t('saved'));},credential,credentialForm,qr,qrForm});
    }
    if(tab==='catalog'){
      const selected=edit?{...edit,tools:list(edit.tools),skills:list(edit.skills),hostTools:list(edit.hostTools),media:edit.media??{}}:null;
      const editor=selected??{id:'',name:'',revision:1,personaPrompt:'',model:null,tools:[],skills:[],hostTools:[],allowHostTools:false,media:{},imageStyle:'',progressReply:{enabled:false,intervalSeconds:60}};
      const update=(patch:any)=>{setEdit({...selected,...patch});setDirty(true);setNotice('');};const existing=selected&&configs.some((c:any)=>c.id===selected.id);const personaFile=directories.personas.find((p:any)=>p.id===selected?.id);const progressReply=selected?.progressReply??{enabled:true,intervalSeconds:60};const setProgressReply=(patch:any)=>update({progressReply:{...progressReply,...patch}});
      const applyVoiceModel=(role:VoiceModelRole,profile:any)=>{if(selected)update(useVoiceModel(selected,role,profile,t));};
      const modelPicker=(role:VoiceModelRole,serviceId?:string)=>h('div',null,voiceModelPicker(h,ui,{role,config:editor,profiles:serviceProfiles,busy,dirty,existing:!!existing,serviceId,apply:applyVoiceModel},t),ui.button(t('refresh'),async()=>{const services=role==='voice'?['gpt-sovits','breeze-tts']:['rvc'];for(const serviceId of services)await mutate('service.refresh',{serviceId},t('refreshed'));await refreshProfiles();}));
      /* Service connection settings live in the Services tab. */
      const newConfig=async()=>{if(dirty&&!await confirm(t('discardAndCreate')))return;++loadSequence.current;setConfigLoading(false);setEdit({schemaVersion:4,id:'',name:'',revision:1,personaPrompt:t('defaultPersonaPrompt'),model:null,media:{voice:{enabled:false,protocol:'edge_tts',replyMode:'on_demand',format:'mp3',voice:'zh-CN-XiaoxiaoNeural'}},tools:['bot_media','bot_voice','bot_send_file','bot_remember','bot_forget_memory','bot_read_social'],skills:['image-generation','media-analysis','voice-generation'],allowHostTools:false,hostTools:[],imageStyle:'',progressReply:{enabled:true,intervalSeconds:60},archived:false});setDirty(true);setSection('basic');};
      const copyConfig=async()=>{if(!existing)return;const newId=await ask(t('personaId'));if(!newId?.trim())return;const name=await ask(t('name'),`${selected.name} ${t('copySuffix')}`);if(!name?.trim())return;const result=await mutate('config.copy',{id:selected.id,newId:newId.trim(),name:name.trim()},t('personaCopied'));setEdit(result);setDirty(false);};
      const fileApply=async(id:string)=>{if(dirty&&!await confirm(t('applyFilesConfirm')))return;const result=await mutate('config.files.apply',{id},t('filesApplied'));setEdit(result);setDirty(false);};
       if(selected){
       const groupedChecklist=(kind:'tools'|'skills',values:string[],change:(values:string[])=>void)=>h('div',{className:'capability-groups'},...capabilityGroups(kind).map(group=>h('section',{className:'section-card',key:group.id},h('h4',null,group.label),h('div',{className:'checklist-options'},...group.items.map(value=>h('label',{key:value,className:'check-item'},h('input',{type:'checkbox',checked:values.includes(value),disabled:busy,onChange:()=>change(values.includes(value)?values.filter(item=>item!==value):[...values,value])}),h('span',null,value)))))));
       const modelForReasoning=models.find((provider:any)=>provider.id===editor.model?.provider)?.models.find((item:any)=>item.id===editor.model?.model);
      const reasoningEfforts=modelForReasoning?.reasoning?.efforts??[];
      const basicSection=h('div',{className:'section-grid'},
        h('section',{className:'section-card'},
          h('h3',null,t('identityModel')),
          h('div',{className:'fields'},
            !existing?ui.field(t('id'),editor.id,v=>update({id:v})):null,
            ui.field(t('name'),editor.name,v=>update({name:v})),
            ui.select(t('provider'),editor.model?.provider??'',[{id:'',name:t('select')},...models],v=>update({model:v?{provider:v,model:''}:null})),
            ui.select(t('model'),editor.model?.model??'',[{id:'',name:t('select')},...(models.find((p:any)=>p.id===editor.model?.provider)?.models??[])],v=>update({model:{...editor.model,model:v,reasoningEffort:undefined}})),
          ),
           ui.details(t('advanced'),ui.select(t('reasoningEffort'),editor.model?.reasoningEffort??'', [{id:'',name:t('select')},...reasoningEfforts.map((effort:string)=>({id:effort,name:effort}))],v=>update({model:editor.model?{...editor.model,reasoningEffort:v||undefined}:null}),{disabled:!editor.model||reasoningEfforts.length===0})),
        ),
      );
       const behaviorSection=h('div',{className:'section-grid'},h('section',{className:'section-card'},h('h3',null,t('behavior')),ui.textarea(t('personaPrompt'),editor.personaPrompt,v=>update({personaPrompt:v})),ui.toggle(t('processingReply'),progressReply.enabled,()=>setProgressReply({enabled:!progressReply.enabled})),progressReply.enabled?ui.field(t('processingReplyInterval'),String(progressReply.intervalSeconds),v=>setProgressReply({intervalSeconds:Number(v)}),'number',{min:10,max:3600,step:1}):null));
       const toolsSection=h('div',{className:'section-grid'},groupedChecklist('tools',editor.tools,values=>update({tools:values})),groupedChecklist('skills',editor.skills,values=>update({skills:values})),h('section',{className:'section-card'},ui.toggle(t('hostPermission'),editor.allowHostTools,()=>update({allowHostTools:!editor.allowHostTools})),editor.allowHostTools?ui.field(t('hostTools'),editor.hostTools.join(', '),v=>update({hostTools:v.split(',').map(x=>x.trim()).filter(Boolean)})):null));
      const mediaSection=h('div',{className:'section-grid'},...['image','asr','video','voice'].map(role=>{
         const options=editor.media[role]??{},status=role==='image'?imageSkills[editor.id]:mediaSkills[editor.id]?.[role],label=({image:t('image'),asr:t('asr'),video:t('video'),voice:t('voiceTts')} as any)[role],enabled=role==='voice'?options.enabled===true:options.enabled!==false,ready=status?.keyConfigured||status?.configured;
         const set=(patch:any)=>update({media:{...editor.media,[role]:{...options,...patch}},...(role==='voice'&&patch.enabled===true?{tools:[...new Set([...editor.tools,'bot_voice'])],skills:[...new Set([...editor.skills,'voice-generation'])]}:{})});
        const imageModels=role==='image'?models.flatMap((provider:any)=>provider.models.filter((model:any)=>model.inputModalities?.includes('image')).map((model:any)=>({id:model.id,name:`${provider.id} / ${model.name}`}))):[];
        const voiceEngine=role==='voice'?(options.engine??(options.protocol==='edge_tts'?'edge_tts':options.profileRef?.serviceId??'')):'';
        const voiceService=role==='voice'&&voiceEngine!=='edge_tts'?voiceEngine:undefined;
        const voicePicker=role==='voice'?(voiceService?modelPicker('voice',voiceService):options.protocol==='edge_tts'?ui.select(t('builtinVoice'),options.voice??'zh-CN-XiaoxiaoNeural',[{id:'zh-CN-XiaoxiaoNeural',name:t('voiceXiaoxiao')},{id:'zh-CN-YunxiNeural',name:t('voiceYunxi')},{id:'en-US-AriaNeural',name:t('voiceAria')},{id:'ja-JP-NanamiNeural',name:t('voiceNanami')}],v=>set({voice:v||undefined})):null):null;
          const fields=role==='image'?[imageModels.length?ui.select(t('model'),options.model??'', [{id:'',name:t('inheritModel')},...imageModels],v=>set({model:v||undefined})):ui.field(t('model'),options.model??'',v=>set({model:v})),ui.field(t('serviceAddress'),options.baseUrl??'',v=>set({baseUrl:v.trim()||undefined}),'url',{placeholder:t('inheritAddress')}),ui.field(t('keyEnv'),options.keyEnv??'',v=>set({keyEnv:v.trim()||undefined}),'text',{placeholder:t('inheritKeyEnv'),autoComplete:'off',spellCheck:false}),ui.textarea(t('imageStyle'),editor.imageStyle,v=>update({imageStyle:v})),h('small',{className:'sr-only'},t('keyEnvHint'))]:role==='voice'?[ui.select(t('engine'),voiceEngine,[{id:'',name:t('select')},{id:'edge_tts',name:'Edge TTS'},{id:'gpt-sovits',name:'GPT-SoVITS'},{id:'breeze-tts',name:'Breeze TTS'}],v=>v==='edge_tts'?set({engine:'edge_tts',protocol:'edge_tts',profileRef:undefined,format:'mp3',voice:'zh-CN-XiaoxiaoNeural'}):set({engine:v||undefined,protocol:undefined,profileRef:options.profileRef?.serviceId===v?options.profileRef:undefined,format:'wav',voice:undefined})),ui.select(t('reply'),options.replyMode??'on_demand',[{id:'on_demand',name:t('onDemand')},{id:'auto',name:t('textAndVoice')}],v=>set({replyMode:v}))]:[role==='asr'?ui.select(t('protocol'),options.protocol??'chat_completions',[{id:'chat_completions',name:t('chatProtocol')},{id:'transcriptions',name:t('transcriptionProtocol')}],v=>set({protocol:v})):null];
          return h('section',{key:role,className:'section-card media-card'},ui.toggle(label,enabled,()=>set({enabled:!enabled})),enabled?h('div',{className:'detail-body'},...fields,role!=='voice'?h('p',{className:'muted'},dirty?t('unsaved'):!status?t('loadingShort'):ready?t('configured'):t('pendingConfig')):null,ui.button(t('restoreDefault'),()=>{const media={...editor.media};delete media[role];update({media});},{className:'quiet'})):null,role==='voice'?voicePicker:null);
       }),musicCard(h,ui,editor,serviceProfiles,update,t),singingCard(h,ui,editor,update,modelPicker('singing'),null,t));
       const filesSection=h('div',{className:'section-grid'},h('section',{className:'section-card'},h('div',{className:'row spread'},h('h3',null,t('configFiles')),h('span',{className:'badge'},personaFile?.state==='error'?t('notSynced'):personaFile?.state==='draft'?t('hasDraft'):t('synced'))),existing?h('div',{className:'actions'},ui.button(t('openDirectory'),()=>mutate('config.directory.open',{configId:editor.id},t('openedDirectory'))),ui.button(t('applyFiles'),()=>fileApply(editor.id))):null,personaFile?.error?h('p',{className:'error',role:'alert'},personaFile.error):null,ui.details(t('pathAndId'),h('small',{className:'path'},personaFile?.directory??t('generatedAfterSave')),h('small',null,`ID · ${editor.id}`))));
      const savePersona=async()=>{if(!selected.id.trim()||!selected.name.trim())throw Error(t('requiredBotFields'));const next=await mutate('config.save',{config:selected,expectedRevision:selected.revision},t('savedNextTurn'));setEdit(next);setDirty(false);};
      const discardPersona=async()=>{if(existing){const next=await query('catalog.config',{id:selected.id});setEdit(next);setDirty(false);}else{setEdit(null);setDirty(false);}};
       body=personaPanel({h,ui,t,configs:configs.map((config:any)=>({...config,relatedBots:summaryBots.filter((bot:any)=>bot.configId===config.id).length})),selected,existing:!!existing,busy,configLoading,dirty,section:section as PersonaEditorSection,relatedBots:summaryBots.filter((bot:any)=>bot.configId===selected?.id).length,sections:{basic:basicSection,behavior:behaviorSection,tools:toolsSection,media:mediaSection,files:filesSection},selectPersona:loadConfig,createPersona:newConfig,copyPersona:copyConfig,importPersona:async()=>{const id=await ask(t('personaId'));if(id)await fileApply(id);},setSection:(next:PersonaEditorSection)=>setSection(next),save:savePersona,discard:discardPersona});
       }else body=personaPanel({h,ui,t,configs,selected:null,existing:false,busy,configLoading,dirty,section:section as PersonaEditorSection,relatedBots:0,sections:{},selectPersona:loadConfig,createPersona:newConfig,copyPersona:copyConfig,importPersona:async()=>{const id=await ask(t('personaId'));if(id)await fileApply(id);},setSection:(next:PersonaEditorSection)=>setSection(next),save:async()=>{},discard:async()=>{setDirty(false);}});
    }
    if(tab==='services'){
      const settings=voiceLibraryDraft&&voiceLibrary;
      const settingsDirty=!!settings&&(voiceLibraryDraft.modelsRoot!==voiceLibrary.modelsRoot||voiceLibraryDraft.gptSovitsUrl!==voiceLibrary.gptSovitsUrl||voiceLibraryDraft.breezeTtsUrl!==voiceLibrary.breezeTtsUrl||voiceLibraryDraft.gptSovitsProjectRoot!==voiceLibrary.gptSovitsProjectRoot||voiceLibraryDraft.breezeTtsProjectRoot!==voiceLibrary.breezeTtsProjectRoot||voiceLibraryDraft.breezeTtsVoicesRoot!==voiceLibrary.breezeTtsVoicesRoot);
      const choose=async(key:'modelsRoot'|'gptSovitsProjectRoot'|'breezeTtsProjectRoot'|'breezeTtsVoicesRoot')=>{if(!voiceLibraryDraft)return;setBusy(true);setError('');try{const result=await pickDirectory(voiceLibraryDraft[key]||undefined);if(result){const next={...voiceLibraryDraft,[key]:result};if(key==='breezeTtsProjectRoot'&&!voiceLibraryDraft.breezeTtsVoicesRoot)next.breezeTtsVoicesRoot=`${result.replace(/[\\/]$/,'')}\\voices`;setVoiceLibraryDraft(next);}}catch(error){setError((error as Error).message);}finally{setBusy(false);}};
      const saveSettings=async()=>{if(!voiceLibraryDraft||!voiceLibrary)return;await mutate('service.settings.save',{...voiceLibraryDraft,expectedRevision:voiceLibrary.revision},t('saved'));await refreshLibrary();await refreshProfiles();setServiceHealth({});};
      const refreshServices=async()=>{for(const serviceId of ['rvc','gpt-sovits','breeze-tts'])await mutate('service.refresh',{serviceId},t('refreshed'));await refreshProfiles();};
      const start=async(serviceId:'gpt-sovits'|'breeze-tts')=>{if(settingsDirty){setError(t('saveServiceFirst'));return;}setBusy(true);setError('');setNotice('');try{const result:any=await api('service.start',{serviceId},AbortSignal.timeout(60_000));const data=result?.data;if(data)setServiceHealth((old:any)=>({...old,[serviceId]:{...data,state:data.state==='already-running'?'ready':data.state}}));if(data?.state==='already-running')setNotice(t('serviceAlreadyRunning'));else setNotice(t('serviceStarted'));await refreshLibrary();await refreshProfiles();}catch(error){setError((error as Error).message);}finally{setBusy(false);}};
      body=ServicesPanel({React,ui,t,summary,settings, draft:voiceLibraryDraft,dirty:settingsDirty,busy,health:serviceHealth,onDraftChange:(patch:any)=>setVoiceLibraryDraft({...voiceLibraryDraft,...patch}),onSave:saveSettings,onRefresh:refreshServices,onStart:start,onPickDirectory:choose,onToggleRobotService:()=>mutate(summary?.health?.serviceRunning===true?'bot.service.stop':'bot.service.start',{},summary?.health?.serviceRunning===true?t('botServiceStopped'):t('botServiceStarted'))});
    }
    if(tab==='automation')body=null;
    const errors=[summaryError,error].filter(Boolean);
    const running=summary?.health?.serviceRunning===true;
    const nav=panelSidebar(h,{label:t('panelNavigation'),items:tabs.map(([id,label])=>({id,label})),active:tab,disabled:busy,onNavigate:navigate});
    const header=panelHeader(h,{title:t('panelTitle'),status:h('div',{className:'global-status'},statusPill(h,running?t('online'):t('stopped'),running?'success':'neutral'),ui.button(running?t('stopBotService'):t('startBotService'),()=>mutate(running?'bot.service.stop':'bot.service.start',{},running?t('botServiceStopped'):t('botServiceStarted')),{className:'quiet',disabled:busy||!summary?.health,'aria-label':running?t('stopBotService'):t('startBotService')}))});
    const content=h('div',{className:'app-content'},header,errors.length?h('div',{className:'error',role:'alert'},[...new Set(errors)].join('\n')):null,notice?h('div',{className:'notice',role:'status'},notice):null,body,
      automationVisited?h('div',{hidden:tab!=='automation'},h(AutomationPanel,{React,query,mutate,configs,bots:summaryBots,confirm,onError:setError,busy,t,active:tab==='automation'})):null,
      question?h('div',{className:'dialog-backdrop'},h('form',{ref:dialogRef,className:'card dialog',role:'dialog','aria-modal':true,'aria-label':question.title,onSubmit:(event:any)=>{event.preventDefault();answer(question.confirm?true:question.value);},onKeyDown:(event:any)=>{if(event.key==='Escape'){event.preventDefault();answer(question.confirm?false:null);}if(event.key==='Tab'){const nodes=Array.from(dialogRef.current?.querySelectorAll('textarea,button:not(:disabled)')??[]) as HTMLElement[];const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}},h('h3',null,question.title),question.confirm?null:ui.textarea(t('content'),question.value,v=>setQuestion({...question,value:v})),h('div',{className:'actions'},h('button',{type:'submit',className:'primary'},t('confirm')),ui.button(t('cancel'),()=>answer(question.confirm?false:null),{disabled:false})))):null);
    return h('main',{className:'bot-admin'},h('style',null,panelStyles),h('div',{className:'app-shell'},nav,h('div',{className:'app-main'},content)));
  }
  return {inject:['slots','locale'],apply(ctx:any){locale=ctx.locale;ctx.effect(()=>ctx.locale.register(LOCALE_NS,{zh,en:zh}));t=ctx.locale.bind(LOCALE_NS);ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'bot-integration',order:35,label:()=>t('nav'),locale:LOCALE_NS},App));}};
}});
