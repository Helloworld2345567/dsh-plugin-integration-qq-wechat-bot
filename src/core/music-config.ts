import path from 'node:path';
import {z} from 'zod';
import {MUSIC_SOURCES} from './music-state.js';

/**
 * Sources understood by the Music JSON adapter.  The array order is
 * significant: the Music project tries sources in this order and stops after
 * a complete match has been acquired.
 */
export const MUSIC_SOURCE_IDS = MUSIC_SOURCES;
export type MusicSourceId = (typeof MUSIC_SOURCE_IDS)[number];

/** Sources that have a usable, login-free default in the managed Music app. */
export const DEFAULT_MUSIC_SOURCES = Object.freeze([
  'MiguMusicClient',
  'KuwoMusicClient',
] as const satisfies readonly MusicSourceId[]);

const windowsAbsolute = (value: string): boolean => path.win32.isAbsolute(value);
export const musicHomeSchema = z.string().trim().min(1).max(4096)
  .refine(value => !/[\x00-\x1f]/.test(value), {message: 'Music project root contains control characters'})
  .refine(value => path.isAbsolute(value) || windowsAbsolute(value), {message: 'Music project root must be an absolute path'})
  .transform(value => path.isAbsolute(value) ? path.resolve(value) : path.win32.normalize(value));

export const musicSourcesSchema = z.array(z.enum(MUSIC_SOURCE_IDS)).min(1).max(MUSIC_SOURCE_IDS.length)
  .refine(value => new Set(value).size === value.length, {message: 'Music sources must be unique'});

export const defaultMusicHome = (): string => {
  const configured = process.env.BOT_MUSIC_HOME ?? process.env.MUSIC_HOME;
  if (configured?.trim()) return configured.trim();
  // The managed Music project is the default Windows deployment directory.
  // Operators can override it in the service panel or with BOT_MUSIC_HOME.
  return process.platform === 'win32' ? `${String.fromCharCode(69)}:${String.fromCharCode(92)}Music` : path.resolve('.runtime', 'music');
};

/** Operator-owned Music service settings used to materialize the private profile. */
export const musicServiceSettingsSchema = z.object({
  musicHome: musicHomeSchema.default(defaultMusicHome()),
  musicSources: musicSourcesSchema.default([...DEFAULT_MUSIC_SOURCES]),
}).strict();

export const musicServiceSettingsInputSchema = musicServiceSettingsSchema.extend({
  expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
});

export type MusicServiceSettings = z.infer<typeof musicServiceSettingsSchema>;
export type MusicServiceSettingsInput = z.infer<typeof musicServiceSettingsInputSchema>;

/** The private profile shape consumed by MusicServiceAdapter. */
export interface MusicProfileConfigShape {home: string; sources: readonly MusicSourceId[]}

export function musicProfileConfig(settings: MusicServiceSettings): MusicProfileConfigShape {
  const value = musicServiceSettingsSchema.parse(settings);
  return {home: value.musicHome, sources: Object.freeze([...value.musicSources])};
}

/** Stable labels for panel controls and diagnostics. */
export const MUSIC_SOURCE_LABELS: Readonly<Record<MusicSourceId, {zh: string; en: string}>> = Object.freeze({
  MiguMusicClient: {zh: '咪咕音乐', en: 'Migu Music'},
  KuwoMusicClient: {zh: '酷我音乐', en: 'Kuwo Music'},
  QQMusicClient: {zh: 'QQ 音乐', en: 'QQ Music'},
  NeteaseMusicClient: {zh: '网易云音乐', en: 'NetEase Music'},
});
