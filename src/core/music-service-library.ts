import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {canonicalJsonHash} from './canonical-json.js';
import {ConflictError} from './errors.js';
import type {VoiceLibrarySettingsRepository} from './ports/media.js';
import type {ProfileStore} from './profile-store.js';
import type {ServiceProfileRevision} from './service-contract.js';
import {musicProfileConfig, musicServiceSettingsInputSchema, musicServiceSettingsSchema, type MusicServiceSettings} from './music-config.js';

const PROFILE_ID = 'default';
const SOURCE_ID = 'music-service-settings';
const CAPABILITIES = ['music.search', 'music.acquire'] as const;

export interface MusicServiceReport {
  state: 'ready' | 'partial' | 'blocked' | 'missing';
  profileCount: number;
  checkedAt: number;
  safeDiagnostic?: string;
}

export interface MusicServiceView extends MusicServiceSettings {
  revision: string;
  report: MusicServiceReport;
}

const revision = (value: MusicServiceSettings): string => `sha256:${canonicalJsonHash(value)}`;

/**
 * Discovers the operator's Music project as a single managed service Profile.
 * The project owns musicdl and its provider clients; the bot only launches its
 * JSON protocol.  Kuwo and NetEase therefore remain ordinary ordered sources,
 * with no provider credentials or network code stored in the plugin.
 */
export class MusicServiceLibrary {
  private report: MusicServiceReport = {state: 'missing', profileCount: 0, checkedAt: 0};
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    readonly settingsRepository: VoiceLibrarySettingsRepository,
    readonly profiles: ProfileStore,
    readonly defaults: Partial<MusicServiceSettings> = {},
  ) {}

  private settings(): MusicServiceSettings {
    const stored = this.settingsRepository.read();
    const value = stored && typeof stored === 'object' ? stored as Record<string, unknown> : {};
    return musicServiceSettingsSchema.parse({
      musicHome: value.musicHome ?? this.defaults.musicHome ?? process.env.BOT_MUSIC_HOME ?? process.env.MUSIC_HOME,
      musicSources: value.musicSources ?? this.defaults.musicSources ?? undefined,
    });
  }

  view(): MusicServiceView {
    const settings = this.settings();
    return {...settings, revision: revision(settings), report: {...this.report}};
  }

  status(): MusicServiceReport {
    return {...this.report};
  }

  profile(): ServiceProfileRevision | undefined {
    return this.profiles.get({serviceId: 'music', profileId: PROFILE_ID});
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const current = this.pending.then(action, action);
    this.pending = current.catch(() => undefined);
    return current;
  }

  async save(input: unknown, signal: AbortSignal): Promise<MusicServiceView> {
    const {expectedRevision, ...raw} = musicServiceSettingsInputSchema.parse(input);
    return this.exclusive(async () => {
      signal.throwIfAborted();
      const current = this.settings();
      if (expectedRevision !== revision(current) && (expectedRevision !== undefined || this.settingsRepository.read() !== undefined)) {
        throw new ConflictError('音乐服务配置已变化，请刷新后重试');
      }
      const stored = this.settingsRepository.read();
      this.settingsRepository.write({...stored as Record<string, unknown>, ...raw});
      await this.refreshNow(signal);
      return this.view();
    });
  }

  async initialize(signal: AbortSignal = new AbortController().signal): Promise<void> {
    await this.refresh(signal);
  }

  async close(): Promise<void> {
    await this.pending;
  }

  async refresh(signal: AbortSignal = new AbortController().signal): Promise<void> {
    await this.exclusive(() => this.refreshNow(signal));
  }

  private async refreshNow(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const settings = this.settings();
    const checkedAt = Date.now();
    const managedConfig = musicProfileConfig(settings);
    let state: MusicServiceReport['state'] = 'ready';
    let safeDiagnostic: string | undefined;
    try {
      const info = await lstat(settings.musicHome);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('MUSIC_HOME_INVALID');
    } catch (error) {
      state = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'blocked';
      safeDiagnostic = state === 'missing' ? 'MUSIC_HOME_MISSING' : 'MUSIC_HOME_INVALID';
    }
    const python = path.join(settings.musicHome, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const entry = path.join(settings.musicHome, 'scripts', 'music_api.py');
    if (state === 'ready') {
      try {
        const [pythonInfo, entryInfo] = await Promise.all([lstat(python), lstat(entry)]);
        if (!pythonInfo.isFile() || pythonInfo.isSymbolicLink() || !entryInfo.isFile() || entryInfo.isSymbolicLink()) throw new Error('MUSIC_RUNTIME_MISSING');
      } catch {
        state = 'blocked';
        safeDiagnostic = 'MUSIC_RUNTIME_MISSING';
      }
    }
    const resourceHash = canonicalJsonHash({home: settings.musicHome, python, entry});
    this.profiles.create({
      serviceId: 'music', profileId: PROFILE_ID, state, capabilities: CAPABILITIES,
      displayName: 'Music catalog', modelLabel: settings.musicSources.join(' → '),
      managedConfig: {...managedConfig}, discovery: {sourceId: SOURCE_ID, resourceHash}, updatedAt: checkedAt,
    });
    this.report = {state, profileCount: 1, checkedAt, ...(safeDiagnostic ? {safeDiagnostic} : {})};
  }
}

