import {botStatus, list} from './ui.js';
import type {Translate} from './locale.js';

export type BotEditorSection='run'|'media'|'persona'|'auth'|'workspace';

export type PanelUI = {
  button: (label:string, action:()=>unknown, props?:any)=>any;
  toggle: (label:string, checked:boolean, action:()=>unknown, props?:any)=>any;
  field: (label:string, value:any, change:(value:string)=>void, type?:string, props?:any)=>any;
  select: (label:string, value:string, options:any[], change:(value:string)=>unknown, props?:any)=>any;
  textarea: (label:string, value:string, change:(value:string)=>void, props?:any)=>any;
};

export interface BotsPanelProps {
  React:any;
  ui:PanelUI;
  t:Translate;
  bots:any[];
  configs:any[];
  channels:any[];
  summary?:any;
  busy:boolean;
  selectedBotId?:string;
  section?:BotEditorSection;
  onSectionChange?:(section:BotEditorSection)=>unknown;
  configSections?:Partial<Record<'run'|'media',any>>;
  configLoading?:boolean;
  configDirty?:boolean;
  onSaveConfig?:()=>unknown;
  onDiscardConfig?:()=>unknown;
  onSelect:(id:string)=>unknown;
  onCreate?:()=>void;
  createForm?:any;
  onServiceToggle?:()=>void;
  onBotToggle:(bot:any, running:boolean)=>unknown;
  onPersonaChange:(bot:any, configId:string)=>unknown;
  onReconnect:(bot:any)=>unknown;
  onAuthorize:(bot:any)=>unknown;
  onCredentials:(bot:any)=>unknown;
  onDelete:(bot:any)=>unknown;
  onWorkingDirectoryChange:(bot:any, value:string)=>void;
  onBrowseDirectory:(bot:any)=>unknown;
  onDefaultDirectory:(bot:any)=>void;
  onSaveWorkingDirectory:(bot:any)=>unknown;
  workspaceEdits?:Record<string,string>;
  onAddTrustedUser:(bot:any)=>unknown;
  onRemoveTrustedUser:(bot:any, user:string)=>unknown;
  credential?:any;
  credentialForm?:any;
  qr?:any;
  qrForm?:any;
}

const h = (React:any, type:any, props:any, ...children:any[]) => React.createElement(type, props, ...children);

function statusBadge(React:any, t:Translate, bot:any){
  const status = botStatus(bot.status, t);
  return h(React, 'span', {className:`badge ${bot.status === 'error' ? 'warning' : ''}`, role:'status'}, status);
}

function botIdentity(React:any, bot:any, channelName:string){
  const initial = bot.channel === 'qq' ? 'Q' : 'W';
  return h(React, 'div', {className:'identity'},
    h(React, 'span', {className:'avatar', 'aria-hidden':true}, initial),
    h(React, 'div', {className:'identity-copy'},
      h(React, 'strong', null, bot.name),
      h(React, 'span', {className:'muted'}, channelName),
    ),
  );
}

function listRow(React:any, props:BotsPanelProps, bot:any, selected:boolean, channelName:string){
  return h(React, 'div', {key:bot.id,className:`bot-list-row${selected ? ' selected' : ''}`},
    h(React, 'button', {
      type:'button',
      className:'bot-list-select',
      'aria-pressed':selected,
      'aria-label':bot.name,
      disabled:props.busy||props.configLoading,
      onClick:props.ui.button('',()=>props.onSelect(bot.id)).props.onClick,
    },
      botIdentity(React, bot, channelName),
      h(React, 'div', {className:'bot-list-meta'},
        h(React, 'span', {className:'muted'}, bot.configName ?? bot.configId ?? props.t('none')),
        statusBadge(React, props.t, bot),
      ),
    ),
    !selected ? props.ui.button(props.t('delete'),()=>props.onDelete(bot),{className:'quiet danger','aria-label':props.t('deleteBotLabel',{name:bot.name,id:bot.id}),disabled:props.busy||props.configLoading}) : null,
  );
}

function trustedUsers(React:any, props:BotsPanelProps, bot:any){
  const users = list(bot.trustedUsers);
  return h(React, 'section', {className:'detail-section'},
    h(React, 'div', {className:'section-heading'}, h(React, 'h4', null, props.t('usersCount',{count:users.length}))),
    users.length ? h(React, 'div', {className:'trusted-users'}, ...users.map((user:string)=>h(React, 'div', {className:'trusted-user', key:user},
      h(React, 'span', null, user),
      props.ui.button(props.t('delete'),()=>props.onRemoveTrustedUser(bot,user),{className:'quiet danger'}),
    ))) : h(React, 'p', {className:'empty'}, props.t('none')),
    props.ui.button(props.t('add'),()=>props.onAddTrustedUser(bot),{className:'quiet'}),
  );
}

