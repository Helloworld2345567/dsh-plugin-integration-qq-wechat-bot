import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {configSchema, idSchema, parsePersonaSettings, type BotConfig} from '../../core/types.js';
import {defaultPersonasRoot} from '../../core/personas.js';

type Pair = {config:string|null;persona:string|null};
const digest = (pair: Pair) => createHash('sha256').update(JSON.stringify(pair)).digest('hex');

/**
 * Editable persona drafts on disk.  SQLite only keeps the applied configuration
 * and its revisions; this adapter owns every file operation and its journal.
 */
export class PersonaFiles {
  constructor(readonly root: string) {
    mkdirSync(root, {recursive:true});
    this.directory();
  }
  static forHome(home: string, personasRoot = defaultPersonasRoot(home)): PersonaFiles {return new PersonaFiles(personasRoot);}
  directory(id?: string): string {
    if (lstatSync(this.root).isSymbolicLink() || !lstatSync(this.root).isDirectory()) throw new Error('人格根目录必须是普通目录');
    if (id === undefined) return this.root;
    idSchema.parse(id);
    if (/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(id)) throw new Error('人格 ID 不能使用系统保留名称');
    const collision = readdirSync(this.root).find(name => name.toLowerCase() === id.toLowerCase() && name !== id);
    if (collision) throw new Error('人格 ID 大小写与已有目录冲突');
    const folder = path.join(this.root, id);
    if (existsSync(folder) && (lstatSync(folder).isSymbolicLink() || !lstatSync(folder).isDirectory())) throw new Error('人格目录必须是普通目录');
    return folder;
  }
  ids(): string[] {return readdirSync(this.directory()).filter(id => idSchema.safeParse(id).success);}
  private file(id: string, name: string): string {
    const file = path.join(this.directory(id), name);
    try {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('人格文件必须是普通文件');
      if (stat.size > 512 * 1024) throw new Error('人格文件超过 512 KiB');
    } catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
    return file;
  }
  private text(id: string, name: string): string | null {
    const file = this.file(id, name);
    try { return readFileSync(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  private pair(id: string): Pair {return {config:this.text(id, 'config.json'), persona:this.text(id, 'persona.md')};}
  private encoded(config: BotConfig): Pair {
    const {personaPrompt, ...settings} = configSchema.parse(config);
    return {config:JSON.stringify(settings, null, 2) + '\n', persona:personaPrompt};
  }
  private replace(id: string, name: string, text: string | null): void {
    const file = this.file(id, name);
    if (text === null) { if (existsSync(file)) unlinkSync(file); return; }
    const temporary = path.join(this.directory(id), `.${name}.${randomUUID()}.tmp`);
    try { writeFileSync(temporary, text, {flag:'wx', mode:0o600, flush:true}); renameSync(temporary, file); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  hasFiles(id: string): boolean {const pair = this.pair(id); return pair.config !== null || pair.persona !== null;}
  read(id: string): {config:BotConfig;digest:string} {
    if (this.text(id, '.pending.json') !== null) throw new Error('人格文件有未完成的保存，请重新打开实例后核对');
    const pair = this.pair(id);
    if (pair.config === null || pair.persona === null) throw new Error('人格目录必须同时包含 config.json 和 persona.md');
    const settings = JSON.parse(pair.config.replace(/^\uFEFF/, ''));
    const config = parsePersonaSettings(settings, pair.persona.replace(/^﻿/, ''));
    if (config.id !== id) throw new Error('config.json 的 ID 必须与人格目录名一致');
    return {config, digest:digest(pair)};
  }
  currentDigest(id: string): string {return digest(this.pair(id));}
  /** A durable journal bridges file replacement and the SQLite commit, including process crashes. */
  publish<T>(config: BotConfig, commit: (fingerprint: string) => T): T {
    const id = config.id, folder = this.directory(id);
    mkdirSync(folder, {recursive:true});
    const journal = this.file(id, '.pending.json'), before = this.pair(id), after = this.encoded(config);
    writeFileSync(journal, JSON.stringify({pid:process.pid, before, after}), {flag:'wx', mode:0o600, flush:true});
    let committed = false;
    try {
      this.restore(id, after, before, after);
      const result = commit(digest(after));
      committed = true;
      // A leftover journal is safe: recovery checks the committed revision before touching files.
      try { unlinkSync(journal); } catch {}
      return result;
    } catch (error) {
      if (!committed) { this.restore(id, before, before, after); unlinkSync(journal); }
      throw error;
    }
  }
  private restore(id: string, target: Pair, before: Pair, after: Pair): void {
    const current = this.pair(id);
    for (const key of ['config', 'persona'] as const) if (current[key] !== before[key] && current[key] !== after[key]) throw new Error('人格文件在保存期间被修改，已保留现场，请核对 .pending.json');
    this.replace(id, 'persona.md', target.persona);
    this.replace(id, 'config.json', target.config);
  }
  recover(id: string, applied?: BotConfig): void {
    const journal = this.text(id, '.pending.json');
    if (journal === null) return;
    const parsed = JSON.parse(journal) as {pid?:unknown;before?:unknown;after?:unknown};
    if (Number.isInteger(parsed.pid) && (parsed.pid as number) > 0) {
      let alive = true;
      try { process.kill(parsed.pid as number, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
      if (alive) throw new Error('人格文件仍由活动进程保存，暂不恢复，请稍后重试');
    }
    const valid = (pair: unknown): pair is Pair => {
      const value = pair as Partial<Record<'config' | 'persona', unknown>> | null | undefined;
      return !!value && (['config', 'persona'] as const).every(key => value[key] === null || typeof value[key] === 'string');
    };
    if (!valid(parsed.before) || !valid(parsed.after)) throw new Error('人格保存日志无效，请核对 .pending.json');
    const {before, after} = parsed as {before:Pair;after:Pair};
    const target = applied && digest(this.encoded(applied)) === digest(after) ? after : before;
    this.restore(id, target, before, after);
    unlinkSync(this.file(id, '.pending.json'));
  }
}
