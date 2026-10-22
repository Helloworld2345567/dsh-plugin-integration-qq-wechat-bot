import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {z} from 'zod';
import type {Store} from './store.js';
import {packageRoot} from './paths.js';
import type {BotConfig} from './types.js';

export const packagedSkills:Readonly<Record<string,string>>={
  'image-generation':'生成或参考图编辑，继承 skill 环境配置，成功自动回传',
  'media-analysis':'通过受管脚本识别音频、分析视频，复用原生模型提供商',
};
const nameSchema=z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const reserved=/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
export interface SkillFile {path:string;content:string}
export interface FrozenSkill {name:string;description:string;content:string;path:string;resourceBase:{kind:'directory';path:string};version:string}
type Tree=Map<string,Buffer>;
const fingerprint=(tree:Tree)=>{const hash=createHash('sha256');for(const [name,data] of [...tree].sort(([a],[b])=>a.localeCompare(b,'en'))){hash.update(name);hash.update('\0');hash.update(String(data.length));hash.update('\0');hash.update(data);}return hash.digest('hex');};
function segment(value:string):void {if(!value||value==='.'||value==='..'||reserved.test(value)||/[<>:"|?*\x00-\x1f]/.test(value)||/[. ]$/.test(value))throw new Error('SKILL_PATH_INVALID');}
function relative(value:string):string {if(value.includes('\\')||path.isAbsolute(value))throw new Error('SKILL_PATH_INVALID');value.split('/').forEach(segment);return value;}
function directory(value:string):void {if(existsSync(value)){const st=lstatSync(value);if(st.isSymbolicLink()||!st.isDirectory())throw new Error('SKILL_DIRECTORY_INVALID');}else mkdirSync(value,{recursive:true});}
function readTree(root:string):Tree {
  const tree:Tree=new Map();let total=0;const names=new Set<string>();
  const walk=(folder:string,prefix='')=>{const st=lstatSync(folder);if(st.isSymbolicLink()||!st.isDirectory())throw new Error('SKILL_LINK_REJECTED');for(const entry of readdirSync(folder).sort()){
    segment(entry);const name=prefix+entry;const file=path.join(folder,entry);const info=lstatSync(file);if(info.isSymbolicLink())throw new Error('SKILL_LINK_REJECTED');
    if(info.isDirectory()){if(name.split('/').length>8)throw new Error('SKILL_DEPTH_LIMIT');walk(file,name+'/');continue;}
    if(!info.isFile()||info.size>2*1024*1024)throw new Error('SKILL_FILE_LIMIT');
    if(names.has(name.toLowerCase()))throw new Error('SKILL_CASE_COLLISION');names.add(name.toLowerCase());
    const data=readFileSync(file);total+=data.length;if(total>10*1024*1024||tree.size>=200)throw new Error('SKILL_SIZE_LIMIT');tree.set(name,data);
  }};walk(root);return tree;
}
function definition(name:string,tree:Tree,root:string,version:string):FrozenSkill {
  const source=tree.get('SKILL.md')?.toString('utf8').replace(/^\uFEFF/,'');if(!source)throw new Error('SKILL_MD_REQUIRED');
  const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);if(!match)throw new Error('SKILL_FRONTMATTER_REQUIRED');
  const metadata=z.object({name:nameSchema,description:z.string().trim().min(1).max(2000)}).parse(YAML.parse(match[1],{maxAliasCount:0}));
  if(metadata.name!==name)throw new Error('SKILL_NAME_MISMATCH');
  const body=source.slice(match[0].length).trim();if(!body)throw new Error('SKILL_BODY_REQUIRED');
  return Object.freeze({name,description:metadata.description,content:source,path:path.join(root,'SKILL.md'),resourceBase:{kind:'directory' as const,path:root},version});
}

/** Drafts are editable; the configuration points to immutable, content-addressed releases. */
export class DynamicSkills {
  constructor(readonly store:Store,readonly bundledRoot=path.join(packageRoot(),'skills')){}
  private draftRoot(configId:string):string {const root=path.join(this.store.personas.directory(configId),'skills');directory(root);return root;}
  private draft(configId:string,name:string):string {nameSchema.parse(name);segment(name);const root=this.draftRoot(configId);const collision=readdirSync(root).find(n=>n.toLowerCase()===name.toLowerCase()&&n!==name);if(collision)throw new Error('SKILL_CASE_COLLISION');const result=path.join(root,name);if(existsSync(result))directory(result);return result;}
  private releaseRoot(configId:string,name:string,version:string):string {this.store.personas.directory(configId);nameSchema.parse(name);if(!/^[a-f0-9]{64}$/.test(version))throw new Error('SKILL_VERSION_INVALID');const base=path.join(this.store.home,'skill-versions');directory(base);const owner=path.join(base,configId);directory(owner);const skill=path.join(owner,name);directory(skill);return path.join(skill,version);}
  private stage(configId:string,name:string,tree:Tree):string {
    if(Object.hasOwn(packagedSkills,name))throw new Error('BUILTIN_SKILL_REQUIRES_CODE_UPDATE');
    const version=fingerprint(tree);const target=this.releaseRoot(configId,name,version);definition(name,tree,target,version);
    if(existsSync(target)){if(fingerprint(readTree(target))!==version)throw new Error('SKILL_RELEASE_CHANGED');return version;}
    const temporary=target+'.'+randomUUID()+'.tmp';directory(temporary);for(const [file,data] of tree){const output=path.join(temporary,relative(file));mkdirSync(path.dirname(output),{recursive:true});writeFileSync(output,data,{flag:'wx'});}renameSync(temporary,target);return version;
  }
  snapshot(config:BotConfig):Readonly<Record<string,FrozenSkill>> {
    const result:Record<string,FrozenSkill>={};
    for(const name of config.skills){nameSchema.parse(name);if(Object.hasOwn(packagedSkills,name)){
      const root=path.join(this.bundledRoot,name);const content=readFileSync(path.join(root,'SKILL.md'),'utf8');result[name]=Object.freeze({name,description:packagedSkills[name],content,path:path.join(root,'SKILL.md'),resourceBase:{kind:'directory' as const,path:root},version:createHash('sha256').update(content).digest('hex')});
    }else{const version=config.skillVersions?.[name];if(!version)throw new Error(`SKILL_NOT_PUBLISHED: ${name}`);const root=this.releaseRoot(config.id,name,version);const tree=readTree(root);if(fingerprint(tree)!==version)throw new Error('SKILL_RELEASE_CHANGED');result[name]=definition(name,tree,root,version);}}
    return Object.freeze(result);
  }
  list(config:BotConfig){return Object.values(this.snapshot(config)).map(({content,...skill})=>skill);}
  stageDrafts(config:BotConfig):BotConfig {
    const versions={...config.skillVersions};const names=[...config.skills];
    for(const name of readdirSync(this.draftRoot(config.id)).sort()){nameSchema.parse(name);const tree=readTree(this.draft(config.id,name));if(!versions[name]&&!names.includes(name))names.push(name);versions[name]=this.stage(config.id,name,tree);}
    const next={...config,skills:names,skillVersions:versions};this.snapshot(next);return next;
  }
  stageFiles(config:BotConfig,name:string,files:SkillFile[]):BotConfig {
    nameSchema.parse(name);if(Object.hasOwn(packagedSkills,name))throw new Error('BUILTIN_SKILL_REQUIRES_CODE_UPDATE');
    const folder=this.draft(config.id,name);const before=existsSync(folder)?readTree(folder):undefined;
    if(before&&fingerprint(before)!==config.skillVersions?.[name])throw new Error('SKILL_DRAFT_CONFLICT: 请先应用或保留现有文件草稿');
    const tree:Tree=new Map();const used=new Set<string>();let total=0;
    if(!files.length||files.length>200)throw new Error('SKILL_FILE_LIMIT');
    for(const file of files){const p=relative(file.path);if(used.has(p.toLowerCase()))throw new Error('SKILL_CASE_COLLISION');used.add(p.toLowerCase());const data=Buffer.from(file.content);total+=data.length;if(data.length>2*1024*1024||total>10*1024*1024)throw new Error('SKILL_SIZE_LIMIT');tree.set(p,data);}
    const version=this.stage(config.id,name,tree);
    // Replace the whole draft so removed scripts cannot remain accidentally executable.
    const temporary=folder+'.'+randomUUID()+'.tmp';directory(temporary);for(const [file,data] of tree){const target=path.join(temporary,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,data,{flag:'wx'});}
    if(existsSync(folder)){const archive=path.join(this.store.home,'skill-draft-archives');directory(archive);renameSync(folder,path.join(archive,randomUUID()));}renameSync(temporary,folder);
    return {...config,skills:[...new Set([...config.skills,name])],skillVersions:{...config.skillVersions,[name]:version}};
  }
  copy(config:BotConfig,newId:string):void {
    for(const [name,version] of Object.entries(config.skillVersions??{}))this.stage(newId,name,readTree(this.releaseRoot(config.id,name,version)));
  }
  draftFingerprint(configId:string):string {
    const trees:Tree=new Map();
    for(const name of readdirSync(this.draftRoot(configId))){nameSchema.parse(name);trees.set(name,Buffer.from(fingerprint(readTree(this.draft(configId,name)))));}
    return fingerprint(trees);
  }
  assertDrafts(config:BotConfig):void {
    for(const name of readdirSync(this.draftRoot(config.id))){nameSchema.parse(name);if(fingerprint(readTree(this.draft(config.id,name)))!==config.skillVersions[name])throw Error('SKILL_DRAFT_CHANGED: 技能文件在校验期间发生变化');}
  }
  /** Restore only untouched drafts; a manual edit is never silently overwritten. */
  restoreDrafts<T>(before:BotConfig,after:BotConfig,commit:()=>T):T {
    const changes:Array<{name:string;folder:string;archive?:string;staged?:string;installed?:boolean;tree?:Tree;version?:string}>=[];
    for(const name of new Set([...Object.keys(before.skillVersions),...Object.keys(after.skillVersions)])){
      if(before.skillVersions[name]===after.skillVersions[name])continue;
      const folder=this.draft(after.id,name);if(existsSync(folder)&&fingerprint(readTree(folder))!==after.skillVersions[name])throw Error('SKILL_DRAFT_CONFLICT: 回退前请保留或处理手工修改');
      const version=before.skillVersions[name];changes.push({name,folder,version,tree:version?readTree(this.releaseRoot(before.id,name,version)):undefined});
    }
    const archive=path.join(this.store.home,'skill-draft-archives');directory(archive);
    try{
      for(const change of changes){
        // Prepare a complete replacement before touching the editable draft. Failed
        // staging stays archived for diagnosis and does not need an undo operation.
        if(change.tree){change.staged=path.join(archive,randomUUID());directory(change.staged);for(const [file,data] of change.tree){const target=path.join(change.staged,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,data,{flag:'wx'});}}
        if(existsSync(change.folder)){const backup=path.join(archive,randomUUID());renameSync(change.folder,backup);change.archive=backup;}
        if(change.staged){renameSync(change.staged,change.folder);change.installed=true;change.staged=undefined;}
      }
      return commit();
    }catch(error){
      const conflicts:unknown[]=[];
      for(const change of changes.reverse()){
        if(!change.archive&&!change.installed)continue;
        try{
          if(existsSync(change.folder)){
            if(!change.installed||fingerprint(readTree(change.folder))!==change.version)throw Error('SKILL_ROLLBACK_CONFLICT: 已保留现场及归档');
            renameSync(change.folder,path.join(archive,randomUUID()));
          }
          if(change.archive)renameSync(change.archive,change.folder);
        }catch(conflict){conflicts.push(conflict);}
      }
      if(conflicts.length)throw new AggregateError([error,...conflicts],'SKILL_ROLLBACK_CONFLICT: 已保留现场及归档');
      throw error;
    }
  }
}
