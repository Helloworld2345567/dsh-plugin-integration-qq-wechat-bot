import {readdir, rm} from 'node:fs/promises';
import path from 'node:path';
import {scopeKey} from '../core/identity.js';
import type {Asset, CallerScope} from '../core/types.js';
import type {BotRepository} from '../core/ports/bot.js';
import type {DeliveryRepository} from '../core/ports/delivery.js';
import type {InboxRepository} from '../core/ports/inbox.js';
import type {SqliteDatabase} from './sqlite/database.js';
import {assetFolder, mediaFolders, type WorkspaceFiles} from './files/workspace-files.js';
import type {BotHistorySnapshot as PortBotHistorySnapshot} from '../core/ports/bot-history.js';

export interface BotHistoryDeps {
  database: SqliteDatabase;
  bots: () => BotRepository;
  inbox: () => InboxRepository;
  deliveries: () => DeliveryRepository;
  workspace: () => WorkspaceFiles;
}

interface HistoryRow {kind:string;id:string;json:string;value:Record<string, unknown>}
export interface BotHistorySnapshot {
  scopes: Set<string>;
  sessions: Set<string>;
  jobs: Set<string>;
  records: HistoryRow[];
}

/**
 * Ownership is taken from persisted channel identities, never from model paths.
 * One bot's deletion must never touch another bot's data.
 */
export class BotHistoryService {
  constructor(private readonly deps: BotHistoryDeps) {}
  snapshot(botId: string): BotHistorySnapshot {
    const rows = this.deps.database.records.entries().map(row => ({...row, value:JSON.parse(row.json) as Record<string, unknown>}));
    const scopes = new Set<string>(), sessions = new Set<string>(), jobs = new Set<string>(), automations = new Set<string>();
    const scopeOf = (value: Record<string, unknown> | undefined): CallerScope | undefined => {
      const scope = value?.scope as CallerScope | undefined;
      return scope && typeof scope === 'object' && typeof scope.botId === 'string' ? scope : undefined;
    };
    for (const row of rows) {
      const value = row.value, scope = scopeOf(value);
      if (scope?.botId === botId) {
        scopes.add(scopeKey(scope));
        if (row.kind === 'session') sessions.add(row.id);
        if (row.kind === 'binding') sessions.add(String(value.sessionId));
      }
      if (row.kind === 'stats-session' && value.botId === botId) sessions.add(String(value.sessionId));
    }
    for (const message of this.deps.inbox().allMessages()) if (message.scope.botId === botId) scopes.add(scopeKey(message.scope));
    for (const delivery of this.deps.deliveries().deliveries()) if (delivery.botId === botId) {scopes.add(delivery.scopeKey); sessions.add(delivery.sessionId);}
    const owns = (value: Record<string, unknown> | undefined) => value?.botId === botId || scopeOf(value)?.botId === botId || scopes.has(String(value?.scope)) || scopes.has(String(value?.scopeKey)) || sessions.has(String(value?.sessionId)) || sessions.has(String(value?.rootSessionId));
    for (const row of rows) if (owns(row.value)) { if (row.kind === 'job') jobs.add(row.id); if (['scheduled-job', 'proactive-config'].includes(row.kind)) automations.add(row.id); }
    const ids = new Set([...scopes, ...sessions, ...automations]);
    const records = rows.filter(row => !['bot', 'config', 'config-version', 'persona-files'].includes(row.kind) && (owns(row.value) || ids.has(row.id) ||
      (['failure', 'media-quota'].includes(row.kind) && row.id.split(':').some(part => ids.has(part))) ||
      (row.kind === 'cursor' && row.id === botId) || (row.kind === 'channel-cursor' && row.id === `${this.deps.bots().bot(botId).channel}:${botId}`) ||
      (row.kind === 'reply-sequence' && (JSON.parse(row.id) as unknown[])[0] === botId)));
    return {scopes, sessions, jobs, records};
  }
  async deleteFiles(assetsRoot: string, snapshot: PortBotHistorySnapshot): Promise<void> {
    const history = snapshot as BotHistorySnapshot;
    for (const row of history.records) if (row.kind === 'asset') {
      const asset = row.value as unknown as Asset;
      if (asset.workspace) {
        const directory = assetFolder(asset.workspace, asset);
        if (path.dirname(asset.path) !== directory) throw Error('BOT_HISTORY_PATH_INVALID');
        await rm(directory, {recursive:true, force:true});
      }
    }
    for (const row of history.records) if (row.kind === 'history-location') {
      const file = row.value.file as string;
      if (path.basename(file) !== `${row.id}.jsonl`) throw Error('BOT_HISTORY_PATH_INVALID');
      await rm(file, {force:true});
    }
    for (const scope of history.scopes) {
      const workspace = await this.deps.workspace().scopeWorkspace(scope);
      for (const folder of [path.join(workspace, 'history', scope), path.join(workspace, '.bot', 'jobs', scope)]) await rm(folder, {recursive:true, force:true});
      // Remove scope partitions, keeping other scopes that share a custom workspace.
      for (const kind of Object.values(mediaFolders)) for (const origin of ['received', 'generated', 'sent']) {
        const root = path.join(workspace, kind, origin);
        let dates: string[];
        try { dates = await readdir(root); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        for (const date of dates) await rm(path.join(root, date, scope), {recursive:true, force:true});
      }
    }
    for (const [root, ids] of [[assetsRoot, history.scopes], [path.join(this.deps.database.home, 'jobs'), history.jobs]] as const) {
      for (const id of ids) {
        const target = path.resolve(root, id);
        if (path.dirname(target) !== path.resolve(root)) throw Error('BOT_HISTORY_PATH_INVALID');
        await rm(target, {recursive:true, force:true});
      }
    }
  }
  deleteRecords(botId: string, snapshot: PortBotHistorySnapshot): void {
    const history = snapshot as BotHistorySnapshot;
    this.deps.database.transaction(() => {
      const db = this.deps.database.db;
      for (const row of history.records) db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(row.kind, row.id);
      for (const scope of history.scopes) for (const table of ['inbox', 'deliveries', 'memory', 'forgotten', 'memory_sources', 'asset_index']) db.prepare(`DELETE FROM ${table} WHERE scope=?`).run(scope);
      db.prepare('DELETE FROM deliveries WHERE bot_id=?').run(botId);
      for (const table of ['stats_usage_calls', 'stats_message_facts']) db.prepare(`DELETE FROM ${table} WHERE bot=?`).run(botId);
      for (const table of ['stats_group_projection', 'stats_projection_meta']) db.prepare(`DELETE FROM ${table} WHERE json_extract(json,'$.botId')=?`).run(botId);
      db.prepare("UPDATE collection_revisions SET revision=revision+1 WHERE name IN ('sessions','assets')").run();
    });
  }
}
