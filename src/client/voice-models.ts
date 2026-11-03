import type {BotConfig} from '../core/types.js';
import type {PublicServiceProfile} from '../core/service-management.js';
import type {createUI} from './ui.js';
import {currentProfileHealth} from './profile-status.js';

export type VoiceModelRole='voice'|'singing';
const serviceFor={voice:'gpt-sovits',singing:'rvc'} as const;
const operationFor={voice:'gpt-sovits.speak',singing:'rvc.convert'} as const;
const stateLabel:Record<string,string>={ready:'配置完整',partial:'配置待补全',blocked:'不可用',missing:'文件缺失',disabled:'已停用',revoked:'已撤销'};
const healthLabel:Record<string,string>={ready:'服务可用',degraded:'服务受限',unavailable:'服务不可用',blocked:'服务受阻',disabled:'服务停用',unknown:'服务未检查'};

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

export function voiceModelPicker(h:any,ui:ReturnType<typeof createUI>,options:{role:VoiceModelRole;config:BotConfig;profiles:PublicServiceProfile[];health:Record<string,any>;busy:boolean;dirty:boolean;existing:boolean;apply:(role:VoiceModelRole,profile:PublicServiceProfile)=>Promise<void>;inspect:(role:string,ref:any,operation:string)=>Promise<void>;openLibrary:()=>void}) {
  const {role,config,profiles,health,busy,dirty,existing}=options,selected=config.media[role];
  const rows=profiles.filter(profile=>profile.serviceId===serviceFor[role]&&profile.capabilities.includes(operationFor[role]));
  return h('section',{className:'item','aria-label':role==='voice'?'说话音色':'唱歌音色'},
    h('div',{className:'row spread'},h('h4',null,role==='voice'?'说话音色 · GPT-SoVITS':'唱歌音色 · RVC'),ui.button('管理模型',options.openLibrary,{disabled:busy,className:'quiet'})),
    dirty||!existing?h('p',{className:'muted'},'先保存或取消当前人格修改，再使用音色。'):null,
    !rows.length?h('p',{className:'muted'},'尚未发现模型，请在模型服务中设置目录并刷新。'):null,
    ...rows.map(profile=>{
      const key=`${profile.serviceId}/${profile.profileId}`,using=selected?.enabled&&selected.profileRef?.serviceId===profile.serviceId&&selected.profileRef.profileId===profile.profileId&&config.tools.includes(role==='voice'?'bot_voice':'bot_sing')&&config.skills.includes(role==='voice'?'voice-generation':'singing-conversion')&&(role!=='voice'||config.media.voice?.format==='wav'),probe=currentProfileHealth(health[key],profile);
      return h('div',{key,className:'item row spread'},h('div',null,h('strong',null,profile.displayName),h('p',{className:'muted'},`${profile.modelLabel??serviceFor[role]} · ${stateLabel[profile.state]??profile.state} · ${healthLabel[probe?.state??'unknown']??'服务未检查'}`)),h('div',{className:'actions'},
        ui.button('检查服务',()=>options.inspect(role,{serviceId:profile.serviceId,profileId:profile.profileId},operationFor[role]),{disabled:busy||dirty||!existing||profile.state!=='ready'}),
        ui.button(using?'正在使用':'使用',()=>options.apply(role,profile),{disabled:busy||dirty||!existing||profile.state!=='ready'||!!using,className:using?'quiet':'primary','aria-label':`${role==='voice'?'说话':'唱歌'}使用${profile.displayName}`})));
    }),h('small',null,'使用后立即保存，下一轮生效。服务检查不代表已完成音频试听验收。'));
}

export function voiceLibraryPanel(h:any,ui:ReturnType<typeof createUI>,options:{value:any;draft:{modelsRoot:string;gptSovitsUrl:string}|null;busy:boolean;update:(value:{modelsRoot:string;gptSovitsUrl:string})=>void;save:()=>Promise<void>;refresh:()=>Promise<void>}) {
  const {value,draft,busy}=options;if(!draft)return h('p',{role:'status'},'读取模型服务设置中…');
  const dirty=draft.modelsRoot!==value?.modelsRoot||draft.gptSovitsUrl!==value?.gptSovitsUrl;
  return h('section',{'aria-label':'模型服务'},h('section',{className:'card'},h('h3',null,'本机模型库'),
    h('div',{className:'fields'},ui.field('模型根目录',draft.modelsRoot,v=>options.update({...draft,modelsRoot:v}),'text',{placeholder:'TTS_and_STS 项目中的 models 目录'}),ui.field('GPT-SoVITS 地址',draft.gptSovitsUrl,v=>options.update({...draft,gptSovitsUrl:v}),'url')),
    h('p',{className:'muted'},'自动识别 RVC 与 GPT-SoVITS；新增模型放入目录后刷新。RVC 使用项目 Python 环境，GPT-SoVITS 连接已有服务。'),
    h('div',{className:'actions'},ui.button('保存并识别',options.save,{disabled:busy||!dirty,className:'primary'}),ui.button('刷新模型',options.refresh,{disabled:busy||dirty||!value?.modelsRoot})),
    dirty?h('small',null,'目录或地址修改后，请先保存。'):null),
    ...(['gpt-sovits','rvc'] as const).map(serviceId=>{
      const report=value?.reports?.[serviceId];return h('section',{key:serviceId,className:'card'},h('h3',null,serviceId==='rvc'?'唱歌模型 · RVC':'说话模型 · GPT-SoVITS'),h('p',null,`${report?.profileCount??0} 个模型 · ${stateLabel[report?.state??'missing']??'未配置'}`),
        ...(report?.diagnostics??[]).map((message:string,index:number)=>h('p',{key:index,className:'notice'},message)),
        ...(report?.models??[]).map((model:any)=>h('div',{key:model.profileId,className:'item'},h('strong',null,model.displayName),h('p',{className:'muted'},stateLabel[model.state]??model.state),...(model.diagnostics??[]).map((message:string,index:number)=>h('p',{key:index,className:'notice'},message)))));
    }));
}
