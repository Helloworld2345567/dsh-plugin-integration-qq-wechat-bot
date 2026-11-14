import {spawnSync} from 'node:child_process';
import {readFile,readdir} from 'node:fs/promises';
import {isReleaseTextFile,scanReleaseText,validateReleaseEntry} from './release-safety.mjs';
import {verifyLifecycleBuild} from '../packages/bot-lifecycle/scripts/verify-build.mjs';

const packageJson=JSON.parse(await readFile('package.json','utf8'));
if(!packageJson.files?.includes('.env.example'))throw new Error('package.json files must explicitly include .env.example');
await verifyLifecycleBuild('packages/bot-lifecycle');

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
for(const stem of ['README','CONTRIBUTING','SECURITY','CODE_OF_CONDUCT','CHANGELOG','SUPPORT','THIRD_PARTY_NOTICES'])for(const suffix of ['.md','.en.md'])if(!files.includes(`${stem}${suffix}`))throw new Error(`Missing bilingual project document: ${stem}${suffix}`);
for(const document of ['packages/bot-lifecycle/README.md','packages/bot-lifecycle/README.en.md'])if(!files.includes(document))throw new Error(`Missing lifecycle documentation: ${document}`);
for(const file of files)if(isReleaseTextFile(file)){const text=await readFile(file,'utf8');const findings=scanReleaseText(file,text);if(findings.length)throw new Error(`Sensitive release content in ${file}: ${findings.join(', ')}`);}
if(files.includes('.env.example')){
  const example=await readFile('.env.example','utf8');
  for(const line of example.split(/\r?\n/)){
    if(!line.trim()||line.trimStart().startsWith('#'))continue;
    const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);if(!match)throw new Error('.env.example contains an invalid assignment');
    const [,name,value]=match;
    const safe=value===''||/^<[^>]+>$/.test(value)||name==='BOT_INSTALL_LAYERS'&&/^(?:core|basic-media|voice-generation|music|singing-rvc)(?:,(?:core|basic-media|voice-generation|music|singing-rvc))*$/.test(value);
    if(!safe)throw new Error(`.env.example contains a non-placeholder value for ${name}`);
  }
  if(/(?:gh[opusr]_|AKIA|Bearer\s+|BEGIN .*PRIVATE KEY|[?&](?:token|ticket|sig|signature)=)/i.test(example))throw new Error('.env.example contains credential material');
}
if(files.includes('docs/capability-service-plugin-plan.md'))throw new Error('Removed implementation plan returned to the package');
if(files.includes('fix_plan.md')||files.some(file=>/(?:^|\/)(?:node_modules|\.codex|\.runtime|outputs|coverage|data|artifacts|tests?|fixtures?)(?:\/|$)/i.test(file)))throw new Error('Runtime, test, temporary or ignored file returned to the package');
if(files.some(file=>/(?:\.db|\.sqlite|\.log|\.tgz|\.pyc|\.env(?:\.|$))/i.test(file)&&file!=='.env.example'))throw new Error('Database, log, credential or temporary archive returned to the package');
if(files.some(file=>file.startsWith('packages/bot-unified-chat/')))throw new Error('Removed bot-unified-chat bundle returned to the package');
const pythonShims=new Set(['python/worker.py','python/rvc_service.py','python/rvc_runner.py','python/rvc_output.py','python/extract_worker.py','python/image_api.py']);
if(files.some(file=>file.startsWith('skills/')&&file.endsWith('.py')||file.startsWith('python/vendor/')||/^python\/[^/]+\.py$/.test(file)&&!pythonShims.has(file)))throw new Error('Legacy or duplicate Python runtime layout returned to the package');
console.log(JSON.stringify({status:'PASS',files:files.length}));
