import {createUI} from './ui.js';

export function musicCard(h:any,ui:ReturnType<typeof createUI>,config:any,dirty:boolean,status:any,profiles:any[],healthByProfile:any,acceptanceByProfile:any,update:(patch:any)=>void,_mutate:(action:string,input:any,message?:string)=>Promise<any>,ask:(title:string,value?:string)=>Promise<string|null>,inspectProfile:(role:string,ref:any,operation:string)=>Promise<void>,recordAcceptance:(role:string,ref:any,operation:string,state:'PASS'|'FAIL',evidence:string)=>Promise<void>){
  const options=config.media.music??{};
  const set=(patch:any)=>update({media:{...config.media,music:{enabled:false,includeLyrics:false,...options,...patch}}});
  const key=options.profileRef?`${options.profileRef.serviceId}/${options.profileRef.profileId}`:'',profile=profiles.find(item=>`${item.serviceId}/${item.profileId}`===key),health=healthByProfile[key],acceptance=acceptanceByProfile[`music:${key}`]??status?.downloadValidation;
  const choices=[{id:'',name:'请选择 Profile'},...profiles.filter(item=>item.serviceId==='music'&&(item.capabilities?.includes('music.acquire')||item.capabilities?.includes('music.search'))).map(item=>({id:`${item.serviceId}/${item.profileId}`,name:`${item.displayName}${item.modelLabel?` · ${item.modelLabel}`:''} · ${item.state}`}))];
  const setProfile=(value:string)=>{const [serviceId,profileId]=value.split('/',2);set({profileRef:serviceId&&profileId?{serviceId,profileId}:undefined});};
  const label=(value?:string)=>({PASS:'通过',FAIL:'失败',EXPIRED:'已过期',BLOCKED:'阻塞',NOT_RUN:'未验收'} as Record<string,string>)[value??'NOT_RUN']??'未验收';
  const record=async(state:'PASS'|'FAIL')=>{const evidence=await ask(state==='PASS'?'填写实际歌曲、来源与完整下载验收依据':'填写实际搜索或下载失败的现象');if(!evidence?.trim())return;await recordAcceptance('music',options.profileRef,'music.acquire',state,evidence.trim());};
  return h('section',{key:'music',className:'item'},ui.toggle('音乐搜索与下载',options.enabled===true,()=>{
    if(options.enabled)set({enabled:false});else update({media:{...config.media,music:{includeLyrics:false,...options,enabled:true}},tools:[...new Set([...config.tools,'bot_music'])],skills:[...new Set([...config.skills,'music-download'])]});
  }),h('p',{className:'muted'},`${options.enabled?'已开启':'已关闭'} · ${profile?`${profile.displayName}${profile.modelLabel?` · ${profile.modelLabel}`:''} · ${profile.state}`:'Profile 未选择或 missing'} · health ${health?.state??'未检查'} · acceptance ${label(acceptance?.state??acceptance?.status)}`),
  ui.select('音乐 Profile',key,choices,setProfile),ui.toggle('下载时附带歌词',options.includeLyrics===true,()=>set({includeLyrics:options.includeLyrics!==true})),
  h('small',null,'人格只保存能力开关、Profile 引用和歌词偏好。Profile missing/blocked/disabled/revoked 时不会自动选择其他服务。'),
  h('div',{className:'actions'},ui.button('检查 health',()=>inspectProfile('music',options.profileRef,'music.acquire'),{disabled:dirty||!options.profileRef}),ui.button('登记下载通过',()=>record('PASS'),{disabled:dirty||!profile}),ui.button('登记下载失败',()=>record('FAIL'),{disabled:dirty||!profile})));
}
