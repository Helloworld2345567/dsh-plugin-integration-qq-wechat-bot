import path from 'node:path';
import {configSchema, type BotConfig} from './types.js';

/** Persona drafts live beside SQLite; they are never stored inside a bot record. */
export function defaultPersonasRoot(home: string): string {
  if (process.env.BOT_PERSONAS_ROOT) return path.resolve(process.env.BOT_PERSONAS_ROOT);
  const absolute = path.resolve(home);
  return path.basename(absolute) === 'bot-integration' && path.basename(path.dirname(absolute)) === 'storages'
    ? path.resolve(absolute, '../..', 'personas')
    : path.join(absolute, 'personas');
}
export function sameConfig(a: BotConfig, b: BotConfig): boolean {
  return JSON.stringify(configSchema.parse(a)) === JSON.stringify(configSchema.parse(b));
}
