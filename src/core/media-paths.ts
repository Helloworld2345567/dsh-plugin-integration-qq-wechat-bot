import {copyFile, mkdir, rename, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import type {Asset} from './types.js';

export const mediaFolders = {image:'images', video:'videos', audio:'audio', file:'files'} as const;
export type AssetOrigin = 'received' | 'generated' | 'sent';

/** Deterministic on-disk layout: kind / origin / date / scope / asset id. */
export function assetFolder(workspace: string, asset: Pick<Asset, 'scopeKey'|'id'|'kind'|'createdAt'|'jobId'|'origin'>): string {
  return path.join(workspace, mediaFolders[asset.kind], asset.origin ?? (asset.jobId ? 'generated' : 'received'), new Date(asset.createdAt).toISOString().slice(0, 10), asset.scopeKey, asset.id);
}
export async function moveFile(source: string, target: string): Promise<void> {
  if (path.resolve(source) === path.resolve(target)) return;
  await mkdir(path.dirname(target), {recursive:true});
  try { await rename(source, target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(source, target);
    await rm(source);
  }
}
export async function exists(file: string): Promise<boolean> {
  try { await stat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return false; }
}
