const WINDOWS_DRIVE_PATH=/(?:^|[\s'"`(])[A-Za-z]:[\\/](?![<>])[^\r\n'"`<>]*/gm;
const WINDOWS_UNC_PATH=/(?:^|[\s'"`(])\\\\(?:\?\\)?[A-Za-z0-9._$-]+[\\/][A-Za-z0-9._$ -]+(?:[\\/][^\r\n'"`<>]*)?/gm;
const LOOPBACK_ENDPOINT=/\b(?:https?|wss?):\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::\d+)?(?:[/?#][^\s'"`]*)?/gi;
const SECRET_ASSIGNMENT=/(?:^|[^A-Za-z0-9_])(?:api[_-]?key|access[_-]?key|secret|token|password|passwd|cookie|authorization)\s*[:=]\s*["']?([^\s'"`,;}]{1,2048})/gim;
const TOKEN=/(?:\bgh[opusr]_[A-Za-z0-9]{30,}\b|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{24,}\b)/g;
const SIGNED_LOCATOR=/\bhttps?:\/\/[^\s'"`<>]+(?:[?&](?:X-Amz-(?:Credential|Signature)|Signature|sig|token|access_token|Expires)=)[^\s'"`<>]+/gi;
const LOCATOR_FIELD=/(?:"|')?(?:privateDownloadUrl|downloadLocator|locator)(?:"|')?\s*[:=]\s*(?:"|')?(?:https?|s3|gs|file|git\+|github):[^\s'"`,}]+/gi;
const MODEL_ARTIFACT_PATH=/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n'"`]*(?:models?|weights?|checkpoints?)[^\r\n'"`]*\.(?:pth|ckpt|safetensors|index|pt)\b/gi;
const TEXT_FILE=/\.(?:ts|tsx|js|mjs|cjs|py|ps1|json|ya?ml|md|txt|toml|ini|properties)$/i;

export const RELEASE_SCAN_ALLOWLIST=Object.freeze({
  loopback:new Set([
    'scripts/start.mjs','scripts/stop.mjs','python/rvc_service.py','dist/index.js',
  ]),
  systemPath:new Map([['src/harness/open-directory.ts',new Set(['C:\\Windows'])],['dist/index.js',new Set(['C:\\\\Windows','C:\\Windows'])]]),
});

export function isReleaseTextFile(file){return TEXT_FILE.test(file)&&!file.endsWith('.map');}
export function validateReleaseEntry(file){
  const normalized=file.replaceAll('\\','/');if(normalized!==file||normalized.startsWith('/')||/^[A-Za-z]:/.test(normalized)||normalized.split('/').some(part=>part==='..'||part===''))return'Release entry is not a normalized relative path';
  if(/(?:^|\/)(?:\.codex|node_modules|\.git|data|artifacts|__pycache__)(?:\/|$)|(?:\.db|\.sqlite|\.log|\.pyc|\.env)(?:$|-)/i.test(normalized))return'Private/runtime file is included';
  if(/(?:^|\/)(?:id_rsa|id_ed25519|credentials?|secrets?)(?:\.|$)|\.(?:pem|key|p12|pfx)$/i.test(normalized))return'Credential-like file is included';
}
function withoutAllowedSystemPaths(file,text,allowlist){let value=text;for(const allowed of allowlist.systemPath.get(file)??[])value=value.replaceAll(allowed,'<SYSTEM_PATH>');return value;}
export function credentialAssignments(text){return[...text.matchAll(SECRET_ASSIGNMENT)].map(match=>match[1]);}
export function scanReleaseText(file,text,allowlist=RELEASE_SCAN_ALLOWLIST){
  if(file==='scripts/release-safety.mjs')return[];
  const findings=[];const value=withoutAllowedSystemPaths(file,text,allowlist);
  if(WINDOWS_DRIVE_PATH.test(value)||WINDOWS_UNC_PATH.test(value))findings.push('windows-absolute-path');WINDOWS_DRIVE_PATH.lastIndex=0;WINDOWS_UNC_PATH.lastIndex=0;
  if(!allowlist.loopback.has(file)&&LOOPBACK_ENDPOINT.test(value))findings.push('loopback-endpoint');LOOPBACK_ENDPOINT.lastIndex=0;
  const assigned=credentialAssignments(value).some(candidate=>candidate.length>=12&&!/^(?:<|\$\{|process\.env|os\.environ|fixture|example|redacted|undefined|null)/i.test(candidate)&&/^[A-Za-z0-9_+./=-]+$/.test(candidate)&&!/^(?:data|body|record|value|input|result|config|request|response)\.[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate)&&(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate)||/\d/.test(candidate))&&!/^(?:sha256|base64url|application|contractVersion|reasoningEffort)$/i.test(candidate));
  SECRET_ASSIGNMENT.lastIndex=0;if(assigned||TOKEN.test(value))findings.push('credential');TOKEN.lastIndex=0;
  if(SIGNED_LOCATOR.test(value)||LOCATOR_FIELD.test(value))findings.push('download-locator');SIGNED_LOCATOR.lastIndex=0;LOCATOR_FIELD.lastIndex=0;
  if(MODEL_ARTIFACT_PATH.test(value))findings.push('model-inventory-path');MODEL_ARTIFACT_PATH.lastIndex=0;
  return findings;
}
