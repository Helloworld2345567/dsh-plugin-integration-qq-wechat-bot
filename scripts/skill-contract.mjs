import {createHash} from 'node:crypto';
import {readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

export const SKILL_NAME_RE=/^[a-z][a-z0-9-]*$/;
export const OPERATION_ID_RE=/^[a-z][a-z0-9_]{1,80}$/;
export const TOOL_NAME_RE=/^[a-z][a-z0-9_]+$/;
export const ANALYSIS_ROLES=new Set(['asr','video','tts']);

export async function readCatalog(root){
  const file=path.join(root,'skills','catalog.json');
  const catalog=JSON.parse(await readFile(file,'utf8'));
  if(!catalog||typeof catalog!=='object'||Array.isArray(catalog)||!catalog.entries||typeof catalog.entries!=='object'||Array.isArray(catalog.entries)||!Array.isArray(catalog.dispatchers))throw new Error('SKILL_CATALOG_INVALID');
  const entries={};
  for(const [name,entry] of Object.entries(catalog.entries)){if(!SKILL_NAME_RE.test(name)||typeof entry!=='string'||!entry.startsWith('dsh_bot_runtime.'))throw new Error('SKILL_CATALOG_INVALID');entries[name]=entry;}
  const dispatchers=[...new Set(catalog.dispatchers)];
  if(dispatchers.some(name=>!SKILL_NAME_RE.test(name)||Object.hasOwn(entries,name)))throw new Error('SKILL_CATALOG_INVALID');
  return Object.freeze({entries:Object.freeze(entries),dispatchers:Object.freeze(dispatchers)});
}

export async function isFile(file){try{return (await stat(file)).isFile();}catch{return false;}}

export function parseFrontmatter(source,file='<skill>'){
  const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source.replace(/^\uFEFF/,''));
  if(!match)throw new Error(`SKILL_FRONTMATTER_REQUIRED:${file}`);
  const metadata=YAML.parse(match[1],{maxAliasCount:0});
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||!SKILL_NAME_RE.test(String(metadata.name??''))||typeof metadata.description!=='string'||!metadata.description.trim())throw new Error(`SKILL_FRONTMATTER_INVALID:${file}`);
  const body=source.slice(match[0].length).trim();
  if(!body)throw new Error(`SKILL_BODY_REQUIRED:${file}`);
  return Object.freeze({name:String(metadata.name),description:metadata.description.trim(),body});
}

function parameterNames(declaration){return new Set(Object.keys(declaration?.tool?.parameters??{}));}
function enumValues(declaration){const result=new Map();for(const [name,parameter] of Object.entries(declaration?.tool?.parameters??{})){if(Array.isArray(parameter?.enum))result.set(name,new Set(parameter.enum));}return result;}

export function validateManifest(manifest,skill,catalog,{checkEntry=true}={}){
  const failures=[];
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))return ['SKILL_OPERATION_MANIFEST_INVALID'];
  if(manifest.skill!==skill||!SKILL_NAME_RE.test(skill)||catalog.entries[skill]!==manifest.entry)failures.push('entry');
  if(checkEntry&&(!Array.isArray(manifest.operations)||!manifest.operations.length||!Array.isArray(manifest.tools)||!manifest.tools.length))failures.push('shape');
  const operationIds=new Set(),toolNames=new Set(),routed=new Map();
  for(const operation of manifest.operations??[]){
    if(!operation||typeof operation!=='object'||!OPERATION_ID_RE.test(String(operation.id??''))||operationIds.has(operation.id)||!Number.isSafeInteger(operation.quotaUnits)||operation.quotaUnits<1||!Array.isArray(operation.inputKinds)||operation.inputKinds.some(value=>typeof value!=='string')||operation.role!==undefined&&!ANALYSIS_ROLES.has(operation.role)||operation.internal!==undefined&&typeof operation.internal!=='boolean'||operation.localTransform!==undefined&&typeof operation.localTransform!=='boolean')failures.push(`operation:${operation?.id??'<missing>'}`);
    else operationIds.add(operation.id);
  }
  for(const declaration of manifest.tools??[]){
    const name=declaration?.tool?.name;
    if(!TOOL_NAME_RE.test(String(name??''))||toolNames.has(name)||!declaration?.tool?.parameters||typeof declaration.tool.parameters!=='object'||declaration.defaults===null||typeof declaration.defaults!=='object'||!Array.isArray(declaration.routes)||!declaration.routes.length)failures.push(`tool:${name??'<missing>'}`);
    else toolNames.add(name);
    const names=parameterNames(declaration),enums=enumValues(declaration);
    for(const route of declaration?.routes??[]){
      if(!route||typeof route!=='object'||!route.match||typeof route.match!=='object'||!operationIds.has(route.operation))failures.push(`route:${route?.operation??'<missing>'}`);
      else {
        for(const [key,value] of Object.entries(route.match)){
          if(!names.has(key))failures.push(`route-parameter:${name}:${key}`);
          if(enums.has(key)&&!enums.get(key).has(value))failures.push(`route-value:${name}:${key}=${value}`);
        }
        if(routed.has(route.operation)&&routed.get(route.operation)!==name)failures.push(`route-owner:${route.operation}`);else routed.set(route.operation,name);
      }
    }
  }
  for(const operation of manifest.operations??[])if(!operation.internal&&!routed.has(operation.id))failures.push(`unrouted:${operation.id}`);
  return failures;
}

