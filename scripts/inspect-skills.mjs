#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readSkillFiles} from './skill-contract.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const selected=process.argv.find(value=>value.startsWith('--skill='))?.slice('--skill='.length)??(process.argv.includes('--skill')?process.argv[process.argv.indexOf('--skill')+1]:undefined);
const {catalog,items}=await readSkillFiles(root);
const result=items.filter(item=>!selected||item.skill===selected).map(item=>({
  skill:item.skill,
  description:item.metadata.description,
  entry:catalog.entries[item.skill]??null,
  dispatcher:catalog.dispatchers.includes(item.skill),
  context:{chars:item.source.length,words:(item.source.match(/\S+/g)??[]).length},
  tools:item.manifest?.tools?.map(declaration=>({name:declaration.tool.name,parameters:Object.fromEntries(Object.entries(declaration.tool.parameters??{}).map(([name,value])=>[name,{required:value.required===true,enum:value.enum}]))}))??[],
  operations:item.manifest?.operations?.map(operation=>({id:operation.id,internal:operation.internal===true,quotaUnits:operation.quotaUnits,inputKinds:operation.inputKinds,role:operation.role,deliver:operation.deliver===true}))??[],
}));
if(selected&&!result.length)throw new Error(`SKILL_NOT_FOUND:${selected}`);
console.log(JSON.stringify({status:'PASS',skills:result},null,2));
