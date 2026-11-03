import type {createUI} from './ui.js';
import {chinese,type Translate} from './locale.js';

export function musicCard(h:any,ui:ReturnType<typeof createUI>,config:any,profiles:any[],update:(patch:any)=>void,t:Translate=chinese){
  const options=config.media.music??{};
  const set=(patch:any)=>update({media:{...config.media,music:{enabled:false,includeLyrics:false,...options,...patch}}});
  const key=options.profileRef?`${options.profileRef.serviceId}/${options.profileRef.profileId}`:'';
  const choices=[{id:'',name:t('selectMusicSource')},...profiles.filter(item=>item.serviceId==='music'&&(item.capabilities?.includes('music.acquire')||item.capabilities?.includes('music.search'))).map(item=>({id:`${item.serviceId}/${item.profileId}`,name:`${item.displayName}${item.state==='ready'?'':t('unavailableSuffix')}`,disabled:item.state!=='ready'}))];
  if(key&&!choices.some(choice=>choice.id===key))choices.push({id:key,name:t('currentSourceUnavailable'),disabled:true});
  const setProfile=(value:string)=>{const [serviceId,profileId]=value.split('/',2);set({profileRef:serviceId&&profileId?{serviceId,profileId}:undefined});};
  return h('section',{key:'music',className:'item'},ui.toggle(t('music'),options.enabled===true,()=>{
    if(options.enabled)set({enabled:false});else update({media:{...config.media,music:{includeLyrics:false,...options,enabled:true}},tools:[...new Set([...config.tools,'bot_music'])],skills:[...new Set([...config.skills,'music-download'])]});
  }),ui.select(t('musicSource'),key,choices,setProfile),ui.toggle(t('includeLyrics'),options.includeLyrics===true,()=>set({includeLyrics:options.includeLyrics!==true})));
}
