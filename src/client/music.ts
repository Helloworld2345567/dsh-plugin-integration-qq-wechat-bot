import type {createUI} from './ui.js';

export function musicCard(h:any,ui:ReturnType<typeof createUI>,config:any,profiles:any[],update:(patch:any)=>void){
  const options=config.media.music??{};
  const set=(patch:any)=>update({media:{...config.media,music:{enabled:false,includeLyrics:false,...options,...patch}}});
  const key=options.profileRef?`${options.profileRef.serviceId}/${options.profileRef.profileId}`:'';
  const choices=[{id:'',name:'请选择来源'},...profiles.filter(item=>item.serviceId==='music'&&(item.capabilities?.includes('music.acquire')||item.capabilities?.includes('music.search'))).map(item=>({id:`${item.serviceId}/${item.profileId}`,name:`${item.displayName}${item.state==='ready'?'':'（不可用）'}`,disabled:item.state!=='ready'}))];
  if(key&&!choices.some(choice=>choice.id===key))choices.push({id:key,name:'当前来源（不可用）',disabled:true});
  const setProfile=(value:string)=>{const [serviceId,profileId]=value.split('/',2);set({profileRef:serviceId&&profileId?{serviceId,profileId}:undefined});};
  return h('section',{key:'music',className:'item'},ui.toggle('音乐搜索与下载',options.enabled===true,()=>{
    if(options.enabled)set({enabled:false});else update({media:{...config.media,music:{includeLyrics:false,...options,enabled:true}},tools:[...new Set([...config.tools,'bot_music'])],skills:[...new Set([...config.skills,'music-download'])]});
  }),ui.select('音乐来源',key,choices,setProfile),ui.toggle('下载时附带歌词',options.includeLyrics===true,()=>set({includeLyrics:options.includeLyrics!==true})));
}
