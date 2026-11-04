import {spawnSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {isReleaseTextFile,scanReleaseText,validateReleaseEntry} from './release-safety.mjs';

const packageJson=JSON.parse(await readFile('package.json','utf8'));
if(!packageJson.files?.includes('.env.example'))throw new Error('package.json files must explicitly include .env.example');

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
async function declaredMarkdown(directory='docs'){
  const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){
    const relative=`${directory}/${entry.name}`.replaceAll('\\','/');
    if(entry.isDirectory())result.push(...await declaredMarkdown(relative));
    else if(entry.isFile()&&entry.name.endsWith('.md'))result.push(relative);
  }return result;
}
for(const document of await declaredMarkdown())if(!files.includes(document))throw new Error(`Declared documentation missing from npm pack: ${document}`);
for(const file of files)if(isReleaseTextFile(file)){const text=await readFile(file,'utf8');const findings=scanReleaseText(file,text);if(findings.length)throw new Error(`Sensitive release content in ${file}: ${findings.join(', ')}`);}
if(files.includes('.env.example')){
  const example=await readFile('.env.example','utf8');
  for(const line of example.split(/\r?\n/)){
    if(!line.trim()||line.trimStart().startsWith('#'))continue;
    const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);if(!match)throw new Error('.env.example contains an invalid assignment');
    const [,name,value]=match;
    const safe=value===''||/^<[^>]+>$/.test(value)||name==='BOT_IMAGE_KEY_ENV'&&/^[A-Z_][A-Z0-9_]*$/.test(value)||name==='BOT_INSTALL_LAYERS'&&/^(?:core|basic-media|voice-generation|music|singing-rvc)(?:,(?:core|basic-media|voice-generation|music|singing-rvc))*$/.test(value);
    if(!safe)throw new Error(`.env.example contains a non-placeholder value for ${name}`);
  }
  if(/(?:gh[opusr]_|AKIA|Bearer\s+|BEGIN .*PRIVATE KEY|[?&](?:token|ticket|sig|signature)=)/i.test(example))throw new Error('.env.example contains credential material');
}
for(const expected of ['.env.example','README.md','docs/getting-started.md','docs/development.md','docs/testing.md','docs/configuration.md','docs/troubleshooting.md','dist/index.js','dist/client.js','python/worker.py','skills/image-generation/scripts/image_api.py','skills/media-analysis/SKILL.md','skills/media-analysis/operations.json','skills/media-analysis/scripts/media_api.py','skills/voice-generation/SKILL.md','skills/voice-generation/operations.json','skills/voice-generation/scripts/voice_api.py','scripts/archive-validation.mjs','scripts/archive-validation.d.mts','scripts/release-pack.mjs','scripts/audit-dependencies.mjs','scripts/check-docs.mjs','scripts/check-licenses.mjs','scripts/check-python-dependencies.mjs','scripts/check-environment.mjs','scripts/check-contracts.mjs','scripts/test-environment.mjs','scripts/test-process.mjs','scripts/test-python.mjs','scripts/github-bootstrap.mjs','scripts/github-bootstrap.d.mts','scripts/bootstrap-github.mjs','scripts/install.mjs','scripts/installation.mjs','scripts/installation.d.mts','scripts/runtime.mjs','requirements.txt','requirements-voice-generation.txt','requirements-ci.txt','requirements-voice-generation-ci.txt','CONTRIBUTING.md','SECURITY.md','CODE_OF_CONDUCT.md','CHANGELOG.md','SUPPORT.md'])if(!files.includes(expected))throw new Error(`Missing ${expected}`);
for(const script of ['image_transform.py','video_transform.py','transform_common.py'])if(!files.includes(`skills/media-analysis/scripts/${script}`))throw new Error(`Missing media transform script: ${script}`);
for(const expected of ['python/rvc_service.py','python/rvc_runner.py','python/separation_runner.py','python/singing_common.py','python/singing_worker.py','skills/singing-conversion/SKILL.md','skills/singing-conversion/operations.json','skills/singing-conversion/scripts/entry.py'])if(!files.includes(expected))throw new Error(`Missing STS runtime file: ${expected}`);
for(const expected of ['docs/singing-conversion-plan.md'])if(!files.includes(expected))throw new Error(`Missing STS documentation: ${expected}`);
for(const expected of ['python/audio_output.py','skills/music-download/SKILL.md','skills/music-download/operations.json','skills/music-download/scripts/entry.py','docs/music-integration.md'])if(!files.includes(expected))throw new Error(`Missing music runtime file: ${expected}`);
for(const expected of ['docs/install-existing-harness.md','docs/deploy-product-profile.md','docs/adr/0001-delivery-modes.md','docs/adr/0002-trusted-adapters-and-profiles.md','docs/adr/0003-lifecycle-and-uncertain-outcomes.md'])if(!files.includes(expected))throw new Error(`Missing delivery or architecture decision document: ${expected}`);
for(const expected of ['locale/zh.json','icon.svg','packages/bot-lifecycle/locale/zh.json','packages/bot-lifecycle/icon.svg'])if(!files.includes(expected))throw new Error(`Missing plugin display resource: ${expected}`);
if(files.includes('docs/capability-service-plugin-plan.md'))throw new Error('Removed implementation plan returned to the package');
if(files.includes('fix_plan.md')||files.some(file=>/(?:^|\/)(?:node_modules|\.codex|\.runtime|outputs|coverage|data|artifacts)(?:\/|$)/i.test(file)))throw new Error('Runtime, temporary or ignored file returned to the package');
if(files.some(file=>/(?:\.db|\.sqlite|\.log|\.tgz|\.pyc|\.env(?:\.|$))/i.test(file)&&file!=='.env.example'))throw new Error('Database, log, credential or temporary archive returned to the package');
if(files.some(file=>file.startsWith('packages/bot-unified-chat/')))throw new Error('Removed bot-unified-chat bundle returned to the package');
console.log(JSON.stringify({status:'PASS',files:files.length}));
