import { endpointSchema, type BotConfig } from './types.js';

/** Portable extension seam: per-persona overrides > operator environment > bundled skill defaults. */
export function resolveImageSkill(config:BotConfig,env:NodeJS.ProcessEnv=process.env){
  const override=config.media.image;
  if(override?.enabled===false)throw new Error('IMAGE_SKILL_DISABLED');
  const keyEnv=override?.keyEnv||env.BOT_IMAGE_KEY_ENV||('IMAGE_ACCESS_KEY' in env?'IMAGE_ACCESS_KEY':env.SAKURA_IMAGE_API_KEY?'SAKURA_IMAGE_API_KEY':'IMAGE_ACCESS_KEY');
  return endpointSchema.parse({baseUrl:override?.baseUrl||env.BOT_IMAGE_BASE_URL||env.SAKURA_IMAGE_BASE_URL||env.OPENAI_BASE_URL||'https://api.openai.com/v1',model:override?.model||env.BOT_IMAGE_MODEL||env.SAKURA_IMAGE_MODEL||'gpt-image-1',keyEnv});
}
export function imageSkillEnabled(config:Readonly<BotConfig>):boolean {
  return config.skills.includes('image-generation')&&config.tools.includes('bot_media')&&config.media.image?.enabled!==false;
}
