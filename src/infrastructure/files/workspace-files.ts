import {cp, mkdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {prepareWorkingDirectory,sessionDirectory} from '../../core/workspaces.js';
import {assetFolder, exists, mediaFolders, moveFile, type AssetOrigin} from '../../core/media-paths.js';
import type {ChatHistoryEvent, HistoryLocationRepository, WorkspacePort} from '../../core/ports/workspace.js';
import type {AutomationRepository} from '../../core/ports/automation.js';
import type {BotRepository} from '../../core/ports/bot.js';
import type {BindingRepository, SessionRepository} from '../../core/ports/session.js';

export {assetFolder, exists, mediaFolders, moveFile, type AssetOrigin};

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
  async session(scope:string,sessionId:string,beforeMove?:()=>Promise<void>):Promise<string> {
    const record=this.deps.sessions().findSession(sessionId);if(!record||record.scopeKey!==scope)throw Error('SESSION_OWNERSHIP_MISMATCH');
    const workspace=await this.scopeWorkspace(scope),directory=sessionDirectory(workspace,sessionId);
    if(record.workspace&&path.resolve(record.workspace)!==workspace){
      await beforeMove?.();
      const previous=sessionDirectory(record.workspace,sessionId);
      if(await exists(previous)){
        if(await exists(directory))throw Error('SESSION_WORKSPACE_TARGET_EXISTS');
        await mkdir(path.dirname(directory),{recursive:true});
        try{await rename(previous,directory);}
        catch(error){
          if((error as NodeJS.ErrnoException).code!=='EXDEV')throw error;
          try{await cp(previous,directory,{recursive:true,force:false,errorOnExist:true});}
          catch(copyError){await rm(directory,{recursive:true,force:true});throw copyError;}
          await rm(previous,{recursive:true});
        }
      }
    }
    await Promise.all(['outputs',path.join('.bot','tmp')].map(folder=>mkdir(path.join(directory,folder),{recursive:true})));
    this.deps.sessions().setWorkspace(scope,sessionId,workspace);
    return realpath(directory);
  }
  async scopeWorkspace(scope: string): Promise<string> {
    const owner = this.deps.bindings().findBinding(scope)
      ?? this.deps.sessions().sessionsAll().find(item => item.scopeKey === scope)
      ?? this.deps.automation().findJobByScope(scope)
      ?? this.deps.automation().findProactiveByScope(scope);
    if (!owner) throw Error('SESSION_NOT_FOUND');
    return prepareWorkingDirectory(this.deps.bots().bot(owner.scope.botId), scope, this.deps.home);
  }
  async write(scope: string, sessionId: string, events: readonly unknown[]): Promise<void> {
    return this.writeChatHistory(scope, sessionId, events as readonly ChatHistoryEvent[]);
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
