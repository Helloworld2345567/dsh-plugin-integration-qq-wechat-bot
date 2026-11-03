import type {createUI} from './ui.js';

export function singingCard(h:any,ui:ReturnType<typeof createUI>,config:any,update:(patch:any)=>void,modelPicker:any,librarySettings?:any){
  const options=config.media.singing??{},defaults={enabled:false,speakerId:0,pitchShift:0,indexRate:0,defaultOutput:'mp3',separation:{enabled:false,instrumentalMix:false,volume:1,status:'unconfigured'}};
  const set=(patch:any)=>update({media:{...config.media,singing:{...defaults,...options,...patch}}});
  return h('section',{key:'singing',className:'item'},ui.toggle('音色转换 STS',options.enabled===true,()=>{
    if(options.enabled)set({enabled:false});else update({media:{...config.media,singing:{...defaults,...options,enabled:true}},tools:[...new Set([...config.tools,'bot_sing'])],skills:[...new Set([...config.skills,'singing-conversion'])]});
  }),modelPicker,ui.details('配置',
    ui.field('说话人编号',String(options.speakerId??0),value=>set({speakerId:Number(value)}),'number',{min:0,max:65535,step:1}),
    ui.field('音高调整（半音）',String(options.pitchShift??0),value=>set({pitchShift:Number(value)}),'number',{min:-24,max:24,step:1}),
    ui.select('转换输出',options.defaultOutput??'mp3',[{id:'mp3',name:'MP3'},{id:'wav',name:'WAV'}],value=>set({defaultOutput:value}))),librarySettings);
}
