import path from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {z} from 'zod';
import {canonicalJsonHash} from './canonical-json.js';
import {ConflictError,type Store} from './store.js';
import {ReadOnlyServiceDiscovery,type DiscoveryCandidate,type ServiceDiscoveryStatus} from './service-discovery.js';
import type {ProfileStore} from './profile-store.js';
import {profileIdSchema,sha256Schema} from './service-contract.js';
import {gptSovitsSchema} from './types.js';
import {normalizeGptSovitsBaseUrl} from './voice-config.js';
import {sanitizePublicServiceText} from './service-errors.js';

const SERVICES=['rvc','gpt-sovits'] as const;
type VoiceService=typeof SERVICES[number];
const SOURCE_ID='voice-model-library';
export const voiceLibrarySettingsSchema=z.object({
  modelsRoot:z.string().trim().max(4096).refine(value=>!value||path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value),'模型根目录须为绝对路径').transform(value=>value?path.resolve(value):''),
  gptSovitsUrl:z.string().trim().min(1).max(2048).refine(value=>{try{normalizeGptSovitsBaseUrl(value);return true;}catch{return false;}},'请输入有效的 GPT-SoVITS 服务地址').transform(normalizeGptSovitsBaseUrl),
}).strict();
export const voiceLibrarySettingsInputSchema=voiceLibrarySettingsSchema.extend({expectedRevision:z.string().regex(/^sha256:[a-f0-9]{64}$/).optional()});
export type VoiceLibrarySettings=z.infer<typeof voiceLibrarySettingsSchema>;
export interface VoiceModelReport {profileId:string;displayName:string;state:'ready'|'blocked';diagnostics:string[]}
export interface VoiceLibraryReport {state:'ready'|'partial'|'blocked'|'missing';profileCount:number;checkedAt:number;diagnostics:string[];models:VoiceModelReport[]}
export interface VoiceLibraryView extends VoiceLibrarySettings {revision:string;reports:Record<VoiceService,VoiceLibraryReport>}
export interface VoiceScannerContext {modelsRoot:string;projectRoot:string;python:string;script:string;cache:string;signal:AbortSignal}
export interface VoiceModelScanner {scan(context:VoiceScannerContext):Promise<unknown>;device?(context:VoiceScannerContext):Promise<'cpu'|'cuda'>}

const relativeFile=z.string().min(1).max(4096).refine(value=>!path.isAbsolute(value)&&!path.win32.isAbsolute(value)&&!value.split(/[\\/]/).includes('..')&&!/[\x00-\x1f]/.test(value),'模型资源必须使用库内相对路径');
const scannerModelSchema=z.object({
  id:profileIdSchema,serviceId:z.enum(SERVICES),displayName:z.string().min(1).max(160),modelVersion:z.string().max(40),modelLabel:z.string().max(240).optional(),
  state:z.enum(['ready','blocked']),files:z.object({weights:relativeFile.optional(),index:relativeFile.optional(),gpt:relativeFile.optional(),sovits:relativeFile.optional(),reference:relativeFile.optional()}).strict(),
  reference:z.object({text:z.string().max(32000),promptLang:z.string().max(40),textLang:z.string().max(40)}).optional(),resourceHash:sha256Schema,diagnostics:z.array(z.string().max(2000)).max(50).default([]),
}).passthrough();
const scannerResultSchema=z.object({version:z.literal(1),models:z.array(scannerModelSchema).max(1000),diagnostics:z.array(z.string().max(2000)).max(100).default([]),error:z.never().optional()}).passthrough();
type ScannerModel=z.infer<typeof scannerModelSchema>;
type ResourceIdentity={path:string;size:number;mtimeMs:number};
const safe=(value:unknown)=>sanitizePublicServiceText(value,'模型信息需要补全，请检查模型说明文件。');
const revision=(value:VoiceLibrarySettings)=>`sha256:${canonicalJsonHash(value)}`;
const emptyReport=():VoiceLibraryReport=>({state:'missing',profileCount:0,checkedAt:0,diagnostics:['尚未配置模型根目录。'],models:[]});

