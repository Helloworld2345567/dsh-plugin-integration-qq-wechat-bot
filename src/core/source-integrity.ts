import {createHash} from 'node:crypto';
import {readdirSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {sha256} from './evolution-contract.js';
const roots=new Set(['src','python','skills','tests','scripts','docs','examples','packages']);
const files=new Set(['package.json','package-lock.json','tsconfig.json','requirements.txt','cordis.patch.yml','README.md','AGENTS.md','LICENSE','THIRD_PARTY_NOTICES.md','.gitignore','.gitattributes']);
const excluded=(name:string)=>/^(?:node_modules|dist|\.codex|\.git|\.runtime|\.venv|__pycache__|coverage|data|artifacts)$/i.test(name)||/^\.env(?:\.|$)/.test(name)||/\.(?:sqlite|db|log|tgz|pyc)(?:-|$)/i.test(name);
export function sourceFiles(root:string):Record<string,string>{
  const result:Record<string,string>={};
  const walk=(relative:string)=>{
    for(const name of readdirSync(path.join(root,relative)).sort()){
      if(excluded(name))continue;const rel=relative?`${relative}/${name}`:name;if(!relative&&!roots.has(name)&&!files.has(name))continue;
      const file=path.join(root,rel);const stat=lstatSync(file);if(stat.isSymbolicLink())throw Error(`Source symlink is not allowed: ${rel}`);
      if(stat.isDirectory())walk(rel);else if(stat.isFile())result[rel]=sha256(file);
    }
  };walk('');return result;
}
export function sourceDigest(files:Record<string,string>):string{return createHash('sha256').update(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');}