export async function readSkillFiles(root){
  const skillsRoot=path.join(root,'skills'),catalog=await readCatalog(root),items=[];
  for(const entry of (await readdir(skillsRoot,{withFileTypes:true})).filter(item=>item.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    const skill=entry.name,skillFile=path.join(skillsRoot,skill,'SKILL.md');
    if(!await isFile(skillFile))continue;
    const source=await readFile(skillFile,'utf8'),metadata=parseFrontmatter(source,`skills/${skill}/SKILL.md`),operationsFile=path.join(skillsRoot,skill,'operations.json');
    let manifest;
    if(await isFile(operationsFile))manifest=JSON.parse(await readFile(operationsFile,'utf8'));
    items.push({skill,source,metadata,manifest,operationsFile:await isFile(operationsFile)?operationsFile:undefined});
  }
  const names=new Set(items.map(item=>item.skill));
  for(const item of items){
    if(item.metadata.name!==item.skill)throw new Error(`SKILL_NAME_MISMATCH:skills/${item.skill}/SKILL.md`);
    if(!catalog.entries[item.skill]&&!catalog.dispatchers.includes(item.skill))throw new Error(`SKILL_NOT_IN_CATALOG:${item.skill}`);
    if(item.manifest){const errors=validateManifest(item.manifest,item.skill,catalog);if(errors.length)throw new Error(`SKILL_MANIFEST_INVALID:${item.skill}:${errors.join(',')}`);}
  }
  for(const name of [...Object.keys(catalog.entries),...catalog.dispatchers])if(!names.has(name))throw new Error(`SKILL_CATALOG_ENTRY_MISSING:${name}`);
  return Object.freeze({catalog,items:Object.freeze(items)});
}

export function normalizeText(text){return text.replace(/\r\n?/g,'\n');}
export function canonicalJson(value){
  if(Array.isArray(value))return value.map(canonicalJson);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right,'en')).map(([key,child])=>[key,canonicalJson(child)]));
  return value;
}
export async function manifestDigest(root){
  const {items}=await readSkillFiles(root),hash=createHash('sha256');
  for(const item of items.filter(item=>item.manifest).sort((a,b)=>a.skill.localeCompare(b.skill,'en'))){const relative=`skills/${item.skill}/operations.json`;hash.update(relative).update('\0').update(JSON.stringify(canonicalJson(item.manifest))).update('\0');}
  return hash.digest('hex');
}

export function fencedJsonExamples(source){
  const result=[];for(const match of source.matchAll(/```json\s*([\s\S]*?)```/gi)){try{result.push(JSON.parse(match[1]));}catch{result.push({__invalidJson:true});}}return result;
}

export function markdownReferences(source){
  return [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(match=>match[1].split('#',1)[0]).filter(value=>value&&!/^[a-z][a-z0-9+.-]*:/i.test(value));
}
