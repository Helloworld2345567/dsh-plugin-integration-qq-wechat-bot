import type {createUI} from './ui.js';
import {chinese,type Translate} from './locale.js';

export function musicCard(h:any,ui:ReturnType<typeof createUI>,config:any,profiles:any[],update:(patch:any)=>void,t:Translate=chinese){
  const options=config.media.music??{};
  const set=(patch:any)=>update({media:{...config.media,music:{enabled:false,includeLyrics:false,...options,...patch}}});
  const key=options.profileRef?`${options.profileRef.serviceId}/${options.profileRef.profileId}`:'';
  const choices=[{id:'',name:t('selectMusicSource')},...profiles.filter(item=>item.serviceId==='music'&&(item.capabilities?.includes('music.acquire')||item.capabilities?.includes('music.search'))&&item.state==='ready').map(item=>({id:`${item.serviceId}/${item.profileId}`,name:item.displayName,disabled:false}))];
  const setProfile=(value:string)=>{const [serviceId,profileId]=value.split('/',2);set({profileRef:serviceId&&profileId?{serviceId,profileId}:undefined});};
  const settings=ui.details(t('configuration'),ui.select(t('musicSource'),choices.some(choice=>choice.id===key)?key:'',choices,setProfile),ui.toggle(t('includeLyrics'),options.includeLyrics===true,()=>set({includeLyrics:options.includeLyrics!==true})));
  return h('section',{key:'music',className:'item'},ui.toggle(t('music'),options.enabled===true,()=>{
    if(options.enabled)set({enabled:false});else update({media:{...config.media,music:{includeLyrics:false,...options,enabled:true}},tools:[...new Set([...config.tools,'bot_music'])],skills:[...new Set([...config.skills,'music-download'])]});
  }),settings);
}