/** Operator-owned deployment settings are kept separate from model packages and personas. */
export class VoiceModelLibrary {
  readonly discovery:ReadOnlyServiceDiscovery;
  private reports:Record<VoiceService,VoiceLibraryReport>={rvc:emptyReport(),'gpt-sovits':emptyReport()};
  private pending:Promise<unknown>=Promise.resolve();
  private scanning:Promise<void>|undefined;
  constructor(readonly store:Store,readonly profiles:ProfileStore,readonly scanner:VoiceModelScanner,readonly defaults:Partial<VoiceLibrarySettings>={}){
    this.discovery=new ReadOnlyServiceDiscovery(profiles,new Map());
  }
  private settings():VoiceLibrarySettings{return voiceLibrarySettingsSchema.parse(this.store.get('voice-model-library','settings')??{modelsRoot:this.defaults.modelsRoot??process.env.BOT_VOICE_MODELS_ROOT??'',gptSovitsUrl:this.defaults.gptSovitsUrl??'http://127.0.0.1:9880'});}
  view():VoiceLibraryView {const settings=this.settings();return{...settings,revision:revision(settings),reports:structuredClone(this.reports)};}
  private exclusive<T>(action:()=>Promise<T>):Promise<T>{const current=this.pending.then(action,action);this.pending=current.catch(()=>{});return current;}
  async save(input:unknown,signal:AbortSignal):Promise<VoiceLibraryView>{
    const {expectedRevision,...settings}=voiceLibrarySettingsInputSchema.parse(input);
    return this.exclusive(async()=>{
      signal.throwIfAborted();const current=this.settings();
      if(expectedRevision!==revision(current)&&(expectedRevision!==undefined||this.store.get('voice-model-library','settings')!==undefined))throw new ConflictError('模型服务配置已变化，请刷新后重试');
      this.store.put('voice-model-library','settings',settings);
      await this.refreshNow(signal);return this.view();
    });
  }
  async initialize(signal:AbortSignal=new AbortController().signal):Promise<void>{await this.refresh(signal);}
  async refresh(signal:AbortSignal):Promise<void>{
    if(this.scanning)return this.scanning;
    const pending=this.exclusive(()=>this.refreshNow(signal));this.scanning=pending;
    try{await pending;}finally{if(this.scanning===pending)this.scanning=undefined;}
  }
  status(serviceId:VoiceService):ServiceDiscoveryStatus {
    const report=this.reports[serviceId],configured=!!this.settings().modelsRoot;
    return{serviceId,state:report.state,registeredRoots:configured?1:0,scannedRoots:report.checkedAt&&report.state!=='missing'?1:0,profileCount:report.profileCount,checkedAt:report.checkedAt,safeDiagnostic:report.diagnostics.join(' ').slice(0,1000)||undefined};
  }
  private unavailable(state:'missing'|'blocked',diagnostic:string):void{
    for(const serviceId of SERVICES){this.discovery.failSource(serviceId,SOURCE_ID,state);this.reports[serviceId]={state,profileCount:0,checkedAt:Date.now(),diagnostics:[diagnostic],models:[]};}
  }
  private async resource(file:string,label:string,diagnostics:string[],identities:ResourceIdentity[],directory=false):Promise<boolean>{
    try{const info=await lstat(file);if(info.isSymbolicLink()||!(directory?info.isDirectory():info.isFile()))throw Error('invalid');if(!directory)identities.push({path:file,size:info.size,mtimeMs:info.mtimeMs});return true;}
    catch{diagnostics.push(`缺少或无法读取${label}。`);return false;}
  }
  private async modelFile(root:string,relative:string|undefined,label:string,diagnostics:string[]):Promise<string|undefined>{
    if(!relative){diagnostics.push(`缺少${label}。`);return;}
    const resolved=path.resolve(root,relative),within=path.relative(root,resolved);
    if(within.startsWith('..')||path.isAbsolute(within)){diagnostics.push(`${label}路径不在模型库内。`);return;}
    try{const info=await lstat(resolved),canonical=await realpath(resolved),canonicalRelative=path.relative(root,canonical);if(!info.isFile()||info.isSymbolicLink()||canonicalRelative.startsWith('..')||path.isAbsolute(canonicalRelative))throw Error('invalid');return resolved;}
    catch{diagnostics.push(`缺少或无法读取${label}。`);return;}
  }
  private async candidate(model:ScannerModel,context:VoiceScannerContext,settings:VoiceLibrarySettings,device:'cpu'|'cuda'):Promise<{candidate:DiscoveryCandidate;report:VoiceModelReport}>{
    const diagnostics=model.diagnostics.map(safe),identities:ResourceIdentity[]=[],root=context.modelsRoot;
    let managedConfig:Record<string,unknown>={};
    if(model.serviceId==='rvc'){
      const rvcRoot=path.join(context.projectRoot,'RVC');
      await this.resource(rvcRoot,'RVC 项目目录',diagnostics,identities,true);
      await this.resource(path.join(rvcRoot,'assets','hubert_base','config.json'),'RVC HuBERT 配置',diagnostics,identities);
      await this.resource(path.join(rvcRoot,'assets','hubert_base','pytorch_model.bin'),'RVC HuBERT 权重',diagnostics,identities);
      await this.resource(path.join(rvcRoot,'assets','rmvpe','rmvpe.pt'),'RVC RMVPE 权重',diagnostics,identities);
      const weights=await this.modelFile(root,model.files.weights,'RVC 角色权重',diagnostics),index=model.files.index?await this.modelFile(root,model.files.index,'RVC 索引',diagnostics):undefined;
      if(!['v1','v2'].includes(model.modelVersion))diagnostics.push('RVC 模型版本不受支持。');
      managedConfig={protocol:'rvc_cli_v1',python:context.python,rvcRoot,device,modelVersion:model.modelVersion,singingModelId:model.id,...weights?{singingWeightsPath:weights}:{},...index?{singingIndexPath:index}:{},speakerId:0,pitchShift:0,indexRate:index?0.75:0};
      const separator=path.join(rvcRoot,'assets','pymss_weights','model_bs_roformer_ep_368_sdr_12.9628.ckpt');
      const separatorIdentity:ResourceIdentity[]=[];if(await this.resource(separator,'分离模型',[],separatorIdentity)){identities.push(...separatorIdentity);managedConfig.separation={enabled:true,status:'configured',modelId:'vocals',modelPath:separator,instrumentalMix:true,volume:1};}
    }else{
      const pretrained=path.join(context.projectRoot,'GPT-SoVITS','GPT_SoVITS','pretrained_models');
      await this.resource(path.join(pretrained,'chinese-hubert-base','config.json'),'GPT-SoVITS HuBERT 配置',diagnostics,identities);
      await this.resource(path.join(pretrained,'chinese-hubert-base','pytorch_model.bin'),'GPT-SoVITS HuBERT 权重',diagnostics,identities);
      await this.resource(path.join(pretrained,'chinese-roberta-wwm-ext-large','config.json'),'GPT-SoVITS 文本编码配置',diagnostics,identities);
      await this.resource(path.join(pretrained,'chinese-roberta-wwm-ext-large','pytorch_model.bin'),'GPT-SoVITS 文本编码权重',diagnostics,identities);
      if(model.modelVersion==='v4'){
        await this.resource(path.join(pretrained,'gsv-v4-pretrained','s2Gv4.pth'),'GPT-SoVITS v4 基座',diagnostics,identities);
        await this.resource(path.join(pretrained,'gsv-v4-pretrained','vocoder.pth'),'GPT-SoVITS v4 声码器',diagnostics,identities);
      }
      const gpt=await this.modelFile(root,model.files.gpt,'GPT 权重',diagnostics),sovits=await this.modelFile(root,model.files.sovits,'SoVITS 权重',diagnostics),reference=await this.modelFile(root,model.files.reference,'参考音频',diagnostics);
      const config={baseUrl:settings.gptSovitsUrl,modelVersion:model.modelVersion,gptWeightsPath:gpt,sovitsWeightsPath:sovits,refAudioPath:reference,promptText:model.reference?.text,promptLang:model.reference?.promptLang,textLang:model.reference?.textLang};
      if(!gptSovitsSchema.safeParse(config).success)diagnostics.push('GPT-SoVITS 权重、参考文本或语言配置不完整。');
      managedConfig={protocol:'gpt_sovits',voice:model.id,healthPath:'/openapi.json',...Object.fromEntries(Object.entries(config).filter(([,value])=>value!==undefined))};
    }
    const state=model.state==='ready'&&!diagnostics.length?'ready':'blocked',displayName=safe(model.displayName),uniqueDiagnostics=[...new Set(diagnostics)];
    return{candidate:{profileId:model.id,displayName,modelLabel:model.modelLabel?safe(model.modelLabel):model.modelVersion,capabilities:[model.serviceId==='rvc'?'rvc.convert':'gpt-sovits.speak'],state,managedConfig,resourceHash:canonicalJsonHash({model:model.resourceHash,dependencies:identities})},report:{profileId:model.id,displayName,state,diagnostics:uniqueDiagnostics}};
  }
  private async refreshNow(signal:AbortSignal):Promise<void>{
    const settings=this.settings();if(!settings.modelsRoot){this.unavailable('missing','尚未配置模型根目录。');return;}
    const diagnostics:string[]=[],identities:ResourceIdentity[]=[],projectRoot=path.dirname(settings.modelsRoot),python=path.join(projectRoot,'.codex','venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),script=path.join(projectRoot,'scripts','model_catalog.py');
    const rootExists=await this.resource(settings.modelsRoot,'模型根目录',diagnostics,identities,true);
    await this.resource(python,'项目 Python 环境',diagnostics,identities);await this.resource(script,'模型扫描入口',diagnostics,identities);
    if(diagnostics.length){this.unavailable(rootExists?'blocked':'missing',diagnostics.join(' '));return;}
    try{
      const root=await realpath(settings.modelsRoot),context:VoiceScannerContext={modelsRoot:root,projectRoot,python,script,cache:path.join(this.store.home,'voice-model-cache','catalog.json'),signal:AbortSignal.any([signal,AbortSignal.timeout(120_000)])};
      const result=scannerResultSchema.parse(await this.scanner.scan(context));context.signal.throwIfAborted();const device=await this.scanner.device?.(context)??'cpu';
      const grouped=new Map<string,ScannerModel[]>();
      for(const model of result.models){const key=`${model.serviceId}/${model.id}`,group=grouped.get(key)??[];group.push(model);grouped.set(key,group);}
      const models=[...grouped.values()].map(group=>group.length===1?group[0]:{...group[0],state:'blocked' as const,resourceHash:canonicalJsonHash(group.map(model=>model.resourceHash).sort()),diagnostics:[...group[0].diagnostics,'多个模型包使用相同模型 ID，请为独立变体设置不同 ID。']});
      const candidates=await Promise.all(models.map(model=>this.candidate(model,context,settings,device)));
      context.signal.throwIfAborted();
      for(const serviceId of SERVICES){
        const selected=candidates.filter(item=>item.candidate.capabilities[0].startsWith(`${serviceId}.`));
        this.discovery.reconcile(serviceId,SOURCE_ID,selected.map(item=>item.candidate));
        const models=selected.map(item=>item.report),blocked=models.filter(item=>item.state==='blocked').length,globalDiagnostics=result.diagnostics.map(safe);
        this.reports[serviceId]={state:models.length?(blocked===models.length?'blocked':blocked?'partial':'ready'):'missing',profileCount:models.length,checkedAt:Date.now(),diagnostics:globalDiagnostics.length?globalDiagnostics:models.length?[]:['该目录未发现此类模型。'],models};
      }
    }catch{this.unavailable('blocked',signal.aborted?'模型扫描已取消。':'模型扫描失败，请检查共享 Python 环境、模型说明和目录访问权限。');}
  }
}
