import type {createUI} from './ui.js';

export function singingCard(h:any,ui:ReturnType<typeof createUI>,config:any,dirty:boolean,status:any,update:(patch:any)=>void,mutate:(action:string,input:any,message?:string)=>Promise<any>,ask:(title:string,value?:string)=>Promise<string|null>){
  const options=config.media.singing??{};
  const separation={enabled:false,modelId:'',modelPath:'',instrumentalMix:false,volume:1,...(options.separation??{})};
  const set=(patch:any)=>update({media:{...config.media,singing:{enabled:false,protocol:'rvc_http_v1',modelVersion:'v2',speakerId:0,pitchShift:0,defaultOutput:'mp3',separation:{enabled:false,modelId:'',modelPath:'',instrumentalMix:false,volume:1},...options,...patch}}});
  const current=!dirty&&status?.revision===config.revision;
  const label=(value?:string)=>({PASS:'已通过',FAIL:'失败',BLOCKED:'受阻',NOT_RUN:'尚未验收'} as Record<string,string>)[value??'NOT_RUN']??'尚未验收';
  const record=async(passed:boolean)=>{const evidence=await ask(passed?'填写真实转换及试听验收依据':'填写实际转换失败的现象');if(evidence?.trim())await mutate('capability.record',{configId:config.id,revision:config.revision,role:'singing',status:passed?'PASS':'FAIL',evidence:evidence.trim()},'已记录当前配置版本的验收结果');};
  return h('section',{key:'singing',className:'item'},ui.toggle('音色转换 STS',options.enabled===true,()=>{
    if(options.enabled)set({enabled:false});
    else update({media:{...config.media,singing:{protocol:'rvc_http_v1',modelVersion:'v2',speakerId:0,pitchShift:0,defaultOutput:'mp3',separation:{enabled:false,modelId:'',modelPath:'',instrumentalMix:false,volume:1},...options,enabled:true}},tools:[...new Set([...config.tools,'bot_sing'])],skills:[...new Set([...config.skills,'singing-conversion'])]});
  }),h('p',{className:'muted'},dirty?'未保存，保存后检查配置':!current?'状态未加载':`${options.enabled?'已开启':'已关闭'} · ${status.configured?'配置完整':'待配置'}`),
    h('p',{className:'muted'},`协议验证：${current?label(status.protocolValidation?.status):'待保存或刷新'} · 真实音色转换：${current?label(status.conversionValidation?.status):'待保存或刷新'}`),
    h('p',{className:'muted'},separation.enabled?`人声分离：${separation.modelId&&separation.modelPath?'模型已配置':'模型待配置'} · 协议 rvc_separate_cli · ${separation.instrumentalMix?'输出伴奏混音':'仅输出转换人声'}`:'人声分离未启用，混音输入仍会阻断，请提供纯人声音频。'),
    current&&options.enabled&&!status.permitted?h('p',{className:'error'},'请在工具配置中允许 bot_sing 和 singing-conversion。'):null,
    ui.details('配置',
      ui.field('RVC 服务地址',options.serviceUrl??'',value=>set({serviceUrl:value||undefined})),
      ui.select('RVC 模型版本',options.modelVersion??'v2',[{id:'v1',name:'v1'},{id:'v2',name:'v2'}],value=>set({modelVersion:value})),
      ui.field('RVC 音色名称',options.singingModelId??'',value=>set({singingModelId:value||undefined})),
      ui.field('RVC 角色权重路径',options.singingWeightsPath??'',value=>set({singingWeightsPath:value||undefined})),
      ui.field('RVC 索引路径（可选）',options.singingIndexPath??'',value=>set({singingIndexPath:value||undefined,indexRate:value?(options.singingIndexPath?options.indexRate??0.75:0.75):0})),
      ui.field('说话人编号',String(options.speakerId??0),value=>set({speakerId:Number(value)}),'number',{min:0,max:65535,step:1}),
      ui.field('音高调整（半音）',String(options.pitchShift??0),value=>set({pitchShift:Number(value)}),'number',{min:-24,max:24,step:1}),
      ui.field('索引检索比例',String(options.indexRate??(options.singingIndexPath?0.75:0)),value=>set({indexRate:Number(value)}),'number',{min:0,max:1,step:0.05,disabled:!options.singingIndexPath}),
      ui.select('转换输出',options.defaultOutput??'mp3',[{id:'mp3',name:'MP3 · 192 kbps'},{id:'wav',name:'WAV'}],value=>set({defaultOutput:value})),
      h('hr',null),
      h('strong',null,'人声分离（可选）'),
      ui.toggle('启用分离模型',separation.enabled,()=>set({separation:{...separation,enabled:!separation.enabled}})),
      ui.select('分离模型',separation.modelId??'', [{id:'',name:'请选择'},...['vocals','vocals-aggressive'].map(id=>({id,name:id}))],value=>set({separation:{...separation,modelId:value||undefined}})),
      ui.field('分离模型权重路径',separation.modelPath??'',value=>set({separation:{...separation,modelPath:value||undefined}})),
      ui.toggle('混回伴奏',separation.instrumentalMix===true,()=>set({separation:{...separation,instrumentalMix:!separation.instrumentalMix}})),
      ui.field('伴奏音量',String(separation.volume??1),value=>set({separation:{...separation,volume:Number(value)}}),'number',{min:0,max:2,step:0.05}),
      h('small',null,'模型权重路径仅由运营者配置。默认不启用分离，mixed 输入仍会阻断；分离配置完整后由 RVC/PyMSS worker 提取人声并按偏好混音。'),
      h('small',null,'独立 RVC 模型决定目标音色。路径由 RVC 服务读取，不使用 TTS 权重或参考音频。未完成配置时可以关闭 STS 并保存草稿。'),
      h('div',{className:'actions'},ui.button('检查服务',()=>mutate('skill.singing.probe',{configId:config.id,revision:config.revision},'服务检查完成'),{disabled:dirty||!options.serviceUrl}),ui.button('登记试听通过',()=>record(true),{disabled:dirty||!current||!status.configured}),ui.button('登记验收失败',()=>record(false),{disabled:dirty||!current||!status.configured})),
      current&&status.protocolValidation?.evidence?h('small',null,status.protocolValidation.evidence):null,
      current&&status.conversionValidation?.evidence?h('small',null,status.conversionValidation.evidence):null,
      h('small',null,'协议通过仅确认服务响应；真实转换须检查完整输出并试听目标音色。修改配置后需重新验收。')
    )
  );
}
