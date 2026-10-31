import type {BotConfig} from './types.js';

/** Canonical queue/cache identity for an operator-configured inference service. */
export function normalizeGptSovitsBaseUrl(value:string):string {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('GPT_SOVITS_ENDPOINT_INVALID');
  url.pathname=url.pathname.replace(/\/+$/,'');
  return url.toString().replace(/\/+$/,'');
}

// Matches GPT-SoVITS inference/segmentation.py and synthesis.py's prompt cache key.
const promptEndings=new Set(['，','。','？','！',',','.','?','!','~',':','：','—','…']);
export function normalizeGptSovitsPromptText(text:string,language:string):string {
  const value=text.replace(/^\n+|\n+$/g,'');
  return !value||promptEndings.has(value.at(-1)!)?value:value+(language==='en'?'.':'。');
}

export function assertGptSovitsReferenceCompatibility(candidate:BotConfig,configs:ReadonlyArray<BotConfig>):void {
  const voice=candidate.media.voice;
  if(candidate.archived||voice?.protocol!=='gpt_sovits'||!voice.gptSovits)return;
  const selected=voice.gptSovits;
  const service=normalizeGptSovitsBaseUrl(selected.baseUrl);
  const text=normalizeGptSovitsPromptText(selected.promptText,selected.promptLang);
  for(const config of configs){
    const other=config.media.voice;
    if(config.id===candidate.id||config.archived||other?.protocol!=='gpt_sovits'||!other.gptSovits)continue;
    const reference=other.gptSovits;
    if(normalizeGptSovitsBaseUrl(reference.baseUrl)!==service||normalizeGptSovitsPromptText(reference.promptText,reference.promptLang)!==text)continue;
    if(reference.promptLang!==selected.promptLang||(reference.modelVersion==='v1')!==(selected.modelVersion==='v1')){
      throw new Error(`GPT_SOVITS_REFERENCE_CONFLICT: 与人格 ${config.name} (${config.id}) 的参考文本缓存冲突；同一文本须使用相同参考语言及文本前端家族，请选择实际转写不同的参考音频。`);
    }
  }
}
