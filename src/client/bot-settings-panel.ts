import {singingCard} from './singing.js';
import {musicCard} from './music.js';
import {useVoiceModel,voiceModelPicker,type VoiceModelRole} from './voice-models.js';
import type {createUI} from './ui.js';
import type {Translate} from './locale.js';

export function botSettingsSections({h,ui,t,editor,models,profiles,busy,dirty,imageStatus,mediaStatus,update,refreshServices}:{
  h:any;ui:ReturnType<typeof createUI>;t:Translate;editor:any;models:any[];profiles:any[];busy:boolean;dirty:boolean;
  imageStatus?:any;mediaStatus?:any;update:(patch:any)=>void;refreshServices:(services:string[])=>Promise<unknown>;
}){
  const progressReply=editor.progressReply??{enabled:true,intervalSeconds:60};
  const setProgressReply=(patch:any)=>update({progressReply:{...progressReply,...patch}});
  const applyVoiceModel=(role:VoiceModelRole,profile:any)=>update(useVoiceModel(editor,role,profile,t));
  const modelPicker=(role:VoiceModelRole,serviceId?:string)=>h('div',{className:'media-model-picker'},
    voiceModelPicker(h,ui,{role,config:editor,profiles,busy,dirty,existing:true,serviceId,apply:applyVoiceModel},t),
    ui.button(t('refresh'),()=>refreshServices(role==='voice'?['gpt-sovits','breeze-tts']:['rvc'])),
  );
       const modelForReasoning=models.find((provider:any)=>provider.id===editor.model?.provider)?.models.find((item:any)=>item.id===editor.model?.model);
      const reasoningEfforts=modelForReasoning?.reasoning?.efforts??[];
      const modelSection=h('div',{className:'section-grid'},
        h('section',{className:'section-card'},
          h('h3',null,t('model')),
          h('div',{className:'fields'},
            ui.select(t('provider'),editor.model?.provider??'',[{id:'',name:t('select')},...models],v=>update({model:v?{provider:v,model:''}:null})),
            ui.select(t('model'),editor.model?.model??'',[{id:'',name:t('select')},...(models.find((p:any)=>p.id===editor.model?.provider)?.models??[])],v=>update({model:{...editor.model,model:v,reasoningEffort:undefined}})),
          ),
           ui.details(t('advanced'),ui.select(t('reasoningEffort'),editor.model?.reasoningEffort??'', [{id:'',name:t('select')},...reasoningEfforts.map((effort:string)=>({id:effort,name:effort}))],v=>update({model:editor.model?{...editor.model,reasoningEffort:v||undefined}:null}),{disabled:!editor.model||reasoningEfforts.length===0})),
        ),
      );
       const behaviorSection=h('div',{className:'section-grid'},h('section',{className:'section-card'},h('h3',null,t('behavior')),ui.toggle(t('processingReply'),progressReply.enabled,()=>setProgressReply({enabled:!progressReply.enabled})),progressReply.enabled?ui.field(t('processingReplyInterval'),String(progressReply.intervalSeconds),v=>setProgressReply({intervalSeconds:Number(v)}),'number',{min:10,max:3600,step:1}):null));
      const mediaSection=h('div',{className:'media-sections'},...['image','asr','video','voice'].map(role=>{
         const options=editor.media[role]??{},status=role==='image'?imageStatus:mediaStatus?.[role],label=({image:t('image'),asr:t('asr'),video:t('video'),voice:t('voiceTts')} as any)[role],enabled=role==='voice'?options.enabled===true:options.enabled!==false,ready=status?.keyConfigured||status?.configured;
         const set=(patch:any)=>update({media:{...editor.media,[role]:{...options,...patch}},...(role==='voice'&&patch.enabled===true?{tools:[...new Set([...editor.tools,'bot_voice'])],skills:[...new Set([...editor.skills,'voice-generation'])]}:{})});
        const imageModels=role==='image'?models.flatMap((provider:any)=>provider.models.filter((model:any)=>model.inputModalities?.includes('image')).map((model:any)=>({id:model.id,name:`${provider.id} / ${model.name}`}))):[];
        const voiceEngine=role==='voice'?(options.engine??(options.protocol==='edge_tts'?'edge_tts':options.profileRef?.serviceId??'')):'';
        const voiceService=role==='voice'&&voiceEngine!=='edge_tts'?voiceEngine:undefined;
        const voicePicker=role==='voice'?(voiceService?modelPicker('voice',voiceService):options.protocol==='edge_tts'?ui.select(t('builtinVoice'),options.voice??'zh-CN-XiaoxiaoNeural',[{id:'zh-CN-XiaoxiaoNeural',name:t('voiceXiaoxiao')},{id:'zh-CN-YunxiNeural',name:t('voiceYunxi')},{id:'en-US-AriaNeural',name:t('voiceAria')},{id:'ja-JP-NanamiNeural',name:t('voiceNanami')}],v=>set({voice:v||undefined})):null):null;
          const fields=role==='image'?[imageModels.length?ui.select(t('model'),options.model??'', [{id:'',name:t('inheritModel')},...imageModels],v=>set({model:v||undefined})):ui.field(t('model'),options.model??'',v=>set({model:v})),ui.field(t('serviceAddress'),options.baseUrl??'',v=>set({baseUrl:v.trim()||undefined}),'url',{placeholder:t('inheritAddress')}),ui.field(t('keyEnv'),options.keyEnv??'',v=>set({keyEnv:v.trim()||undefined}),'text',{placeholder:t('inheritKeyEnv'),autoComplete:'off',spellCheck:false}),ui.textarea(t('imageStyle'),editor.imageStyle,v=>update({imageStyle:v}),{rows:2}),h('small',{className:'sr-only'},t('keyEnvHint'))]:role==='voice'?[ui.select(t('engine'),voiceEngine,[{id:'',name:t('select')},{id:'edge_tts',name:'Edge TTS'},{id:'gpt-sovits',name:'GPT-SoVITS'},{id:'breeze-tts',name:'Breeze TTS'}],v=>v==='edge_tts'?set({engine:'edge_tts',protocol:'edge_tts',profileRef:undefined,format:'mp3',voice:'zh-CN-XiaoxiaoNeural'}):set({engine:v||undefined,protocol:undefined,profileRef:options.profileRef?.serviceId===v?options.profileRef:undefined,format:'wav',voice:undefined})),voicePicker,ui.select(t('reply'),options.replyMode??'on_demand',[{id:'on_demand',name:t('onDemand')},{id:'auto',name:t('textAndVoice')}],v=>set({replyMode:v}))]:[role==='asr'?ui.select(t('protocol'),options.protocol??'chat_completions',[{id:'chat_completions',name:t('chatProtocol')},{id:'transcriptions',name:t('transcriptionProtocol')}],v=>set({protocol:v})):h('span',null,t('followMainModel'))];
          return h('section',{key:role,className:'section-card media-card'},
            ui.toggle(label,enabled,()=>set({enabled:!enabled})),
            enabled?h('div',{className:role==='video'?'media-inline':'media-fields'},...fields):role==='voice'&&voicePicker?h('div',{className:'media-fields'},voicePicker):null,
            enabled?h('div',{className:'media-card-actions'},
              role!=='voice'?h('p',{className:'muted'},dirty?t('unsaved'):!status?t('loadingShort'):ready?t('configured'):t('pendingConfig')):null,
              ui.button(t('restoreDefault'),()=>{const media={...editor.media};delete media[role];update({media});},{className:'quiet'}),
            ):null,
          );
       }),musicCard(h,ui,editor,profiles,update,t),singingCard(h,ui,editor,update,modelPicker('singing'),null,t));
  const runSection=h('div',{className:'run-settings'},modelSection,behaviorSection);
  return {run:runSection,media:mediaSection};
}
