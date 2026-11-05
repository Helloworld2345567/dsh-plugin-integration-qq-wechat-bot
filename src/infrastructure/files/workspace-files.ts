import {copyFile, mkdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {prepareWorkingDirectory} from '../../core/workspaces.js';
import type {Asset} from '../../core/types.js';
import type {AutomationRepository} from '../../core/ports/automation.js';
import type {BotRepository} from '../../core/ports/bot.js';
import type {BindingRepository, SessionRepository} from '../../core/ports/session.js';
import type {HistoryLocationRepository, WorkspacePort} from '../../core/ports/workspace.js';

export const mediaFolders = {image:'images', video:'videos', audio:'audio', file:'files'} as const;
export type AssetOrigin = 'received' | 'generated' | 'sent';

export interface ChatHistoryEvent {
  type: string;
  data?: {source?:{kind?:string}; message?:{content:Array<{type?:string}>}; stream?:unknown; [key:string]:unknown};
  [key:string]:unknown;
}

export interface WorkspaceFilesDeps {
  home: string;
  bindings: () => BindingRepository;
  sessions: () => SessionRepository;
  automation: () => AutomationRepository;
  bots: () => BotRepository;
  history: HistoryLocationRepository;
}

/**
 * File-side of scope storage: workspace resolution and the readable chat
 * history that accompanies the native compressed session log.
 */
export class WorkspaceFiles implements WorkspacePort {
  constructor(private readonly deps: WorkspaceFilesDeps) {}
  get home(): string {return this.deps.home;}
  async scope(scope: string): Promise<string> {return this.scopeWorkspace(scope);}
  async scopeWorkspace(scope: string): Promise<string> {
    const owner = this.deps.bindings().findBinding(scope)
      ?? this.deps.sessions().sessionsAll().find(item => item.scopeKey === scope)
      ?? this.deps.automation().findJobByScope(scope)
      ?? this.deps.automation().findProactiveByScope(scope);
    if (!owner) throw Error('SESSION_NOT_FOUND');
    return prepareWorkingDirectory(this.deps.bots().bot(owner.scope.botId), scope, this.deps.home);
  }
  async writeChatHistory(scope: string, sessionId: string, events: readonly ChatHistoryEvent[]): Promise<void> {
    const workspace = await this.scopeWorkspace(scope), directory = path.join(workspace, 'history', scope);
    await mkdir(directory, {recursive:true});
    const rows = events.filter(event => ['user/message', 'assistant/message', 'tool/result', 'turn/start', 'turn/end'].includes(event.type) && (event.type !== 'user/message' || !['runtime-context', 'timing'].includes(event.data?.source?.kind ?? ''))).map(event => {
      if (event.type !== 'assistant/message') return event;
      const {stream:_stream, ...data} = event.data ?? {};
      const message = data.message as {content:Array<{type?:string}>; [key:string]:unknown} | undefined;
      return {...event, data:{...data, message:message ? {...message, content:message.content.filter(block => block.type !== 'reasoning')} : message}};
    });
    const file = path.join(directory, `${sessionId}.jsonl`), temporary = `${file}.tmp`;
    const previous = this.deps.history.find(sessionId);
    if (previous && path.resolve(previous.file) !== path.resolve(file) && await exists(previous.file)) await moveFile(previous.file, file);
    await writeFile(temporary, rows.map(row => JSON.stringify(row)).join('\n') + '\n', {mode:0o600});
    await rename(temporary, file);
    this.deps.history.save({scopeKey:scope, sessionId, file});
  }
}

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
