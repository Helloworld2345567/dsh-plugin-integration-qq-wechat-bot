import {StatisticsPanel} from './statistics.js';
import {AutomationPanel} from './automation.js';
import {AdminClient} from './admin-client.js';
import {panelStyles} from './styles.js';
import {botStatus,createUI,list} from './ui.js';
import {singingCard} from './singing.js';
import {musicCard} from './music.js';
import {loadServiceProfiles,useVoiceModel,voiceModelPicker,type VoiceModelRole} from './voice-models.js';
import {LOCALE_NS,chinese,zh,type Translate} from './locale.js';

/* Use the Harness module loader's React instance. */
declare const window:Window & {__ModuleLoader__:any;__BOT_INTEGRATION__?:{endpoint:string;token:string}};
window.__ModuleLoader__.load({id:'dsh-plugin-integration-qq-wechat-bot',factory(require:(id:string)=>any){
  const React=require('react');const h=React.createElement;let t:Translate=chinese;let locale:any;
  async function api(action:string,input:any={},signal?:AbortSignal){
    const boot=window.__BOT_INTEGRATION__;if(!boot)throw Error(t('serviceNotReady'));
    const strictCommand=action==='service.refresh'||action==='service.settings.save';
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
    const [voiceLibrary,setVoiceLibrary]=React.useState(null);const [voiceLibraryDraft,setVoiceLibraryDraft]=React.useState(null);
    const clientRef=React.useRef(null);const loadSequence=React.useRef(0);const dialogRef=React.useRef(null);const mutationRef=React.useRef(false);
    const ui=createUI(React,busy,setError);
    const client=()=>{if(!clientRef.current){const boot=window.__BOT_INTEGRATION__;if(!boot)throw Error(t('serviceNotReady'));clientRef.current=new AdminClient(boot);}return clientRef.current as AdminClient;};
    const query=async(name:string,input:any={},signal?:AbortSignal)=>client().query(name,input,signal);
    const refresh=async()=>{const next=await query('overview.summary');if(next){setSummary(next);setSummaryError('');}};
    const refreshProfiles=async(signal?:AbortSignal)=>{const next=await loadServiceProfiles(query,signal,t);if(!signal?.aborted)setServiceProfiles(next);};
    const refreshLibrary=async(signal?:AbortSignal)=>{const next:any=await query('service.settings',{},signal);if(next&&!signal?.aborted){setVoiceLibrary(next);setVoiceLibraryDraft({modelsRoot:next.modelsRoot,gptSovitsUrl:next.gptSovitsUrl});}};
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
    React.useEffect(()=>{if(tab!=='catalog')return;const abort=new AbortController();for(const [action,set] of [['directories',setDirectories],['skill.image.status',setImageSkills],['skill.media.status',setMediaSkills]] as const){void api(action,{},abort.signal).then((next:any)=>{if(abort.signal.aborted)return;if(action==='skill.media.status')setMediaSkills((old:any)=>Object.fromEntries(Object.entries(next).map(([id,status])=>[id,{...(old[id]??{}),...(status as any)}])));else set(next);}).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});}
      void query('catalog.models',{},abort.signal).then((next:any)=>{if(!next||abort.signal.aborted)return;const groups=new Map();for(const model of next.data??next){const rows=groups.get(model.provider)??[];rows.push({id:model.model,name:model.model,inputModalities:model.inputModalities,reasoning:model.reasoning});groups.set(model.provider,rows);}setModels([...groups].map(([id,models])=>({id,models})));}).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});
      void refreshProfiles(abort.signal).catch((e:Error)=>{if(!abort.signal.aborted)setError(e.message);});
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
    const tabs=[['overview',t('overview')],['bots',t('bots')],['catalog',t('personas')],['automation',t('automation')]];
    let body:any;
    if(tab==='overview')body=h('section',{'aria-label':t('overview')},
      summary?h('div',{className:'stats-cards'},...[
        [t('onlineCount'),`${summaryBots.filter((b:any)=>b.status==='connected').length} / ${summaryBots.length}`],[t('tasks'),summary.health.activeTasks],[t('pending'),summary.counts.pendingDeliveries]
      ].map(([label,value])=>h('div',{className:'stats-card',key:label},h('small',null,label),h('strong',null,value)))):h('p',{role:'status'},t('loading')),
      h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,t('connections')),ui.button(t('manage'),()=>navigate('bots'),{className:'quiet'})),...summaryBots.map((bot:any)=>h('div',{key:bot.id,className:'item row spread'},identity(bot),badge(bot))),summary&&!summaryBots.length?h('p',{className:'empty'},t('noBots')):null),
      h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,t('usage')),ui.button(stats?t('collapse'):t('statistics'),()=>setStats(!stats),{'aria-expanded':stats,'aria-controls':'bot-statistics',className:'quiet'})),h('div',{id:'bot-statistics'},h(StatisticsPanel,{React,api,bots:summaryBots,t,compact:!stats,onError:setError}))));
    const botCard=(bot:any)=>{
      const management=bots?h(React.Fragment,null,
        ui.toggle(t('run'),bot.enabled,()=>mutate(bot.enabled?'bot.stop':'bot.start',{id:bot.id},bot.enabled?t('stopped'):t('connectionStarted'))),
        ui.select(t('persona'),bot.configId,configs,v=>mutate('bot.save',{...bot,configId:v},t('switchedNextTurn'))),h('small',null,t('personaKeepsHistory')),
        ui.details(t('usersCount',{count:list(bot.trustedUsers).length}),h('p',{className:'muted'},list(bot.trustedUsers).join('，')||t('none')),ui.button(t('edit'),async()=>{const value=await ask(t('userIds'),list(bot.trustedUsers).join(','));if(value!==null)await mutate('bot.save',{...bot,trustedUsers:value.split(',').map(v=>v.trim()).filter(Boolean)});})),
        ui.details(t('directoryMode',{mode:bot.workingDirectory?t('specifiedDirectory'):t('defaultDirectory')}),ui.field(t('workingDirectory'),workspaceEdits[bot.id]??bot.workingDirectory??'',v=>setWorkspaceEdits({...workspaceEdits,[bot.id]:v}),'text',{placeholder:directories.workspaceRoot}),ui.button(t('save'),async()=>{await mutate('bot.save',{...bot,workingDirectory:workspaceEdits[bot.id]??bot.workingDirectory??''});setWorkspaceEdits((old:any)=>{const next={...old};delete next[bot.id];return next;});})),
        h('div',{className:'actions'},ui.button(t('reconnect'),()=>mutate('bot.reconnect',{id:bot.id},t('reconnected')),{disabled:busy||!bot.credentialConfigured}),ui.button(t('authorize'),()=>login(bot),{disabled:busy||bot.enabled}),channels.find((c:any)=>c.id===bot.channel)?.capabilities.login.includes('credentials')?ui.button(t('credentials'),()=>setCredential({id:bot.id,accountId:bot.accountId,appSecret:''}),{disabled:busy||bot.enabled}):null),bot.enabled?h('small',null,t('changeAuthHint')):null):h('p',{role:'status'},t('loadingConfig'));
      return h('section',{className:'card',key:bot.id},
        h('div',{className:'row spread'},identity(bot),h('div',{className:'row'},badge(bot),ui.button(t('delete'),async()=>{
          if(!await confirm(t('deleteBotConfirm',{name:bot.name,id:bot.id})))return;
          setQr((current:any)=>current?.botId===bot.id?null:current);setCredential((current:any)=>current?.id===bot.id?null:current);
          await mutate('bot.delete',{id:bot.id},t('botDeleted'));setWorkspaceEdits((current:any)=>{const next={...current};delete next[bot.id];return next;});
        },{className:'quiet danger','aria-label':t('deleteBotLabel',{name:bot.name,id:bot.id})}))),
        h('p',{className:'muted'},`${t('persona')} · ${configs.find((c:any)=>c.id===bot.configId)?.name??bot.configId}`),
        !bot.credentialConfigured?ui.button(t('authorize'),()=>login(bot),{className:'primary',disabled:busy||bot.enabled}):null,
        ui.details(t('manage'),management));
    };
    if(tab==='bots')body=h('section',{'aria-label':t('bots')},
      h('div',{className:'toolbar spread'},h('small',null,t('botCount',{count:displayBots.length})),ui.button(newOpen?t('cancel'):t('createNew'),()=>setNewOpen(!newOpen),{className:'primary','aria-expanded':newOpen})),
      newOpen?h('section',{className:'card'},h('h3',null,t('newBot')),h('div',{className:'fields'},ui.field(t('id'),newBot.id,v=>setNewBot({...newBot,id:v})),ui.field(t('name'),newBot.name,v=>setNewBot({...newBot,name:v})),ui.select(t('channel'),newBot.channel,channels.map((c:any)=>({id:c.id,name:c.displayName})),v=>setNewBot({...newBot,channel:v})),ui.select(t('persona'),newBot.configId,configs,v=>setNewBot({...newBot,configId:v}))),ui.button(t('create'),async()=>{if(!newBot.id.trim()||!newBot.name.trim())throw Error(t('requiredBotFields'));await mutate('bot.save',newBot,t('created'));setNewOpen(false);setNewBot({...newBot,id:'',name:''});},{className:'primary'})):null,
      ...displayBots.map(botCard),
      credential?h('section',{className:'card','aria-label':t('qqCredentials')},h('h3',null,t('qqCredentials')),h('div',{className:'fields'},ui.field('AppID',credential.accountId,v=>setCredential({...credential,accountId:v})),ui.field('AppSecret',credential.appSecret,v=>setCredential({...credential,appSecret:v}),'password',{autoComplete:'new-password'})),h('div',{className:'actions'},ui.button(t('save'),async()=>{await mutate('bot.credentials',{id:credential.id,credential:{accountId:credential.accountId,appSecret:credential.appSecret}},t('credentialsSaved'));setCredential(null);},{className:'primary'}),ui.button(t('cancel'),()=>setCredential(null)))):null,
      qr?h('section',{className:'card','aria-label':t('scanAuth')},h('div',{className:'row spread'},h('h3',null,t('scanAuth')),ui.button(t('close'),()=>setQr(null))),h('p',{role:'status'},({pending:t('waitingScan'),confirmed:t('authSucceeded'),expired:t('qrExpired'),denied:t('cancelled')} as any)[qr.status]),qr.status==='pending'?h('img',{src:qr.qrImage,width:240,height:240,alt:t('qrAlt')}):null):null);
    if(tab==='catalog'){
      const selected=edit?{...edit,tools:list(edit.tools),skills:list(edit.skills),hostTools:list(edit.hostTools),media:edit.media??{}}:null;
      const update=(patch:any)=>{setEdit({...selected,...patch});setDirty(true);setNotice('');};const existing=selected&&configs.some((c:any)=>c.id===selected.id);const personaFile=directories.personas.find((p:any)=>p.id===selected?.id);const progressReply=selected?.progressReply??{enabled:true,intervalSeconds:60};const setProgressReply=(patch:any)=>update({progressReply:{...progressReply,...patch}});
      const applyVoiceModel=(role:VoiceModelRole,profile:any)=>{if(selected)update(useVoiceModel(selected,role,profile,t));};
      const modelPicker=(role:VoiceModelRole)=>h('div',null,voiceModelPicker(h,ui,{role,config:selected,profiles:serviceProfiles,busy,dirty,existing:!!existing,apply:applyVoiceModel},t),ui.button(t('refresh'),async()=>{await mutate('service.refresh',{serviceId:role==='voice'?'gpt-sovits':'rvc'},t('refreshed'));await refreshProfiles();}));
      const librarySettings=(role:VoiceModelRole)=>{
        if(!voiceLibraryDraft||!voiceLibrary)return null;
        const settingsDirty=voiceLibraryDraft.modelsRoot!==voiceLibrary.modelsRoot||voiceLibraryDraft.gptSovitsUrl!==voiceLibrary.gptSovitsUrl;
        return ui.details(t('connection'),ui.field(t('modelDirectory'),voiceLibraryDraft.modelsRoot,v=>setVoiceLibraryDraft({...voiceLibraryDraft,modelsRoot:v})),role==='voice'?ui.field(t('serviceAddress'),voiceLibraryDraft.gptSovitsUrl,v=>setVoiceLibraryDraft({...voiceLibraryDraft,gptSovitsUrl:v}),'url'):null,
          h('div',{className:'actions'},ui.button(t('save'),async()=>{await mutate('service.settings.save',{...voiceLibraryDraft,expectedRevision:voiceLibrary.revision},t('saved'));await refreshLibrary();await refreshProfiles();},{disabled:busy||!settingsDirty})));
      };
      const newConfig=async()=>{if(dirty&&!await confirm(t('discardAndCreate')))return;++loadSequence.current;setConfigLoading(false);setEdit({schemaVersion:4,id:'',name:'',revision:1,personaPrompt:t('defaultPersonaPrompt'),model:null,media:{voice:{enabled:false,protocol:'edge_tts',replyMode:'on_demand',format:'mp3',voice:'zh-CN-XiaoxiaoNeural'}},tools:['bot_media','bot_voice','bot_send_file','bot_remember','bot_forget_memory','bot_read_social'],skills:['image-generation','media-analysis','voice-generation'],allowHostTools:false,hostTools:[],imageStyle:'',progressReply:{enabled:true,intervalSeconds:60},archived:false});setDirty(true);setSection('basic');};
      const fileApply=async(id:string)=>{if(dirty&&!await confirm(t('applyFilesConfirm')))return;const result=await mutate('config.files.apply',{id},t('filesApplied'));setEdit(result);setDirty(false);};
      body=h('section',{'aria-label':t('persona')},h('div',{className:'toolbar'},ui.select(t('persona'),existing?selected.id:'',[...(!existing?[{id:'',name:selected?t('newPersona'):t('select')}]:[]),...configs],loadConfig,{disabled:busy||configLoading}),ui.button(t('createNew'),newConfig),ui.button(t('import'),async()=>{const id=await ask(t('personaId'));if(id)await fileApply(id);})),configLoading?h('p',{role:'status'},t('loadingShort')):null,
        selected?h('section',{className:'card'},h('div',{className:'row spread'},h('h3',null,selected.name||t('newPersona')),h('small',null,`${dirty?t('unsaved'):t('savedState')} · ${t('relatedBots',{count:summaryBots.filter((b:any)=>b.configId===selected.id).length})}`)),
          h('nav',{className:'subnav','aria-label':t('personaSections')},...([['basic',t('basic')],['media',t('media')],['tools',t('tools')],['files',t('files')]]).map(([id,label])=>ui.button(label,()=>setSection(id),{key:id,className:section===id?'selected':'','aria-current':section===id?'page':undefined,disabled:busy||configLoading}))),
          h('fieldset',{disabled:configLoading||busy,style:{border:0,padding:0,margin:0,minWidth:0}},
            section==='basic'?h('div',null,h('div',{className:'fields'},!existing?ui.field(t('id'),selected.id,v=>update({id:v})):null,ui.field(t('name'),selected.name,v=>update({name:v})),ui.textarea(t('personaPrompt'),selected.personaPrompt,v=>update({personaPrompt:v})),ui.select(t('provider'),selected.model?.provider??'',[{id:'',name:t('select')},...models],v=>update({model:v?{provider:v,model:''}:null})),ui.select(t('model'),selected.model?.model??'',[{id:'',name:t('select')},...(models.find((p:any)=>p.id===selected.model?.provider)?.models??[])],v=>update({model:{...selected.model,model:v}}))),ui.details(t('advanced'),ui.field(t('reasoningEffort'),selected.model?.reasoningEffort??'',v=>update({model:selected.model?{...selected.model,reasoningEffort:v||undefined}:null}),'text',{disabled:!selected.model}),h('small',null,`ID · ${selected.id||t('createNew')}`)),h('section',{className:'item',key:'processing-reply'},ui.toggle(t('processingReply'),progressReply.enabled,()=>setProgressReply({enabled:!progressReply.enabled})),progressReply.enabled?ui.details(t('processingReply'),ui.field(t('processingReplyInterval'),String(progressReply.intervalSeconds),v=>setProgressReply({intervalSeconds:Number(v)}),'number',{min:10,max:3600,step:1}),h('small',null,t('processingReplyHint'))):null)):null,
            section==='tools'?h('div',{className:'stack'},ui.field(t('tools'),selected.tools.join(', '),v=>update({tools:v.split(',').map(x=>x.trim()).filter(Boolean)})),ui.field(t('skills'),selected.skills.join(', '),v=>update({skills:v.split(',').map(x=>x.trim()).filter(Boolean)})),ui.toggle(t('hostPermission'),selected.allowHostTools,()=>update({allowHostTools:!selected.allowHostTools})),selected.allowHostTools?ui.field(t('hostTools'),selected.hostTools.join(', '),v=>update({hostTools:v.split(',').map(x=>x.trim()).filter(Boolean)})):null):null,
            section==='media'?h('div',null,...['image','asr','video','voice'].map(role=>{
              const options=selected.media[role]??{};const status=role==='image'?imageSkills[selected.id]:mediaSkills[selected.id]?.[role];const label=({image:t('image'),asr:t('asr'),video:t('video'),voice:t('voiceTts')} as any)[role];const enabled=role==='voice'?options.enabled===true:options.enabled!==false;const set=(patch:any)=>update({media:{...selected.media,[role]:{...options,...patch}},...(role==='voice'&&patch.enabled===true?{tools:[...new Set([...selected.tools,'bot_voice'])],skills:[...new Set([...selected.skills,'voice-generation'])]}:{})});const ready=status?.keyConfigured||status?.configured;
              return h('section',{key:role,className:'item'},ui.toggle(label,enabled,()=>set({enabled:!enabled})),role==='voice'?modelPicker('voice'):h('p',{className:'muted'},!enabled?t('closed'):dirty?t('unsaved'):!status?t('loadingShort'):ready?t('configured'):t('pendingConfig')),enabled?ui.details(t('configuration'),...(role==='image'?[
                ui.field(t('serviceAddress'),options.baseUrl??'',v=>set({baseUrl:v.trim()||undefined}),'url',{placeholder:t('inheritAddress')}),
                ui.field(t('keyEnv'),options.keyEnv??'',v=>set({keyEnv:v.trim()||undefined}),'text',{placeholder:t('inheritKeyEnv'),autoComplete:'off',spellCheck:false}),
                ui.textarea(t('imageStyle'),selected.imageStyle,v=>update({imageStyle:v})),h('small',null,t('keyEnvHint'))
              ]:role==='voice'?[
                ui.select(t('engine'),options.protocol==='edge_tts'?'edge_tts':'profile',[{id:'edge_tts',name:'Edge TTS'},{id:'profile',name:'GPT-SoVITS'}],v=>v==='edge_tts'?set({protocol:'edge_tts',profileRef:undefined,format:'mp3',voice:'zh-CN-XiaoxiaoNeural'}):set({protocol:undefined,profileRef:options.profileRef,format:'wav',voice:undefined})),
                ui.select(t('reply'),options.replyMode??'on_demand',[{id:'on_demand',name:t('onDemand')},{id:'auto',name:t('textAndVoice')}],v=>set({replyMode:v})),
                options.protocol==='edge_tts'?ui.select(t('builtinVoice'),options.voice??'zh-CN-XiaoxiaoNeural',[{id:'zh-CN-XiaoxiaoNeural',name:t('voiceXiaoxiao')},{id:'zh-CN-YunxiNeural',name:t('voiceYunxi')},{id:'en-US-AriaNeural',name:t('voiceAria')},{id:'ja-JP-NanamiNeural',name:t('voiceNanami')}],v=>set({voice:v||undefined})):null
              ]:[h('small',null,t('followMainModel')),role==='asr'?ui.select(t('protocol'),options.protocol??'chat_completions',[{id:'chat_completions',name:t('chatProtocol')},{id:'transcriptions',name:t('transcriptionProtocol')}],v=>set({protocol:v})):null]),status?.error&&!['IMAGE_SKILL_DISABLED','MEDIA_ANALYSIS_DISABLED','VOICE_DISABLED','VOICE_OUTPUT_DISABLED'].includes(status.error)?h('p',{className:'error',role:'alert'},status.error):null,ui.button(t('restoreDefault'),()=>{const media={...selected.media};delete media[role];update({media});})):null,role==='voice'?librarySettings('voice'):null);
            }),musicCard(h,ui,selected,serviceProfiles,update,t),singingCard(h,ui,selected,update,modelPicker('singing'),librarySettings('singing'),t)):null,
            section==='files'?h('div',{className:'stack'},h('div',{className:'row spread'},h('strong',null,t('configFiles')),h('span',{className:'badge'},personaFile?.state==='error'?t('notSynced'):personaFile?.state==='draft'?t('hasDraft'):t('synced'))),h('small',null,'config.json · persona.md'),existing?h('div',{className:'actions'},ui.button(t('openDirectory'),()=>mutate('config.directory.open',{configId:selected.id},t('openedDirectory'))),ui.button(t('applyFiles'),()=>fileApply(selected.id))):h('p',{className:'muted'},t('filesAfterSave')),personaFile?.error?h('p',{className:'error',role:'alert'},personaFile.error):null,ui.details(t('pathAndId'),h('small',{className:'path'},personaFile?.directory??t('generatedAfterSave')),h('small',null,`ID · ${selected.id}`))):null),
          h('div',{className:'save-bar'},h('small',null,t('effectiveNextTurn')),ui.button(t('save'),async()=>{if(!selected.id.trim()||!selected.name.trim())throw Error(t('requiredBotFields'));const next=await mutate('config.save',{config:selected,expectedRevision:selected.revision},t('savedNextTurn'));setEdit(next);setDirty(false);},{className:'primary',disabled:busy||configLoading||!dirty}))):!configLoading?h('p',{className:'empty'},t('selectPersona')):null);
    }
    if(tab==='automation')body=null;
    const errors=[summaryError,error].filter(Boolean);
    return h('main',{className:'bot-admin'},h('style',null,panelStyles),h('header',{className:'row spread'},h('div',null,h('h2',null,t('panelTitle')),h('small',null,t('panelSubtitle')))),h('nav',{className:'main-nav','aria-label':t('panelNavigation')},...tabs.map(([id,label])=>ui.button(label,()=>navigate(id),{key:id,'aria-current':tab===id?'page':undefined,disabled:busy}))),errors.length?h('div',{className:'error',role:'alert'},[...new Set(errors)].join('\n')):null,notice?h('div',{className:'notice',role:'status'},notice):null,body,
      automationVisited?h('div',{hidden:tab!=='automation'},h(AutomationPanel,{React,query,mutate,configs,bots:summaryBots,confirm,onError:setError,busy,t,active:tab==='automation'})):null,
      question?h('div',{className:'dialog-backdrop'},h('form',{ref:dialogRef,className:'card dialog',role:'dialog','aria-modal':true,'aria-label':question.title,onSubmit:(event:any)=>{event.preventDefault();answer(question.confirm?true:question.value);},onKeyDown:(event:any)=>{if(event.key==='Escape'){event.preventDefault();answer(question.confirm?false:null);}if(event.key==='Tab'){const nodes=Array.from(dialogRef.current?.querySelectorAll('textarea,button:not(:disabled)')??[]) as HTMLElement[];const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}},h('h3',null,question.title),question.confirm?null:ui.textarea(t('content'),question.value,v=>setQuestion({...question,value:v})),h('div',{className:'actions'},h('button',{type:'submit',className:'primary'},t('confirm')),ui.button(t('cancel'),()=>answer(question.confirm?false:null),{disabled:false})))):null);
  }
  return {inject:['slots','locale'],apply(ctx:any){locale=ctx.locale;ctx.effect(()=>ctx.locale.register(LOCALE_NS,{zh,en:zh}));t=ctx.locale.bind(LOCALE_NS);ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'bot-integration',order:35,label:()=>t('nav'),locale:LOCALE_NS},App));}};
}});
