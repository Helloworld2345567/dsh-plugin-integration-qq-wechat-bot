import type {createUI} from './ui.js';
import {chinese,type Translate} from './locale.js';

export function singingCard(h:any,ui:ReturnType<typeof createUI>,config:any,update:(patch:any)=>void,modelPicker:any,librarySettings?:any,t:Translate=chinese){
  const options=config.media.singing??{},defaults={enabled:false,speakerId:0,pitchShift:0,indexRate:0,defaultOutput:'mp3',separation:{enabled:false,instrumentalMix:false,volume:1,status:'unconfigured'}};
  const set=(patch:any)=>update({media:{...config.media,singing:{...defaults,...options,...patch}}});
  const settings=ui.details(t('configuration'),
    ui.field(t('speaker'),String(options.speakerId??0),value=>set({speakerId:Number(value)}),'number',{min:0,max:65535,step:1}),
    ui.field(t('pitchSemitones'),String(options.pitchShift??0),value=>set({pitchShift:Number(value)}),'number',{min:-24,max:24,step:1}),
    ui.field(t('retrievalRate'),String(options.indexRate??0),value=>set({indexRate:Number(value)}),'number',{min:0,max:1,step:0.05}),
    ui.select(t('output'),options.defaultOutput??'mp3',[{id:'mp3',name:'MP3'},{id:'wav',name:'WAV'}],value=>set({defaultOutput:value})));
  return h('section',{key:'singing',className:'item'},ui.toggle(t('singing'),options.enabled===true,()=>{
    if(options.enabled)set({enabled:false});else update({media:{...config.media,singing:{...defaults,...options,enabled:true}},tools:[...new Set([...config.tools,'bot_sing'])],skills:[...new Set([...config.skills,'singing-conversion'])]});
  }),settings,librarySettings,modelPicker);
}
