import {createUI} from './ui.js';

const sourceNames:Record<string,string>={MiguMusicClient:'咪咕',KuwoMusicClient:'酷我',QQMusicClient:'QQ 音乐',NeteaseMusicClient:'网易云音乐'};
export function musicCard(h:any,ui:ReturnType<typeof createUI>,config:any,dirty:boolean,status:any,update:(patch:any)=>void,mutate:(action:string,input:any,message?:string)=>Promise<any>,ask:(title:string,value?:string)=>Promise<string|null>){
  const options=config.media.music??{},current=status?.revision===config.revision,environment=status?.environment,v4=config.schemaVersion===4;
  const set=(patch:any)=>update({media:{...config.media,music:{enabled:false,includeLyrics:false,...options,...patch}}});
  const setProfile=(value:string)=>{const [serviceId,profileId]=value.split('/',2);set({profileRef:serviceId&&profileId?{serviceId,profileId}:undefined});};
  const validation=(value:any)=>({PASS:'通过',FAIL:'失败',BLOCKED:'阻塞',NOT_RUN:'未验收'}[value?.status as string]??'未验收');
  const record=async(passed:boolean)=>{const evidence=await ask(passed?'填写实际歌曲、来源与完整下载验收依据':'填写实际搜索或下载失败的现象');if(evidence?.trim())await mutate('capability.record',{configId:config.id,revision:config.revision,role:'music',status:passed?'PASS':'FAIL',evidence:evidence.trim()},'已记录当前配置版本的音乐验收结果');};
  return h('section',{key:'music',className:'item'},ui.toggle('音乐搜索与下载',options.enabled===true,()=>{
    if(options.enabled)set({enabled:false});
    else update({media:{...config.media,music:{includeLyrics:false,...options,enabled:true}},tools:[...new Set([...config.tools,'bot_music'])],skills:[...new Set([...config.skills,'music-download'])]});
  }),
  h('p',{className:'muted'},v4?`Profile：${options.profileRef?`${options.profileRef.serviceId}/${options.profileRef.profileId}`:'未选择'} · 状态：${current?status?.state??'missing':'待保存或刷新'}`:'搜索歌曲后按候选下载；已下载歌曲可交给音色转换。'),
  v4?ui.field('Profile 引用',options.profileRef?`${options.profileRef.serviceId}/${options.profileRef.profileId}`:'',setProfile,'text',{placeholder:'music/default'}):null,
  current&&options.enabled&&!status.permitted?h('p',{className:'error'},'请在工具配置中允许 bot_music 和 music-download。'):null,
  ui.toggle('下载时附带歌词',options.includeLyrics===true,()=>set({includeLyrics:options.includeLyrics!==true})),
  h('p',null,environment?`最近环境检查：${environment.ready?'就绪':'未就绪'}；${new Date(environment.checkedAt).toLocaleString()}`:'音乐运行环境尚未检查'),
  environment?.sources?.length?h('p',{className:'muted'},`配置来源：${environment.sources.map((source:any)=>`${sourceNames[source.id]??source.id}${source.available?'':'（环境不可用）'}`).join('、')}`):null,
  h('p',null,`当前版本环境验收：${current?validation(status.protocolValidation):'未验收'}；真实下载：${current?validation(status.downloadValidation):'未验收'}`),
  h('small',null,v4?'Profile 缺失或受阻时不会自动选择其他服务；更新只从下一轮生效。':'运行目录和来源由插件全局配置。环境检查不下载歌曲；来源实际可用性以真实搜索与下载为准。'),
  h('div',{className:'actions'},!v4?ui.button('检查音乐环境',()=>mutate('skill.music.probe',{configId:config.id,revision:config.revision},'音乐环境检查完成'),{disabled:dirty||!config.id}):null,ui.button('登记下载通过',()=>record(true),{disabled:dirty||!current}),ui.button('登记下载失败',()=>record(false),{disabled:dirty||!current})));
}
