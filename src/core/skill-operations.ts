import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {packageRoot} from './paths.js';
import type {AnalysisRole} from './analysis.js';

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
  worker: string;
  tools: SkillToolDeclaration[];
  operations: SkillOperation[];
}
export type SkillToolManifest = SkillToolDeclaration & Pick<SkillOperationManifest, 'skill' | 'worker' | 'operations'>;

/** Only shipped package skills supply executable manifests, never persona-written files. */
export function loadSkillOperations(root = path.join(packageRoot(), 'skills')): SkillOperationManifest[] {
  const manifests: SkillOperationManifest[] = [];
  const ids = new Set<string>();
  const tools = new Set<string>();
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, 'operations.json');
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as SkillOperationManifest;
    if (manifest.skill !== entry.name || !/^[a-z][a-z0-9_-]*$/.test(manifest.skill)
      || !/^scripts\/[a-zA-Z0-9_-]+\.py$/.test(manifest.worker)
      || !Array.isArray(manifest.tools) || !manifest.tools.length
      || !existsSync(path.join(root, entry.name, manifest.worker)) || !manifest.operations?.length) throw new Error('SKILL_OPERATION_MANIFEST_INVALID');
    for (const operation of manifest.operations) {
      if (!/^[a-z][a-z0-9_]{1,80}$/.test(operation.id) || ids.has(operation.id)
        || !Number.isSafeInteger(operation.quotaUnits) || operation.quotaUnits < 1
        || !Array.isArray(operation.inputKinds) || operation.role && !['asr', 'video', 'tts'].includes(operation.role)
        || operation.localTransform !== undefined && typeof operation.localTransform !== 'boolean') throw new Error('SKILL_OPERATION_MANIFEST_INVALID');
      ids.add(operation.id);
    }
    const routed = new Map<string, string>();
    for (const declaration of manifest.tools) {
      if (!/^[a-z][a-z0-9_]+$/.test(declaration.tool?.name) || tools.has(declaration.tool.name)
        || declaration.permissionTool !== undefined && !/^[a-z][a-z0-9_]+$/.test(declaration.permissionTool)
        || declaration.enabledRoles !== undefined && (!Array.isArray(declaration.enabledRoles) || declaration.enabledRoles.some(role => !['asr','video','tts'].includes(role)))) throw new Error('SKILL_OPERATION_MANIFEST_INVALID');
      tools.add(declaration.tool.name);
      if (!declaration.routes?.length || declaration.routes.some(route => !manifest.operations.some(op => op.id === route.operation))) throw new Error('SKILL_OPERATION_ROUTE_INVALID');
      for (const route of declaration.routes) {
        if (routed.has(route.operation) && routed.get(route.operation) !== declaration.tool.name) throw new Error('SKILL_OPERATION_ROUTE_INVALID');
        routed.set(route.operation, declaration.tool.name);
      }
    }
    if (manifest.operations.some(operation => !routed.has(operation.id))) throw new Error('SKILL_OPERATION_ROUTE_INVALID');
    manifests.push(manifest);
  }
  return manifests;
}

export const skillOperationManifests = loadSkillOperations();
export const skillToolManifests: SkillToolManifest[] = skillOperationManifests.flatMap(manifest => manifest.tools.map(declaration => ({...declaration, skill: manifest.skill, worker: manifest.worker, operations: manifest.operations.filter(operation => declaration.routes.some(route => route.operation === operation.id))})));

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
