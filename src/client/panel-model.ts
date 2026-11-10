import type {BotConfig} from '../core/client-contracts.js';

export type StatusTone='success'|'warning'|'danger'|'neutral';

export interface PanelChannel {
  id:string;
  displayName?:string;
  capabilities?:{login?:readonly string[]};
}

export interface PanelSummaryBot {
  id:string;
  name:string;
  channel:string;
  configId:string;
  enabled?:boolean;
  archived?:boolean;
  status?:string;
  credentialConfigured?:boolean;
  activeSessions?:number;
  trustedUserCount?:number;
  workspaceConfigured?:boolean;
}

export interface PanelBotRecord extends PanelSummaryBot {
  accountId?:string;
  trustedUsers?:readonly string[];
  workingDirectory?:string;
}

export interface BotRowViewModel {
  id:string;
  name:string;
  channel:string;
  channelName:string;
  personaId:string;
  personaName:string;
  status:string;
  statusTone:StatusTone;
  enabled:boolean;
  running:boolean;
  credentialConfigured:boolean;
  trustedUserCount:number;
  activeSessions:number;
  workspaceConfigured:boolean;
}

export interface PersonaSummaryViewModel {
  id:string;
  name:string;
  revision:number;
  archived:boolean;
  modelLabel:string;
  linkedBotCount:number;
  toolCount:number;
  skillCount:number;
  voiceEnabled:boolean;
  singingEnabled:boolean;
  musicEnabled:boolean;
}

export interface ServiceCardViewModel {
  id:'runtime'|'gpt-sovits'|'breeze-tts'|'rvc';
  label:string;
  state:string;
  tone:StatusTone;
  configured:boolean;
  profileCount:number;
  diagnostic?:string;
  canStart:boolean;
  dirty:boolean;
}

export const statusTone=(status:string|undefined):StatusTone=>{
  switch(status){
    case 'connected':return 'success';
    case 'connecting':
    case 'reconnecting':return 'warning';
    case 'error':return 'danger';
    case 'stopped':
    case 'disconnected':return 'neutral';
    default:return 'neutral';
  }
};

export const serviceTone=(state:string|undefined):StatusTone=>{
  switch(state){
    case 'ready':
    case 'connected':return 'success';
    case 'partial':
    case 'degraded':
    case 'unknown':return 'warning';
    case 'blocked':
    case 'unavailable':
    case 'revoked':return 'danger';
    default:return 'neutral';
  }
};

const text=(value:unknown,fallback='')=>typeof value==='string'&&value.trim()?value:fallback;
const number=(value:unknown,fallback=0)=>typeof value==='number'&&Number.isFinite(value)?value:fallback;

export function mapBotRows(input:{summaryBots?:readonly PanelSummaryBot[];bots?:readonly PanelBotRecord[];configs?:readonly Pick<BotConfig,'id'|'name'>[];channels?:readonly PanelChannel[];serviceRunning?:boolean}={}):BotRowViewModel[]{
  const summary=new Map((input.summaryBots??[]).map(bot=>[bot.id,bot]));
  const configs=new Map((input.configs??[]).map(config=>[config.id,config.name]));
  const channels=new Map((input.channels??[]).map(channel=>[channel.id,text(channel.displayName,channel.id)]));
  const rows=new Map<string,PanelBotRecord>();
  for(const bot of input.bots??[])rows.set(bot.id,bot);
  for(const bot of input.summaryBots??[])if(!rows.has(bot.id))rows.set(bot.id,bot);
  return [...rows.values()].filter(bot=>!bot.archived).map(bot=>{
    const live=summary.get(bot.id),status=text(live?.status??bot.status,'stopped'),enabled=live?.enabled??bot.enabled===true;
    const trustedUsers=bot.trustedUsers;
    const configured=live?.credentialConfigured??bot.credentialConfigured===true;
    return {
      id:bot.id,name:bot.name,channel:bot.channel,channelName:channels.get(bot.channel)??bot.channel,
      personaId:bot.configId,personaName:configs.get(bot.configId)??bot.configId,status,statusTone:statusTone(status),
      enabled,running:enabled&&input.serviceRunning!==false&&status!=='stopped',credentialConfigured:configured,
      trustedUserCount:trustedUsers?.length??number(live?.trustedUserCount),activeSessions:number(live?.activeSessions),
      workspaceConfigured:live?.workspaceConfigured??Boolean(bot.workingDirectory),
    };
  });
}

