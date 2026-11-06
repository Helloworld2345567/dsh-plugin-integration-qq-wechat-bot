import type {BotConfig,PublicServiceProfile} from '../core/client-contracts.js';
import type {createUI} from './ui.js';
import {chinese,type Translate} from './locale.js';

export type VoiceModelRole='voice'|'singing';
const servicesFor:Record<VoiceModelRole,readonly string[]>={voice:['gpt-sovits','breeze-tts'],singing:['rvc']};
const operationFor=(role:VoiceModelRole,serviceId:string)=>role==='singing'?'rvc.convert':serviceId==='breeze-tts'?'breeze-tts.speak':'gpt-sovits.speak';

export function useVoiceModel(config:BotConfig,role:VoiceModelRole,profile:Pick<PublicServiceProfile,'serviceId'|'profileId'|'state'|'capabilities'>,t:Translate=chinese):BotConfig {
  if(!servicesFor[role].includes(profile.serviceId)||!profile.capabilities.includes(operationFor(role,profile.serviceId))||profile.state!=='ready')throw Error(t('selectReadyVoice'));
  const next=structuredClone(config),profileRef={serviceId:profile.serviceId,profileId:profile.profileId};
  if(role==='voice'){
    next.media.voice={...next.media.voice,enabled:true,engine:profile.serviceId as 'gpt-sovits'|'breeze-tts',profileRef,protocol:undefined,voice:undefined,replyMode:next.media.voice?.replyMode??'on_demand',format:'wav'};
    next.tools=[...new Set([...next.tools,'bot_voice'])];next.skills=[...new Set([...next.skills,'voice-generation'])];
  }else{
    next.media.singing={speakerId:0,pitchShift:0,indexRate:0,defaultOutput:'mp3',separation:{enabled:false,instrumentalMix:false,volume:1,status:'unconfigured'},...next.media.singing,enabled:true,profileRef};
    next.tools=[...new Set([...next.tools,'bot_sing'])];next.skills=[...new Set([...next.skills,'singing-conversion'])];
  }
  return next;
}

export async function loadServiceProfiles(query:(name:string,input:any,signal?:AbortSignal)=>Promise<any>,signal?:AbortSignal,t:Translate=chinese):Promise<PublicServiceProfile[]> {
  const profiles:PublicServiceProfile[]=[];let cursor:string|undefined;
  do{
    signal?.throwIfAborted();const page=await query('catalog.profiles',{limit:100,...cursor?{cursor}:{}},signal);if(!page)throw Error(t('modelListFailed'));
    profiles.push(...page.items);cursor=page.nextCursor??undefined;
  }while(cursor);
  return profiles;
}

export function voiceModelPicker(h:any,ui:ReturnType<typeof createUI>,options:{role:VoiceModelRole;config:BotConfig;profiles:PublicServiceProfile[];busy:boolean;dirty:boolean;existing:boolean;serviceId?:string;apply:(role:VoiceModelRole,profile:PublicServiceProfile)=>void|Promise<void>},t:Translate=chinese) {
  const {role,config,profiles,busy}=options,selected=config.media[role];
  const rows=profiles.filter(profile=>servicesFor[role].includes(profile.serviceId)&&(!options.serviceId||profile.serviceId===options.serviceId)&&profile.capabilities.includes(operationFor(role,profile.serviceId)));
  const key=selected?.profileRef?`${selected.profileRef.serviceId}/${selected.profileRef.profileId}`:'',disabled=busy;
  const choices=[...(!key?[{id:'',name:role==='voice'&&config.media.voice?.protocol==='edge_tts'?t('builtinSpeech'):rows.length?t('chooseVoice'):t('noVoice'),disabled:true}]:[]),...rows.map(profile=>{
    let version=profile.modelLabel?.replace(/^(?:GPT[- ]?SoVITS|RVC|Breeze[- ]?TTS(?:-2)?(?:\.cpp)?)\s*/i,'').trim();
    if(version?.startsWith(profile.displayName))version=version.slice(profile.displayName.length).replace(/^\s*[·:：-]?\s*/,'');
    return{id:`${profile.serviceId}/${profile.profileId}`,name:`${profile.displayName}${version?` · ${version}`:''}${profile.state==='ready'?'':t('unavailableSuffix')}`,disabled:profile.state!=='ready'};
  })];
  if(key&&!choices.some(choice=>choice.id===key))choices.push({id:key,name:t('unavailable'),disabled:true});
  return h('div',null,ui.select(role==='voice'?t('speak'):t('sing'),key,choices,async value=>{
    if(disabled)return;const profile=rows.find(item=>`${item.serviceId}/${item.profileId}`===value);if(profile?.state==='ready')await options.apply(role,profile);
  },{disabled}));
}
