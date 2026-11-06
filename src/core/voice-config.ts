/** Canonical queue/cache identity for an operator-configured inference service. */
export function normalizeVoiceServiceBaseUrl(value:string):string {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('GPT_SOVITS_ENDPOINT_INVALID');
  url.pathname=url.pathname.replace(/\/+$/,'');
  return url.toString().replace(/\/+$/,'');
}

/** Backwards-compatible name used by the GPT-SoVITS path. */
export const normalizeGptSovitsBaseUrl=normalizeVoiceServiceBaseUrl;

// Matches GPT-SoVITS inference/segmentation.py and synthesis.py's prompt cache key.
const promptEndings=new Set(['，','。','？','！',',','.','?','!','~',':','：','—','…']);
export function normalizeGptSovitsPromptText(text:string,language:string):string {
  const value=text.replace(/^\n+|\n+$/g,'');
  return !value||promptEndings.has(value.at(-1)!)?value:value+(language==='en'?'.':'。');
}
