import { imageEndpointSchema, type BotConfig } from './types.js';
import {imageServiceSettingsSchema,type ImageServiceSettings} from './image-service-config.js';

/** Resolve the selected protocol against operator-owned service settings. */
export function resolveImageSkill(config:BotConfig,settings:ImageServiceSettings=imageServiceSettingsSchema.parse({})){
  const override=config.media.image;
  if(override?.enabled===false)throw new Error('IMAGE_SKILL_DISABLED');
  const protocol=override?.protocol??settings.imageProtocol;
  return imageEndpointSchema.parse(protocol==='comfyui'
    ? {protocol,baseUrl:settings.comfyUiBaseUrl,model:'comfyui',workflowPath:settings.comfyUiWorkflowPath}
    : {protocol,baseUrl:settings.openAiBaseUrl,model:settings.openAiModel,keyEnv:settings.openAiKeyEnv});
}
export function imageSkillEnabled(config:Readonly<BotConfig>):boolean {
  return config.skills.includes('image-generation')&&config.tools.includes('bot_media')&&config.media.image?.enabled!==false;
}
