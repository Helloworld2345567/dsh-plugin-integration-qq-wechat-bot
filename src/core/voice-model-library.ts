import {diagnostic,diagnosticDetail,type ResourceLabel} from '../i18n/diagnostics.js';
import type {DiagnosticDetail} from '../i18n/common.js';
import path from 'node:path';
import {lstat,realpath,readdir} from 'node:fs/promises';
import {z} from 'zod';
import {canonicalJsonHash} from './canonical-json.js';
import {ConflictError} from './errors.js';
import type {VoiceLibrarySettingsRepository} from './ports/media.js';

import {ReadOnlyServiceDiscovery,type DiscoveryCandidate,type ServiceDiscoveryStatus} from './service-discovery.js';
import type {ProfileStore} from './profile-store.js';
import {profileIdSchema,sha256Schema} from './service-contract.js';
import {gptSovitsSchema} from './types.js';
import {normalizeGptSovitsBaseUrl,normalizeVoiceServiceBaseUrl} from './voice-config.js';
import {sanitizePublicServiceText,sanitizeMessageDescriptor} from './service-errors.js';
import {ExternalServiceLauncher,type LaunchableService,type ServiceStartResult, type ServiceLauncher} from './service-launcher.js';
import {defaultMusicHome,musicHomeSchema,musicSourcesSchema,DEFAULT_MUSIC_SOURCES} from './music-config.js';
import {imageServiceSettingsSchema} from './image-service-config.js';

const SERVICES=['rvc','gpt-sovits','breeze-tts'] as const;
type VoiceService=typeof SERVICES[number];
const SOURCE_ID='voice-model-library';
export const voiceLibrarySettingsSchema=z.object({
  modelsRoot:z.string().trim().max(4096).refine(value=>!value||path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value),{message:'模型根目录须为绝对路径',params:{message:diagnostic('absolutePathRequired')}}).transform(value=>value?path.resolve(value):''),
  gptSovitsUrl:z.string().trim().min(1).max(2048).refine(value=>{try{normalizeGptSovitsBaseUrl(value);return true;}catch{return false;}},{message:'请输入有效的 GPT-SoVITS 服务地址',params:{message:diagnostic('serviceUrlInvalid')}}).transform(normalizeGptSovitsBaseUrl),
  breezeTtsUrl:z.string().trim().min(1).max(2048).refine(value=>{try{normalizeVoiceServiceBaseUrl(value);return true;}catch{return false;}},{message:'请输入有效的 Breeze TTS 服务地址',params:{message:diagnostic('serviceUrlInvalid')}}).transform(normalizeVoiceServiceBaseUrl).default('http://127.0.0.1:8080'),
  gptSovitsProjectRoot:z.string().trim().max(4096).refine(value=>!value||path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value),{message:'GPT-SoVITS 项目目录须为绝对路径',params:{message:diagnostic('absolutePathRequired')}}).transform(value=>value?path.resolve(value):'').default(''),
  breezeTtsProjectRoot:z.string().trim().max(4096).refine(value=>!value||path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value),{message:'Breeze TTS 项目目录须为绝对路径',params:{message:diagnostic('absolutePathRequired')}}).transform(value=>value?path.resolve(value):'').default(''),
  breezeTtsVoicesRoot:z.string().trim().max(4096).refine(value=>!value||path.isAbsolute(value)&&!/[\x00-\x1f]/.test(value),{message:'Breeze TTS 音色目录须为绝对路径',params:{message:diagnostic('absolutePathRequired')}}).transform(value=>value?path.resolve(value):'').default(''),
  musicHome:musicHomeSchema.default(defaultMusicHome()),
  musicSources:musicSourcesSchema.default([...DEFAULT_MUSIC_SOURCES]),
  imageProtocol:imageServiceSettingsSchema.shape.imageProtocol,
  openAiBaseUrl:imageServiceSettingsSchema.shape.openAiBaseUrl,
  openAiModel:imageServiceSettingsSchema.shape.openAiModel,
  openAiKeyEnv:imageServiceSettingsSchema.shape.openAiKeyEnv,
  comfyUiBaseUrl:imageServiceSettingsSchema.shape.comfyUiBaseUrl,
  comfyUiWorkflowPath:imageServiceSettingsSchema.shape.comfyUiWorkflowPath,
}).strict();
export const voiceLibrarySettingsInputSchema=voiceLibrarySettingsSchema.extend({expectedRevision:z.string().regex(/^sha256:[a-f0-9]{64}$/).optional()});
export type VoiceLibrarySettings=z.infer<typeof voiceLibrarySettingsSchema>;
export interface VoiceModelReport {profileId:string;displayName:string;state:'ready'|'blocked';diagnostics:string[];diagnosticDetails?:DiagnosticDetail[]}
export interface VoiceLibraryReport {state:'ready'|'partial'|'blocked'|'missing';profileCount:number;checkedAt:number;diagnostics:string[];diagnosticDetails?:DiagnosticDetail[];models:VoiceModelReport[]}
export interface VoiceLibraryView extends VoiceLibrarySettings {revision:string;reports:Record<VoiceService,VoiceLibraryReport>}
export interface VoiceScannerContext {modelsRoot:string;projectRoot:string;python:string;script:string;cache:string;signal:AbortSignal}
export interface VoiceModelScanner {scan(context:VoiceScannerContext):Promise<unknown>;device?(context:VoiceScannerContext):Promise<'cpu'|'cuda'>}

