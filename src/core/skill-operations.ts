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
}
export interface SkillOperationManifest {
  skill: string;
  enabledRoles?: AnalysisRole[];
  /** Permission checked by the runtime before dispatching this skill. */
  permissionTool?: string;
  worker: string;
  tool: {name: string; description: string; parameters: Record<string, any>};
  routes: {match: Record<string, string>; operation: string}[];
  defaults: Record<string, string>;
  operations: SkillOperation[];
}

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
      || !/^[a-z][a-z0-9_]+$/.test(manifest.tool?.name) || tools.has(manifest.tool.name)
      || manifest.permissionTool !== undefined && !/^[a-z][a-z0-9_]+$/.test(manifest.permissionTool)
      || manifest.enabledRoles !== undefined && (!Array.isArray(manifest.enabledRoles) || manifest.enabledRoles.some(role => !['asr', 'video', 'tts'].includes(role)))
      || !existsSync(path.join(root, entry.name, manifest.worker)) || !manifest.operations?.length) throw new Error('SKILL_OPERATION_MANIFEST_INVALID');
    tools.add(manifest.tool.name);
    for (const operation of manifest.operations) {
      if (!/^[a-z][a-z0-9_]{1,80}$/.test(operation.id) || ids.has(operation.id)
        || !Number.isSafeInteger(operation.quotaUnits) || operation.quotaUnits < 1
        || !Array.isArray(operation.inputKinds) || operation.role && !['asr', 'video', 'tts'].includes(operation.role)) throw new Error('SKILL_OPERATION_MANIFEST_INVALID');
      ids.add(operation.id);
    }
    if (!manifest.routes?.length || manifest.routes.some(route => !manifest.operations.some(op => op.id === route.operation))) throw new Error('SKILL_OPERATION_ROUTE_INVALID');
    manifests.push(manifest);
  }
  return manifests;
}

export const skillOperationManifests = loadSkillOperations();

export function resolveSkillOperation(manifest: SkillOperationManifest, args: Record<string, unknown>): string {
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
