#!/usr/bin/env node
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fencedJsonExamples,isFile,markdownReferences,manifestDigest,parseFrontmatter,readSkillFiles} from './skill-contract.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MAX_CHARS=6000;
const MAX_WORDS=800;
const failures=[];
const inventory=[];
const failure=(file,rule,detail)=>failures.push({file,rule,detail});
async function skillDocs(folder='skills',prefix=''){
  const result=[];
  for(const entry of await readdir(path.join(root,folder),{withFileTypes:true})){
    const relative=prefix?`${prefix}/${entry.name}`:entry.name,full=path.join(root,folder,entry.name);
    if(entry.isDirectory())result.push(...await skillDocs(`${folder}/${entry.name}`,relative));
    else if(entry.isFile()&&entry.name==='SKILL.md')result.push({relative,full});
  }
  return result;
}
try{
  const {catalog,items}=await readSkillFiles(root),globalOperations=new Map(),globalTools=new Map();
  const rootSkills=new Set(items.map(item=>item.skill));
  for(const document of await skillDocs()){
    const source=await readFile(document.full,'utf8'),metadata=parseFrontmatter(source,`skills/${document.relative}`),words=(source.match(/\S+/g)??[]).length;
    if(document.relative.split('/').length>2&&!rootSkills.has(metadata.name)){
      if(source.length>MAX_CHARS)failure(`skills/${document.relative}`,'skill-context-budget',`SKILL.md is ${source.length} chars; limit is ${MAX_CHARS}`);
      if(words>MAX_WORDS)failure(`skills/${document.relative}`,'skill-context-budget',`SKILL.md is ${words} words; limit is ${MAX_WORDS}`);
    }
  }
  for(const item of items){
    const relative=`skills/${item.skill}/SKILL.md`,words=(item.source.match(/\S+/g)??[]).length;
    inventory.push({skill:item.skill,description:item.metadata.description,chars:item.source.length,words,tools:item.manifest?.tools?.map(item=>item.tool.name)??[],operations:item.manifest?.operations?.map(item=>item.id)??[]});
    if(item.source.length>MAX_CHARS)failure(relative,'skill-context-budget',`SKILL.md is ${item.source.length} chars; limit is ${MAX_CHARS}`);
    if(words>MAX_WORDS)failure(relative,'skill-context-budget',`SKILL.md is ${words} words; limit is ${MAX_WORDS}`);
    for(const reference of markdownReferences(item.source))if(!(await isFile(path.resolve(path.dirname(path.join(root,relative)),reference))))failure(relative,'skill-reference-missing',reference);
    if(item.manifest){
      if(!catalog.entries[item.skill])failure(`skills/${item.skill}/operations.json`,'skill-catalog-entry-missing',item.skill);
      const pythonModule=path.join(root,'python',...item.manifest.entry.split('.'));
      if(!(await isFile(`${pythonModule}.py`)||await isFile(path.join(pythonModule,'__init__.py'))))failure(`skills/${item.skill}/operations.json`,'skill-entry-missing',item.manifest.entry);
      for(const operation of item.manifest.operations){
        const previous=globalOperations.get(operation.id);if(previous)failure(`skills/${item.skill}/operations.json`,'operation-duplicate',`${operation.id} also belongs to ${previous}`);else globalOperations.set(operation.id,item.skill);
      }
      for(const declaration of item.manifest.tools){
        const name=declaration.tool.name,previous=globalTools.get(name);if(previous)failure(`skills/${item.skill}/operations.json`,'tool-duplicate',`${name} also belongs to ${previous}`);else globalTools.set(name,item.skill);
      }
      const allowed=new Set(Object.keys(Object.assign({},...item.manifest.tools.map(tool=>tool.tool.parameters??{}))));
      for(const example of fencedJsonExamples(item.source)){
        if(example?.__invalidJson){failure(relative,'skill-example-invalid-json','fenced json block is not valid JSON');continue;}
        if(!example||typeof example!=='object'||Array.isArray(example))continue;
        for(const key of Object.keys(example))if(!allowed.has(key))failure(relative,'skill-example-unknown-parameter',key);
      }
    }
  }
  const digest=await manifestDigest(root),generated=await readFile(path.join(root,'src/core/published-skill-operations.ts'),'utf8');
  const recorded=/PUBLISHED_SKILL_MANIFEST_DIGEST="([a-f0-9]{64})"/.exec(generated)?.[1];
  if(recorded!==digest)failure('src/core/published-skill-operations.ts','generated-registry-stale',`expected ${digest}`);
  for(const name of [...Object.keys(catalog.entries),...catalog.dispatchers])if(!inventory.some(item=>item.skill===name))failure('skills/catalog.json','catalog-skill-missing',name);
}catch(error){failure('<repository>','skill-contract',error instanceof Error?error.message:String(error));}
const result={status:failures.length?'FAIL':'PASS',skills:inventory,failures};
console.log(JSON.stringify(result,null,2));
if(failures.length)process.exitCode=1;