const relativeFile=z.string().min(1).max(4096).refine(value=>!path.isAbsolute(value)&&!path.win32.isAbsolute(value)&&!value.split(/[\\/]/).includes('..')&&!/[\x00-\x1f]/.test(value),{message:'模型资源必须使用库内相对路径',params:{message:diagnostic('modelRelativePath')}});
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
const reportDiagnostics=(details:DiagnosticDetail[])=>{const diagnosticDetails=details.map(item=>({text:safe(item.text),...item.message?{message:sanitizeMessageDescriptor(item.message)}:{}}));return{diagnostics:diagnosticDetails.map(item=>item.text),diagnosticDetails};};
const emptyReport=():VoiceLibraryReport=>({state:'missing',profileCount:0,checkedAt:0,...reportDiagnostics([diagnosticDetail('modelsRootMissing')]),models:[]});

/** Operator-owned deployment settings are kept separate from model packages and personas. */
export class VoiceModelLibrary {
  readonly discovery:ReadOnlyServiceDiscovery;
  private reports:Record<VoiceService,VoiceLibraryReport>={rvc:emptyReport(),'gpt-sovits':emptyReport(),'breeze-tts':emptyReport()};
  private pending:Promise<unknown>=Promise.resolve();
  private scanning:Promise<void>|undefined;
  constructor(readonly settingsRepository:VoiceLibrarySettingsRepository,readonly home:string,readonly profiles:ProfileStore,readonly scanner:VoiceModelScanner,readonly defaults:Partial<VoiceLibrarySettings>={},readonly launcher:ServiceLauncher=new ExternalServiceLauncher()){
    this.discovery=new ReadOnlyServiceDiscovery(profiles,new Map());
  }
  private settings():VoiceLibrarySettings{return voiceLibrarySettingsSchema.parse(this.settingsRepository.read()??{modelsRoot:this.defaults.modelsRoot??process.env.BOT_VOICE_MODELS_ROOT??'',gptSovitsUrl:this.defaults.gptSovitsUrl??'http://127.0.0.1:9880',breezeTtsUrl:this.defaults.breezeTtsUrl??process.env.BREEZE_TTS_URL??'http://127.0.0.1:8080',gptSovitsProjectRoot:this.defaults.gptSovitsProjectRoot??process.env.GPT_SOVITS_ROOT??'',breezeTtsProjectRoot:this.defaults.breezeTtsProjectRoot??process.env.BREEZE_TTS_ROOT??'',breezeTtsVoicesRoot:this.defaults.breezeTtsVoicesRoot??process.env.BREEZE_TTS_VOICES_ROOT??''});}
  view():VoiceLibraryView {const settings=this.settings();return{...settings,revision:revision(settings),reports:structuredClone(this.reports)};}
  private exclusive<T>(action:()=>Promise<T>):Promise<T>{const current=this.pending.then(action,action);this.pending=current.catch(()=>{});return current;}
  async save(input:unknown,signal:AbortSignal):Promise<VoiceLibraryView>{
    const {expectedRevision,...settings}=voiceLibrarySettingsInputSchema.parse(input);
    return this.exclusive(async()=>{
      signal.throwIfAborted();const current=this.settings();
      if(expectedRevision!==revision(current)&&(expectedRevision!==undefined||this.settingsRepository.read()!==undefined))throw new ConflictError('模型服务配置已变化，请刷新后重试',diagnostic('modelSettingsChanged'));
      this.settingsRepository.write(settings);
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
    const report=this.reports[serviceId],settings=this.settings(),configured=serviceId==='breeze-tts'?!!settings.breezeTtsUrl:!!settings.modelsRoot;
    return{serviceId,state:report.state,registeredRoots:configured?1:0,scannedRoots:report.checkedAt&&report.state!=='missing'?1:0,profileCount:report.profileCount,checkedAt:report.checkedAt,message:report.diagnosticDetails?.length===1?report.diagnosticDetails[0].message:undefined,safeDiagnostic:report.diagnostics.join(' ').slice(0,1000)||undefined};
  }
  async start(serviceId:LaunchableService,signal:AbortSignal):Promise<ServiceStartResult>{
    const settings=this.settings();
    const projectRoot=serviceId==='comfyui'?path.dirname(path.dirname(settings.comfyUiWorkflowPath)):serviceId==='breeze-tts'?settings.breezeTtsProjectRoot:settings.gptSovitsProjectRoot||path.dirname(settings.modelsRoot);
    if(!projectRoot)throw Error(serviceId==='breeze-tts'?'BREEZE_TTS_PROJECT_ROOT_REQUIRED':'GPT_SOVITS_PROJECT_ROOT_REQUIRED');
    return this.launcher.start({serviceId,baseUrl:serviceId==='breeze-tts'?settings.breezeTtsUrl:serviceId==='comfyui'?settings.comfyUiBaseUrl:settings.gptSovitsUrl,projectRoot},signal);
  }
  private unavailable(serviceIds:readonly VoiceService[],state:'missing'|'blocked',reason:DiagnosticDetail|DiagnosticDetail[]):void{
    for(const serviceId of serviceIds){this.discovery.failSource(serviceId,SOURCE_ID,state);this.reports[serviceId]={state,profileCount:0,checkedAt:Date.now(),...reportDiagnostics(Array.isArray(reason)?reason:[reason]),models:[]};}
  }
  private async resource(file:string,label:ResourceLabel,diagnostics:DiagnosticDetail[],identities:ResourceIdentity[],directory=false):Promise<boolean>{
    try{const info=await lstat(file);if(info.isSymbolicLink()||!(directory?info.isDirectory():info.isFile()))throw Error('invalid');if(!directory)identities.push({path:file,size:info.size,mtimeMs:info.mtimeMs});return true;}
    catch{diagnostics.push(diagnosticDetail('resourceUnreadable',{resource:label}));return false;}
  }
  private async modelFile(root:string,relative:string|undefined,label:ResourceLabel,diagnostics:DiagnosticDetail[]):Promise<string|undefined>{
    if(!relative){diagnostics.push(diagnosticDetail('resourceMissing',{resource:label}));return;}
    const resolved=path.resolve(root,relative),within=path.relative(root,resolved);
    if(within.startsWith('..')||path.isAbsolute(within)){diagnostics.push(diagnosticDetail('resourceOutsideLibrary',{resource:label}));return;}
    try{const info=await lstat(resolved),canonical=await realpath(resolved),canonicalRelative=path.relative(root,canonical);if(!info.isFile()||info.isSymbolicLink()||canonicalRelative.startsWith('..')||path.isAbsolute(canonicalRelative))throw Error('invalid');return resolved;}
    catch{diagnostics.push(diagnosticDetail('resourceUnreadable',{resource:label}));return;}
  }
  private async candidate(model:ScannerModel&{duplicate?:boolean},context:VoiceScannerContext,settings:VoiceLibrarySettings,device:'cpu'|'cuda'):Promise<{candidate:DiscoveryCandidate;report:VoiceModelReport}>{
    const diagnostics:DiagnosticDetail[]=model.diagnostics.map(text=>({text:safe(text)}));if(model.duplicate)diagnostics.push(diagnosticDetail('duplicateModelId'));const identities:ResourceIdentity[]=[],root=context.modelsRoot;
    let managedConfig:Record<string,unknown>={};
    if(model.serviceId==='rvc'){
      const rvcRoot=path.join(context.projectRoot,'RVC');
      await this.resource(rvcRoot,'rvcRoot',diagnostics,identities,true);
      await this.resource(path.join(rvcRoot,'assets','hubert_base','config.json'),'rvcHubertConfig',diagnostics,identities);
      await this.resource(path.join(rvcRoot,'assets','hubert_base','pytorch_model.bin'),'rvcHubertWeights',diagnostics,identities);
      await this.resource(path.join(rvcRoot,'assets','rmvpe','rmvpe.pt'),'rvcRmvpeWeights',diagnostics,identities);
      const weights=await this.modelFile(root,model.files.weights,'rvcWeights',diagnostics),index=model.files.index?await this.modelFile(root,model.files.index,'rvcIndex',diagnostics):undefined;
      if(!['v1','v2'].includes(model.modelVersion))diagnostics.push(diagnosticDetail('rvcVersionUnsupported'));
      managedConfig={protocol:'rvc_cli_v1',python:context.python,rvcRoot,device,modelVersion:model.modelVersion,singingModelId:model.id,...weights?{singingWeightsPath:weights}:{},...index?{singingIndexPath:index}:{},speakerId:0,pitchShift:0,indexRate:index?0.75:0};
      const separator=path.join(rvcRoot,'assets','pymss_weights','model_bs_roformer_ep_368_sdr_12.9628.ckpt');
      const separatorIdentity:ResourceIdentity[]=[];if(await this.resource(separator,'separator',[],separatorIdentity)){identities.push(...separatorIdentity);managedConfig.separation={enabled:true,status:'configured',modelId:'vocals',modelPath:separator,instrumentalMix:true,volume:1};}
    }else{
      const pretrained=path.join(context.projectRoot,'GPT-SoVITS','GPT_SoVITS','pretrained_models');
      await this.resource(path.join(pretrained,'chinese-hubert-base','config.json'),'sovitsHubertConfig',diagnostics,identities);
      await this.resource(path.join(pretrained,'chinese-hubert-base','pytorch_model.bin'),'sovitsHubertWeights',diagnostics,identities);
      await this.resource(path.join(pretrained,'chinese-roberta-wwm-ext-large','config.json'),'sovitsTextConfig',diagnostics,identities);
      await this.resource(path.join(pretrained,'chinese-roberta-wwm-ext-large','pytorch_model.bin'),'sovitsTextWeights',diagnostics,identities);
      if(model.modelVersion==='v4'){
        await this.resource(path.join(pretrained,'gsv-v4-pretrained','s2Gv4.pth'),'sovitsV4Base',diagnostics,identities);
        await this.resource(path.join(pretrained,'gsv-v4-pretrained','vocoder.pth'),'sovitsV4Vocoder',diagnostics,identities);
      }
      const gpt=await this.modelFile(root,model.files.gpt,'gptWeights',diagnostics),sovits=await this.modelFile(root,model.files.sovits,'sovitsWeights',diagnostics),reference=await this.modelFile(root,model.files.reference,'referenceAudio',diagnostics);
      const config={baseUrl:settings.gptSovitsUrl,modelVersion:model.modelVersion,gptWeightsPath:gpt,sovitsWeightsPath:sovits,refAudioPath:reference,promptText:model.reference?.text,promptLang:model.reference?.promptLang,textLang:model.reference?.textLang};
      if(!gptSovitsSchema.safeParse(config).success)diagnostics.push(diagnosticDetail('sovitsIncomplete'));
      managedConfig={protocol:'gpt_sovits',voice:model.id,healthPath:'/openapi.json',...Object.fromEntries(Object.entries(config).filter(([,value])=>value!==undefined))};
    }
    const state=model.state==='ready'&&!diagnostics.length?'ready':'blocked',displayName=safe(model.displayName),uniqueDiagnostics=[...new Map(diagnostics.map(item=>[item.text,item])).values()];
    return{candidate:{profileId:model.id,displayName,modelLabel:model.modelLabel?safe(model.modelLabel):model.modelVersion,capabilities:[model.serviceId==='rvc'?'rvc.convert':'gpt-sovits.speak'],state,managedConfig,resourceHash:canonicalJsonHash({model:model.resourceHash,dependencies:identities})},report:{profileId:model.id,displayName,state,...reportDiagnostics(uniqueDiagnostics)}};
  }
  private async refreshBreeze(settings:VoiceLibrarySettings,signal:AbortSignal):Promise<void>{
    const checkedAt=Date.now(),sourceId='breeze-tts-voices';
    const diagnostics:DiagnosticDetail[]=[],seen=new Set<string>(),candidates:DiscoveryCandidate[]=[];
    const add=(id:string,display:string,resourceHash:string)=>{if(!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)){if(id)diagnostics.push(diagnosticDetail('breezeVoiceIdInvalid',{id:id.slice(0,80)}));return;}if(seen.has(id))return;seen.add(id);candidates.push({profileId:id,displayName:display||id,modelLabel:'Breeze-TTS-2',capabilities:['breeze-tts.speak'],state:'ready',managedConfig:{protocol:'breeze_tts',baseUrl:settings.breezeTtsUrl,voice:id},resourceHash});};
    let apiAvailable=false;
    try{
      const response=await fetch(`${settings.breezeTtsUrl}/v1/voices`,{signal:AbortSignal.any([signal,AbortSignal.timeout(10_000)]),redirect:'error'});
      if(!response.ok)throw Error(`HTTP_${response.status}`);
      const raw=await response.json() as unknown;
      const rows=Array.isArray(raw)?raw:(raw&&typeof raw==='object'&&Array.isArray((raw as any).voices)?(raw as any).voices:[]);
      apiAvailable=true;
      for(const row of rows){
        const item=typeof row==='string'?{id:row}:row&&typeof row==='object'?row as Record<string,unknown>:{};
        const id=typeof item.id==='string'?item.id:typeof item.voice_id==='string'?item.voice_id:'';
        const display=typeof item.name==='string'&&item.name.trim()?item.name.trim():id;
        add(id,display||id,canonicalJsonHash({id,displayName:display||id}));
      }
    }catch{diagnostics.push(diagnosticDetail('breezeLocalFallback'));}
    const voicesRoot=settings.breezeTtsVoicesRoot||(settings.breezeTtsProjectRoot?path.join(settings.breezeTtsProjectRoot,'voices'):'');
    if(voicesRoot){
      try{
        const entries=await readdir(voicesRoot,{withFileTypes:true});
        for(const entry of entries){
          if(!entry.isFile()||!entry.name.toLowerCase().endsWith('.breeze'))continue;
          const id=entry.name.slice(0,-'.breeze'.length),file=path.join(voicesRoot,entry.name),info=await lstat(file);
          if(info.isSymbolicLink())continue;
          add(id,id,canonicalJsonHash({id,size:info.size,mtimeMs:info.mtimeMs}));
        }
      }catch{diagnostics.push(diagnosticDetail('breezeDirectoryUnreadable'));}
    }
    if(!apiAvailable&&candidates.length)diagnostics.push(diagnosticDetail('breezeLocalVoices'));
    this.discovery.reconcile('breeze-tts',sourceId,candidates);
    this.reports['breeze-tts']={state:candidates.length?(apiAvailable?'ready':'partial'):'blocked',profileCount:candidates.length,checkedAt,...reportDiagnostics(diagnostics),models:candidates.map(item=>({profileId:item.profileId,displayName:item.displayName,state:'ready',diagnostics:[]}))};
  }
  private async refreshNow(signal:AbortSignal):Promise<void>{
    const settings=this.settings();await this.refreshBreeze(settings,signal);if(!settings.modelsRoot){this.unavailable(['rvc','gpt-sovits'],'missing',diagnosticDetail('modelsRootMissing'));return;}
    const diagnostics:DiagnosticDetail[]=[],identities:ResourceIdentity[]=[],projectRoot=path.dirname(settings.modelsRoot),python=path.join(projectRoot,'.codex','venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),script=path.join(projectRoot,'scripts','model_catalog.py');
    const rootExists=await this.resource(settings.modelsRoot,'modelsRoot',diagnostics,identities,true);
    await this.resource(python,'python',diagnostics,identities);await this.resource(script,'scanner',diagnostics,identities);
    if(diagnostics.length){this.unavailable(['rvc','gpt-sovits'],rootExists?'blocked':'missing',diagnostics);return;}
    try{
      const root=await realpath(settings.modelsRoot),context:VoiceScannerContext={modelsRoot:root,projectRoot,python,script,cache:path.join(this.home,'voice-model-cache','catalog.json'),signal:AbortSignal.any([signal,AbortSignal.timeout(120_000)])};
      const result=scannerResultSchema.parse(await this.scanner.scan(context));context.signal.throwIfAborted();const device=await this.scanner.device?.(context)??'cpu';
      const grouped=new Map<string,ScannerModel[]>();
      for(const model of result.models){const key=`${model.serviceId}/${model.id}`,group=grouped.get(key)??[];group.push(model);grouped.set(key,group);}
      const models=[...grouped.values()].map(group=>group.length===1?group[0]:{...group[0],state:'blocked' as const,resourceHash:canonicalJsonHash(group.map(model=>model.resourceHash).sort()),duplicate:true});
      const candidates=await Promise.all(models.map(model=>this.candidate(model,context,settings,device)));
      context.signal.throwIfAborted();
      for(const serviceId of ['rvc','gpt-sovits'] as const){
        const selected=candidates.filter(item=>item.candidate.capabilities[0].startsWith(`${serviceId}.`));
        this.discovery.reconcile(serviceId,SOURCE_ID,selected.map(item=>item.candidate));
        const models=selected.map(item=>item.report),blocked=models.filter(item=>item.state==='blocked').length,globalDiagnostics=result.diagnostics.map(text=>({text:safe(text)}));
        this.reports[serviceId]={state:models.length?(blocked===models.length?'blocked':blocked?'partial':'ready'):'missing',profileCount:models.length,checkedAt:Date.now(),...reportDiagnostics(globalDiagnostics.length?globalDiagnostics:models.length?[]:[diagnosticDetail('noModels')]),models};
      }
    }catch{this.unavailable(['rvc','gpt-sovits'],'blocked',diagnosticDetail(signal.aborted?'modelScanCancelled':'modelScanFailed'));}
  }
}
