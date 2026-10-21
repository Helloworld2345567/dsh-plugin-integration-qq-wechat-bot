import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const result=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['pack','--dry-run','--json','--ignore-scripts'],{encoding:'utf8',shell:process.platform==='win32'});
if(result.status)throw new Error(result.stderr);
const files=JSON.parse(result.stdout)[0].files.map(f=>f.path);
const forbidden=files.filter(p=>/(?:^|\/)(?:\.codex|node_modules|\.git|data|artifacts|__pycache__)(?:\/|$)|(?:\.db|\.sqlite|\.log|\.pyc|\.env)(?:$|-)/i.test(p));
if(forbidden.length)throw new Error(`Private/runtime files in package: ${forbidden.join(', ')}`);
for(const file of files){if(/\.(?:ts|js|mjs|py|json|ya?ml|md)$/.test(file)&&!file.endsWith('.map')){const text=await readFile(file,'utf8');if(/[CD]:[\\/](?:Users|yangming)[\\/]/i.test(text)||/sk-[A-Za-z0-9_-]{24,}/.test(text))throw new Error(`Personal path or credential in ${file}`);}}
for(const expected of ['dist/index.js','dist/client.js','python/worker.py','skills/image-generation/scripts/image_api.py','skills/media-analysis/SKILL.md','skills/media-analysis/scripts/media_api.py'])if(!files.includes(expected))throw new Error(`Missing ${expected}`);
console.log(JSON.stringify({status:'PASS',files:files.length}));
