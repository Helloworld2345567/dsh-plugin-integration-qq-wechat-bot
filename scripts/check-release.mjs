import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {isReleaseTextFile,scanReleaseText,validateReleaseEntry} from './release-safety.mjs';

const npmCli=process.env.npm_execpath;
const windowsCommandFallback=process.platform==='win32'&&!npmCli;
const executable=windowsCommandFallback?(process.env.ComSpec??'cmd.exe'):process.platform==='win32'?process.execPath:'npm';
const args=windowsCommandFallback?['/d','/s','/c','npm pack --dry-run --json --ignore-scripts']:[...(process.platform==='win32'&&npmCli?[npmCli]:[]),'pack','--dry-run','--json','--ignore-scripts'];
const result=spawnSync(executable,args,{encoding:'utf8'});
if(result.error)throw result.error;
if(result.status!==0)throw new Error(result.stderr||`npm pack exited ${result.status}`);
let packed;try{packed=JSON.parse(result.stdout);}catch{throw new Error('npm pack did not return valid JSON');}
if(!Array.isArray(packed)||packed.length!==1||!Array.isArray(packed[0]?.files))throw new Error('npm pack returned an unexpected manifest');
const files=packed[0].files.map(file=>file?.path);
if(files.some(file=>typeof file!=='string'))throw new Error('npm pack returned an invalid file entry');
const invalid=files.flatMap(file=>{const reason=validateReleaseEntry(file);return reason?[`${file}: ${reason}`]:[];});
if(invalid.length)throw new Error(`Unsafe package entries: ${invalid.join(', ')}`);
for(const file of files)if(isReleaseTextFile(file)){const text=await readFile(file,'utf8');const findings=scanReleaseText(file,text);if(findings.length)throw new Error(`Sensitive release content in ${file}: ${findings.join(', ')}`);}
for(const expected of ['dist/index.js','dist/client.js','python/worker.py','skills/image-generation/scripts/image_api.py','skills/media-analysis/SKILL.md','skills/media-analysis/operations.json','skills/media-analysis/scripts/media_api.py','skills/voice-generation/SKILL.md','skills/voice-generation/operations.json','skills/voice-generation/scripts/voice_api.py','scripts/archive-validation.mjs','scripts/archive-validation.d.mts','scripts/github-bootstrap.mjs','scripts/github-bootstrap.d.mts','scripts/bootstrap-github.mjs','scripts/install.mjs','scripts/installation.mjs','scripts/installation.d.mts','scripts/runtime.mjs','requirements-voice-generation.txt'])if(!files.includes(expected))throw new Error(`Missing ${expected}`);
for(const script of ['image_transform.py','video_transform.py','transform_common.py'])if(!files.includes(`skills/media-analysis/scripts/${script}`))throw new Error(`Missing media transform script: ${script}`);
for(const expected of ['python/rvc_service.py','python/rvc_runner.py','python/separation_runner.py','python/singing_common.py','python/singing_worker.py','skills/singing-conversion/SKILL.md','skills/singing-conversion/operations.json','skills/singing-conversion/scripts/entry.py'])if(!files.includes(expected))throw new Error(`Missing STS runtime file: ${expected}`);
for(const expected of ['docs/singing-conversion-plan.md'])if(!files.includes(expected))throw new Error(`Missing STS documentation: ${expected}`);
for(const expected of ['python/audio_output.py','skills/music-download/SKILL.md','skills/music-download/operations.json','skills/music-download/scripts/entry.py','docs/music-integration.md'])if(!files.includes(expected))throw new Error(`Missing music runtime file: ${expected}`);
for(const expected of ['docs/install-existing-harness.md','docs/deploy-product-profile.md','docs/adr/0001-delivery-modes.md','docs/adr/0002-trusted-adapters-and-profiles.md','docs/adr/0003-lifecycle-and-uncertain-outcomes.md'])if(!files.includes(expected))throw new Error(`Missing delivery or architecture decision document: ${expected}`);
if(files.includes('docs/capability-service-plugin-plan.md'))throw new Error('Removed implementation plan returned to the package');
if(files.some(file=>file.startsWith('packages/bot-unified-chat/')))throw new Error('Removed bot-unified-chat bundle returned to the package');
console.log(JSON.stringify({status:'PASS',files:files.length}));