export function mapPersonaSummaries(configs:readonly Partial<BotConfig>[]=[],bots:readonly Pick<PanelSummaryBot,'configId'|'archived'>[]=[]):PersonaSummaryViewModel[]{
  const linked=new Map<string,number>();
  for(const bot of bots)if(!bot.archived)linked.set(bot.configId,(linked.get(bot.configId)??0)+1);
  return configs.filter(config=>!config.archived&&typeof config.id==='string').map(config=>({
    id:config.id!,name:text(config.name,config.id!),revision:number(config.revision,1),archived:config.archived===true,
    modelLabel:config.model?`${text(config.model.provider)} / ${text(config.model.model)}`:'未选择模型',
    linkedBotCount:linked.get(config.id!)??0,toolCount:config.tools?.length??0,skillCount:config.skills?.length??0,
    voiceEnabled:config.media?.voice?.enabled===true,singingEnabled:config.media?.singing?.enabled===true,musicEnabled:config.media?.music?.enabled===true,
  }));
}

export function mapServiceCards(input:{serviceRunning?:boolean;activeTasks?:number;settings?:{modelsRoot?:string;gptSovitsUrl?:string;gptSovitsProjectRoot?:string;breezeTtsUrl?:string;breezeTtsProjectRoot?:string;breezeTtsVoicesRoot?:string};reports?:Partial<Record<'rvc'|'gpt-sovits'|'breeze-tts',{state?:string;profileCount?:number;safeDiagnostic?:string}>>;serviceHealth?:Partial<Record<string,{state?:string;safeDiagnostic?:string}>>;dirty?:boolean}={}):ServiceCardViewModel[]{
  const reports=input.reports??{};
  const health=input.serviceHealth??{};
  const report=(id:'rvc'|'gpt-sovits'|'breeze-tts')=>reports[id];
  const card=(id:ServiceCardViewModel['id'],label:string,state:string,configured:boolean,profileCount:number,diagnostic?:string,canStart=false):ServiceCardViewModel=>({id,label,state,tone:id==='runtime'?serviceTone(input.serviceRunning?'connected':'stopped'):serviceTone(state),configured,profileCount,diagnostic,canStart,dirty:input.dirty===true});
  const settings=input.settings;
  const gpt=report('gpt-sovits'),breeze=report('breeze-tts'),rvc=report('rvc');
  const gptHealth=health['gpt-sovits'],breezeHealth=health['breeze-tts'];
  return [
    card('runtime','机器人运行时',input.serviceRunning?'connected':'stopped',true,0,undefined,true),
    card('gpt-sovits','GPT-SoVITS',gptHealth?.state??gpt?.state??'missing',Boolean(settings?.gptSovitsUrl&&settings.gptSovitsProjectRoot),number(gpt?.profileCount),gptHealth?.safeDiagnostic??gpt?.safeDiagnostic,Boolean(settings?.gptSovitsProjectRoot)),
    card('breeze-tts','Breeze TTS',breezeHealth?.state??breeze?.state??'missing',Boolean(settings?.breezeTtsUrl&&settings.breezeTtsProjectRoot),number(breeze?.profileCount),breezeHealth?.safeDiagnostic??breeze?.safeDiagnostic,Boolean(settings?.breezeTtsProjectRoot)),
    card('rvc','RVC 模型库',rvc?.state??'missing',Boolean(settings?.modelsRoot),number(rvc?.profileCount),rvc?.safeDiagnostic),
  ];
}
