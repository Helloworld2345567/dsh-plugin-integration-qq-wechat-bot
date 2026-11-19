import type {createUI} from './ui.js';
import {chinese,type Translate} from './locale.js';

export function singingCard(h:any,ui:ReturnType<typeof createUI>,config:any,update:(patch:any)=>void,modelPicker:any,librarySettings?:any,t:Translate=chinese){
  const options=config.media.singing??{},defaults={enabled:false,defaultOutput:'mp3'};
  const set=(patch:any)=>update({media:{...config.media,singing:{...defaults,...options,...patch}}});
  const settings=h('div',{className:'media-fields media-fields-four'},
    h('div',{className:'full'},modelPicker),
    ui.field(t('speaker'),String(options.speakerId??''),value=>set({speakerId:value===''?undefined:Number(value)}),'number',{placeholder:t('profileDefault'),min:0,max:65535,step:1}),
    ui.field(t('pitchSemitones'),String(options.pitchShift??''),value=>set({pitchShift:value===''?undefined:Number(value)}),'number',{placeholder:t('profileDefault'),min:-24,max:24,step:1}),
    ui.field(t('retrievalRate'),String(options.indexRate??''),value=>set({indexRate:value===''?undefined:Number(value)}),'number',{placeholder:t('profileDefault'),min:0,max:1,step:0.05}),
    ui.select(t('output'),options.defaultOutput??'mp3',[{id:'mp3',name:'MP3'},{id:'wav',name:'WAV'}],value=>set({defaultOutput:value})));
  return h('section',{key:'singing',className:'section-card media-card'},ui.toggle(t('singing'),options.enabled===true,()=>{
    if(options.enabled)set({enabled:false});else update({media:{...config.media,singing:{...defaults,...options,enabled:true}},tools:[...new Set([...config.tools,'bot_sing'])],skills:[...new Set([...config.skills,'singing-conversion'])]});
  }),settings,librarySettings);
}
