import type {Context} from '@deepseek-ai/cordis';
import {credentialKey,credentialRef,isCredentialKeySegment} from '@deepseek-ai/dsh-credentials';
import type {} from '@deepseek-ai/dsh-settings';
import {endpointSchema,type BotConfig} from '../core/types.js';
import {analysisEnabled,type AnalysisProvider,type AnalysisRole} from '../core/analysis.js';

/** Read native provider settings and resolve credentials in memory, never into bot records or tool results. */
export class HarnessMediaProvider implements AnalysisProvider{
  constructor(readonly ctx:Context){}
  async resolve(config:BotConfig,role:AnalysisRole){
    if(!analysisEnabled(config,role))throw new Error(role==='tts'?'VOICE_OUTPUT_DISABLED':'MEDIA_ANALYSIS_DISABLED');
    const media=config.media as Record<string,any>;
    const options=role==='tts'?media.voice:media[role];
    const provider=options?.provider??config.model?.provider;
    const model=options?.model??config.model?.model;
    if(!provider||!model)throw new Error('请选择聊天模型或媒体分析模型');
    const directory=this.ctx.llm.listConfigurableProviders().find(p=>p.provider===provider);
    if(!directory)throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');
    const section=this.ctx.settings.describe({redactSecrets:true}).find(s=>s.ns===directory.settingsNs);
    let value:any=section?.value;for(const part of directory.settingsPath)value=value?.[part];
    if(!value||typeof value!=='object')throw new Error('MEDIA_PROVIDER_SETTINGS_UNAVAILABLE');
    if(!['openai-completions','openai-responses'].includes(value.api??(provider==='openai'?'openai-completions':'')))throw new Error('MEDIA_REQUIRES_OPENAI_COMPATIBLE_PROVIDER');
    const endpoint=endpointSchema.safeParse({baseUrl:value.baseURL??directory.defaultBaseURL,model,keyEnv:'BOT_ANALYSIS_API_KEY'});
    if(!endpoint.success)throw new Error('MEDIA_PROVIDER_ENDPOINT_INVALID');
    if(!(await this.ctx.llm.listModels(provider)).some(m=>m.id===model))throw new Error('UNKNOWN_MEDIA_MODEL');
    let apiKey:string|undefined;
    if(value.apiKeyEnv){apiKey=(await this.ctx.credentials.resolve(credentialRef(value.apiKeyEnv)))?.value;}
    else{
      const record=isCredentialKeySegment(provider)?await this.ctx.credentials.readRecord(credentialKey('llm-pi-ai',provider)):undefined;
      if(record?.kind==='api-key')apiKey=record.key;
      for(const name of directory.nativeAuth?.env??[]){if(apiKey)break;apiKey=record?.kind==='api-key'?record.env?.[name]:undefined;apiKey??=(await this.ctx.credentials.resolve(credentialRef(name)))?.value;}
    }
    if(!apiKey?.trim())throw new Error('MEDIA_PROVIDER_KEY_NOT_CONFIGURED');
    const headers:Record<string,string>={};for(const [key,entry] of Object.entries(value.headers??{})){if(['openai-organization','openai-project'].includes(key.toLowerCase())&&typeof entry==='string')headers[key]=entry;}
    const protocol=role==='tts'?'speech':role==='asr'?(options?.protocol??'chat_completions'):'chat_completions';
    return{provider,endpoint:{baseUrl:endpoint.data.baseUrl,model,keyEnv:'BOT_ANALYSIS_API_KEY',protocol,headers},apiKey};
  }
}
