import type {BotConfig} from '../core/types.js';
import type {PublicServiceProfile} from '../core/service-management.js';
import type {createUI} from './ui.js';

export type VoiceModelRole='voice'|'singing';
const serviceFor={voice:'gpt-sovits',singing:'rvc'} as const;
const operationFor={voice:'gpt-sovits.speak',singing:'rvc.convert'} as const;

export function useVoiceModel(config:BotConfig,role:VoiceModelRole,profile:Pick<PublicServiceProfile,'serviceId'|'profileId'|'state'|'capabilities'>):BotConfig {
  if(profile.serviceId!==serviceFor[role]||!profile.capabilities.includes(operationFor[role])||profile.state!=='ready')throw Error('请选择配置完整的对应音色');
  const next=structuredClone(config),profileRef={serviceId:profile.serviceId,profileId:profile.profileId};
  if(role==='voice'){
    next.media.voice={...next.media.voice,enabled:true,profileRef,protocol:undefined,voice:undefined,replyMode:next.media.voice?.replyMode??'on_demand',format:'wav'};
    next.tools=[...new Set([...next.tools,'bot_voice'])];next.skills=[...new Set([...next.skills,'voice-generation'])];
  }else{
    next.media.singing={speakerId:0,pitchShift:0,indexRate:0,defaultOutput:'mp3',separation:{enabled:false,instrumentalMix:false,volume:1,status:'unconfigured'},...next.media.singing,enabled:true,profileRef};
    next.tools=[...new Set([...next.tools,'bot_sing'])];next.skills=[...new Set([...next.skills,'singing-conversion'])];
  }
  return next;
}

export async function loadServiceProfiles(query:(name:string,input:any,signal?:AbortSignal)=>Promise<any>,signal?:AbortSignal):Promise<PublicServiceProfile[]> {
  const profiles:PublicServiceProfile[]=[];let cursor:string|undefined;
  do{
    signal?.throwIfAborted();const page=await query('catalog.profiles',{limit:100,...cursor?{cursor}:{}},signal);if(!page)throw Error('模型列表读取失败');
    profiles.push(...page.items);cursor=page.nextCursor??undefined;
  }while(cursor);
  return profiles;
}

export function voiceModelPicker(h:any,ui:ReturnType<typeof createUI>,options:{role:VoiceModelRole;config:BotConfig;profiles:PublicServiceProfile[];busy:boolean;dirty:boolean;existing:boolean;apply:(role:VoiceModelRole,profile:PublicServiceProfile)=>Promise<void>}) {
  const {role,config,profiles,busy,dirty,existing}=options,selected=config.media[role];
  const rows=profiles.filter(profile=>profile.serviceId===serviceFor[role]&&profile.capabilities.includes(operationFor[role]));
  const key=selected?.profileRef?`${selected.profileRef.serviceId}/${selected.profileRef.profileId}`:'',disabled=busy||dirty||!existing;
  const choices=[...(!key?[{id:'',name:role==='voice'&&config.media.voice?.protocol==='edge_tts'?'内置语音':rows.length?'选择':'暂无',disabled:true}]:[]),...rows.map(profile=>{
    let version=profile.modelLabel?.replace(/^(?:GPT[- ]?SoVITS|RVC)\s*/i,'').trim();
    if(version?.startsWith(profile.displayName))version=version.slice(profile.displayName.length).replace(/^\s*[·:：-]?\s*/,'');
    return{id:`${profile.serviceId}/${profile.profileId}`,name:`${profile.displayName}${version?` · ${version}`:''}${profile.state==='ready'?'':'（不可用）'}`,disabled:profile.state!=='ready'};
  })];
  if(key&&!choices.some(choice=>choice.id===key))choices.push({id:key,name:'不可用',disabled:true});
  return h('div',null,ui.select(role==='voice'?'说话':'唱歌',key,choices,async value=>{
    if(disabled)return;const profile=rows.find(item=>`${item.serviceId}/${item.profileId}`===value);if(profile?.state==='ready')await options.apply(role,profile);
  },{disabled}),dirty||!existing?h('small',null,!existing?'请先保存。':'请先保存或取消。'):null);
}
