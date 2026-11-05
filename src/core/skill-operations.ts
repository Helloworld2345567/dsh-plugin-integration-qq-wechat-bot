import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {packageRoot} from './paths.js';
import type {AnalysisRole} from './analysis.js';
import {PUBLISHED_SKILL_OPERATIONS} from './published-skill-operations.js';

export interface SkillOperation {
  id: string;
  quotaUnits: number;
  inputKinds: string[];
  role?: AnalysisRole;
  deliver?: boolean;
  recentInput?: string;
  requiredInputError?: string;
  urlRequiredError?: string;
  exclusiveSourceError?: string;
  urlHosts?: string[];
  urlHostError?: string;
  localTransform?: boolean;
}
export interface SkillToolDeclaration {
  enabledRoles?: AnalysisRole[];
  /** Permission checked by the runtime before dispatching this skill. */
  permissionTool?: string;
  tool: {name: string; description: string; parameters: Record<string, any>};
  routes: {match: Record<string, string>; operation: string}[];
  defaults: Record<string, string>;
}
export interface SkillOperationManifest {
  skill: string;
  entry: string;
  tools: SkillToolDeclaration[];
  operations: SkillOperation[];
}
export type SkillToolManifest = SkillToolDeclaration & Pick<SkillOperationManifest, 'skill' | 'entry' | 'operations'>;

const PUBLISHED_SKILL_ENTRIES:Readonly<Record<string,string>>=Object.freeze({
  'media-analysis':'dsh_bot_runtime.skills.media_analysis.media_api',
  'music-download':'dsh_bot_runtime.skills.music_download.entry',
  'singing-conversion':'dsh_bot_runtime.skills.singing_conversion.entry',
  'voice-generation':'dsh_bot_runtime.skills.voice_generation.voice_api',
});
function parseSkillManifest(root:string,entryName:string):SkillOperationManifest {
  const file=path.join(root,entryName,'operations.json'),manifest=JSON.parse(readFileSync(file,'utf8')) as SkillOperationManifest;
  if(!manifest||typeof manifest!=='object'||manifest.skill!==entryName||!/^[a-z][a-z0-9_-]*$/.test(manifest.skill)
    ||manifest.entry!==PUBLISHED_SKILL_ENTRIES[manifest.skill]
    ||!Array.isArray(manifest.tools)||!manifest.tools.length||!Array.isArray(manifest.operations)||!manifest.operations.length)throw new Error('SKILL_OPERATION_MANIFEST_INVALID');
  const localIds=new Set<string>(),localTools=new Set<string>(),routed=new Map<string,string>();
  for(const operation of manifest.operations){
    if(!/^[a-z][a-z0-9_]{1,80}$/.test(operation.id)||localIds.has(operation.id)
      ||!Number.isSafeInteger(operation.quotaUnits)||operation.quotaUnits<1||!Array.isArray(operation.inputKinds)
      ||operation.role&&!['asr','video','tts'].includes(operation.role)
      ||operation.localTransform!==undefined&&typeof operation.localTransform!=='boolean')throw new Error('SKILL_OPERATION_MANIFEST_INVALID');
    localIds.add(operation.id);
  }
  for(const declaration of manifest.tools){
    if(!/^[a-z][a-z0-9_]+$/.test(declaration.tool?.name)||localTools.has(declaration.tool.name)
      ||declaration.permissionTool!==undefined&&!/^[a-z][a-z0-9_]+$/.test(declaration.permissionTool)
      ||declaration.enabledRoles!==undefined&&(!Array.isArray(declaration.enabledRoles)||declaration.enabledRoles.some(role=>!['asr','video','tts'].includes(role))))throw new Error('SKILL_OPERATION_MANIFEST_INVALID');
    localTools.add(declaration.tool.name);
    if(!declaration.routes?.length||declaration.routes.some(route=>!localIds.has(route.operation)))throw new Error('SKILL_OPERATION_ROUTE_INVALID');
    for(const route of declaration.routes){if(routed.has(route.operation)&&routed.get(route.operation)!==declaration.tool.name)throw new Error('SKILL_OPERATION_ROUTE_INVALID');routed.set(route.operation,declaration.tool.name);}
  }
  if(manifest.operations.some(operation=>!routed.has(operation.id)))throw new Error('SKILL_OPERATION_ROUTE_INVALID');
  return manifest;
}

/** Only shipped package skills supply executable manifests, never persona-written files. */
export function loadSkillOperations(root=path.join(packageRoot(),'skills'),options:{tolerateInvalid?:boolean;validateEntries?:boolean}={}):SkillOperationManifest[]{
  const candidates:SkillOperationManifest[]=[];
  for(const entry of readdirSync(root,{withFileTypes:true})){
    if(!entry.isDirectory()||!existsSync(path.join(root,entry.name,'operations.json')))continue;
    try{const manifest=parseSkillManifest(root,entry.name);if(options.validateEntries){const module=path.join(packageRoot(),'python',...manifest.entry.split('.'));if(!existsSync(`${module}.py`)&&!existsSync(path.join(module,'__init__.py')))throw Error('SKILL_OPERATION_ENTRY_MISSING');}candidates.push(manifest);}catch(error){if(!options.tolerateInvalid)throw error;}
  }
  const operationOwners=new Map<string,SkillOperationManifest>(),toolOwners=new Map<string,SkillOperationManifest>(),conflicts=new Set<SkillOperationManifest>();
  for(const manifest of candidates){
    for(const operation of manifest.operations){const previous=operationOwners.get(operation.id);if(previous){conflicts.add(previous);conflicts.add(manifest);}else operationOwners.set(operation.id,manifest);}
    for(const declaration of manifest.tools){const previous=toolOwners.get(declaration.tool.name);if(previous){conflicts.add(previous);conflicts.add(manifest);}else toolOwners.set(declaration.tool.name,manifest);}
  }
  if(conflicts.size&&!options.tolerateInvalid)throw new Error('SKILL_OPERATION_MANIFEST_INVALID');
  return candidates.filter(manifest=>!conflicts.has(manifest));
}

export const skillOperationManifests:readonly SkillOperationManifest[]=PUBLISHED_SKILL_OPERATIONS;
export const skillToolManifests: readonly SkillToolManifest[] = skillOperationManifests.flatMap(manifest => manifest.tools.map(declaration => ({...declaration, skill: manifest.skill, entry: manifest.entry, operations: manifest.operations.filter(operation => declaration.routes.some(route => route.operation === operation.id))})));

export function resolveSkillOperation(manifest: SkillToolDeclaration, args: Record<string, unknown>): string {
  const values = {...manifest.defaults, ...args};
  const route = manifest.routes.find(route => Object.entries(route.match).every(([key, value]) => values[key] === value));
  if (!route) throw new Error('SKILL_OPERATION_ARGUMENTS_INVALID');
  return route.operation;
}

export function validateSkillSource(operation: SkillOperation, inputs: string[], parameters: Record<string, unknown>): void {
  if (operation.urlRequiredError && (parameters.url === undefined || inputs.length)) throw new Error(operation.urlRequiredError);
  if (parameters.url !== undefined) {
    if (operation.exclusiveSourceError && inputs.length) throw new Error(operation.exclusiveSourceError);
    if (operation.urlHosts && !operation.urlHosts.includes(new URL(String(parameters.url)).hostname)) throw new Error(operation.urlHostError ?? 'UNSUPPORTED_MEDIA_PLATFORM');
  }
}
