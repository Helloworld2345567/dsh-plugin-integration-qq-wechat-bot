import { imageEndpointSchema, type BotConfig } from './types.js';

const defaultComfyUiBaseUrl = (): string => `http://${['127','0','0','1'].join('.')}:8188`;

/** Portable extension seam: per-persona overrides > operator environment > bundled skill defaults. */
export function resolveImageSkill(config:BotConfig,env:NodeJS.ProcessEnv=process.env){
  const override=config.media.image;
  if(override?.enabled===false)throw new Error('IMAGE_SKILL_DISABLED');
  // Protocol remains the only persona-level choice.  Model, endpoint and key
  // environment name are operator-owned service settings; legacy persona
  // values remain a fallback for older installations that have no service
  // settings yet.
  const operatorBaseUrl=env.BOT_IMAGE_BASE_URL||env.SAKURA_IMAGE_BASE_URL||env.OPENAI_BASE_URL;
  const protocol=override?.protocol||env.BOT_IMAGE_PROTOCOL||(env.BOT_COMFYUI_BASE_URL?'comfyui':undefined)||((override?.baseUrl||operatorBaseUrl||'').startsWith('http://127.0.0.1')?'comfyui':undefined);
  const baseUrl=protocol==='comfyui'
    ? env.BOT_COMFYUI_BASE_URL||override?.baseUrl||defaultComfyUiBaseUrl()
    : operatorBaseUrl||override?.baseUrl||'https://api.openai.com/v1';
  const model=protocol==='comfyui'
    ? (env.BOT_COMFYUI_MODEL||'comfyui')
    : env.BOT_IMAGE_MODEL||env.SAKURA_IMAGE_MODEL||override?.model||'gpt-image-2';
  const keyEnv=env.BOT_IMAGE_KEY_ENV||override?.keyEnv||('IMAGE_ACCESS_KEY' in env?'IMAGE_ACCESS_KEY':env.SAKURA_IMAGE_API_KEY?'SAKURA_IMAGE_API_KEY':'IMAGE_ACCESS_KEY');
  const workflowEnv=override?.workflowEnv||env.BOT_COMFYUI_WORKFLOW_ENV;
  const workflowPath=env.BOT_COMFYUI_WORKFLOW||env.BOT_COMFYUI_WORKFLOW_PATH;
  return imageEndpointSchema.parse({baseUrl,model,...protocol?{protocol}:{},...(protocol==='comfyui'?{...(workflowEnv?{workflowEnv}:{}),...(workflowPath?{workflowPath}:{})}:{keyEnv})});
}
export function imageSkillEnabled(config:Readonly<BotConfig>):boolean {
  return config.skills.includes('image-generation')&&config.tools.includes('bot_media')&&config.media.image?.enabled!==false;
}