function botDetail(React:any, props:BotsPanelProps, bot:any){
  const {t,ui}=props;
  const section=props.section??'run';
  const channel = props.channels.find((item:any)=>item.id===bot.channel);
  const channelName = channel?.displayName ?? bot.channel;
  const serviceRunning = props.summary?.health?.serviceRunning !== false;
  const running = bot.enabled && serviceRunning && bot.status !== 'stopped';
  const workingDirectory = props.workspaceEdits?.[bot.id] ?? bot.workingDirectory ?? '';
  const canCredentials = channel?.capabilities?.login?.includes('credentials');
  const personaOptions = props.configs.map((config:any)=>({id:config.id,name:config.name ?? config.id}));
  const sections:[BotEditorSection,string][]=[['run',t('run')],['media',t('media')],['persona',t('persona')],['auth',t('authorization')],['workspace',t('workspace')]];
  const contentId=`bot-detail-${bot.id}`;
  let content:any;
  if(section==='run')content=h(React,'div',{className:'section-grid'},
    h(React, 'section', {className:'detail-section'},
      ui.toggle(t('run'), running, ()=>props.onBotToggle(bot,running)),
      h(React, 'div', {className:'actions'},
        ui.button(t('reconnect'),()=>props.onReconnect(bot),{disabled:props.busy||!bot.credentialConfigured}),
      ),
    ),
    props.configLoading?h(React,'p',{role:'status'},t('loadingConfig')):props.configSections?.run??h(React,'p',{className:'empty'},t('selectBotPersona')),
  );
  if(section==='media')content=h(React,'div',{className:'section-grid'},
    props.configLoading?h(React,'p',{role:'status'},t('loadingConfig')):props.configSections?.media??h(React,'p',{className:'empty'},t('selectBotPersona')),
  );
  if(section==='persona')content=h(React, 'section', {className:'detail-section'},
    ui.select(t('persona'), bot.configId ?? '', personaOptions, value=>props.onPersonaChange(bot,value),{disabled:props.busy||props.configLoading}),
  );
  if(section==='auth')content=h(React,'section',{className:'detail-section'},
    h(React,'span',{className:'badge'},bot.credentialConfigured?t('configured'):t('pendingConfig')),
    h(React,'div',{className:'actions'},
      ui.button(t('authorize'),()=>props.onAuthorize(bot),{className:'primary',disabled:props.busy||bot.enabled}),
      canCredentials?ui.button(t('credentials'),()=>props.onCredentials(bot),{disabled:props.busy||bot.enabled}):null,
    ),
    props.credential?.id===bot.id?props.credentialForm??null:null,
    props.qr?.botId===bot.id?props.qrForm??null:null,
  );
  if(section==='workspace')content=h(React,'div',{className:'section-grid'},
    h(React, 'section', {className:'detail-section'},
      h(React, 'div', {className:'directory-field'},
        ui.field(t('workingDirectory'), workingDirectory, value=>props.onWorkingDirectoryChange(bot,value), 'text', {placeholder:t('defaultDirectory')}),
        ui.button(t('browseDirectory'),()=>props.onBrowseDirectory(bot)),
      ),
      h(React, 'div', {className:'actions'},
        ui.button(t('defaultDirectory'),()=>props.onDefaultDirectory(bot),{className:'quiet'}),
        ui.button(t('save'),()=>props.onSaveWorkingDirectory(bot),{className:'primary'}),
      ),
    ),
    trustedUsers(React, props, bot),
  );
  return h(React, 'article', {className:'bot-detail', 'aria-label':bot.name},
    h(React, 'header', {className:'detail-header'},
      h(React, 'div', null, botIdentity(React, bot, channelName), h(React, 'span', {className:'muted'}, bot.id)),
      statusBadge(React,t,bot),
    ),
    h(React,'nav',{className:'bot-section-nav','aria-label':t('botSections')},...sections.map(([id,label])=>ui.button(label,()=>props.onSectionChange?.(id),{key:id,id:`${contentId}-${id}`,className:section===id?'selected':'','aria-current':section===id?'page':undefined,'aria-controls':contentId,disabled:props.busy||props.configLoading}))),
    h(React,'div',{className:'bot-section-content',id:contentId,role:'region','aria-labelledby':`${contentId}-${section}`},content),
    h(React,'div',{className:'bot-danger-zone'},ui.button(t('delete'),()=>props.onDelete(bot),{className:'quiet danger','aria-label':t('deleteBotLabel',{name:bot.name,id:bot.id}),disabled:props.busy||props.configLoading})),
    props.configDirty?h(React,'div',{className:'save-bar sticky'},h(React,'span',null,t('unsaved')),h(React,'div',{className:'actions'},ui.button(t('cancel'),()=>props.onDiscardConfig?.(),{disabled:props.busy||props.configLoading||!props.onDiscardConfig}),ui.button(t('save'),()=>props.onSaveConfig?.(),{className:'primary',disabled:props.busy||props.configLoading||!props.onSaveConfig}))):null,
  );
}

export function BotsPanel(props:BotsPanelProps){
  const React = props.React;
  const selected = props.bots.find(bot=>bot.id===props.selectedBotId) ?? props.bots[0];
  const selectedId = selected?.id;
  return h(React, 'section', {className:'panel-page bots-page', 'aria-label':props.t('bots')},
    h(React, 'div', {className:'page-toolbar'},
      h(React, 'div', null, h(React, 'h3', null, props.t('bots')), h(React, 'span', {className:'muted'}, props.t('botCount',{count:props.bots.length}))),
      h(React, 'div', {className:'actions'},
        props.onServiceToggle ? props.ui.button(props.summary?.health?.serviceRunning===true ? props.t('stopBotService') : props.t('startBotService'), props.onServiceToggle, {className:'quiet',disabled:props.busy||!props.summary?.health,'aria-label':props.summary?.health?.serviceRunning===true ? props.t('stopBotService') : props.t('startBotService')}) : null,
      ),
    ),
    h(React, 'div', {className:'entity-workspace'},
      h(React, 'nav', {className:'entity-list entity-strip', 'aria-label':props.t('bots')},
        ...props.bots.map(bot=>listRow(React,props,bot,bot.id===selectedId,props.channels.find((item:any)=>item.id===bot.channel)?.displayName ?? bot.channel)),
        props.onCreate ? props.ui.button('＋',props.onCreate,{className:'entity-create','aria-label':props.t('newBot'),title:props.t('newBot'),'aria-expanded':!!props.createForm,disabled:props.busy||props.configLoading}) : null,
      ),
      props.createForm ?? null,
      selected ? botDetail(React,props,selected) : h(React, 'section', {className:'card empty-state'}, h(React, 'p', null, props.t('noBots'))),
    ),
  );
}
