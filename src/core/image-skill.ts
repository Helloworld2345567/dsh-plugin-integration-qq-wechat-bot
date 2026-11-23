import { imageEndpointSchema, type BotConfig } from './types.js';
import {imageServiceSettingsSchema,type ImageServiceSettings} from './image-service-config.js';

export function imagePromptWithStyle(prompt:string,style:string):string {return `${prompt}\n${style}`;}

/** Resolve the selected protocol against operator-owned service settings. */
export function resolveImageSkill(config:BotConfig,settings:ImageServiceSettings=imageServiceSettingsSchema.parse({})){
  if(config.media.image?.enabled===false)throw new Error('IMAGE_SKILL_DISABLED');
  const {protocol,model}=selectedImageService(config,settings);
  if(protocol==='comfyui'&&!settings.comfyUiWorkflowPath)throw new Error('COMFYUI_WORKFLOW_REQUIRED');
  return imageEndpointSchema.parse(protocol==='comfyui'
    ? {protocol,baseUrl:settings.comfyUiBaseUrl,model,workflowPath:settings.comfyUiWorkflowPath}
    : protocol==='google'
      ? {protocol,baseUrl:settings.googleBaseUrl,model,keyEnv:settings.googleKeyEnv}
      : {protocol,baseUrl:settings.openAiBaseUrl,model,keyEnv:settings.openAiKeyEnv});
}
export function imageSkillEnabled(config:Readonly<BotConfig>):boolean {
  return config.skills.includes('image-generation')&&config.tools.includes('bot_media')&&config.media.image?.enabled!==false;
}
/** Public selection shared by the service contract and the worker endpoint. */
export function selectedImageService(config:Readonly<BotConfig>,settings:Readonly<ImageServiceSettings>){
  const protocol=config.media.image?.protocol??settings.imageProtocol;
  const model=protocol==='comfyui'?'comfyui':protocol==='google'?settings.googleModel:settings.openAiModel;
  return {protocol,model};
}
