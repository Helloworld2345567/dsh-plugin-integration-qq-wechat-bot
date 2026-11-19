import type {BotInstance, BotSettings} from '../types.js';

export type StoredBot = BotInstance & {settings: BotSettings};

/** Channel identities (bots).  Ownership and uniqueness rules stay in the adapter. */
export interface BotRepository {
  bots(): StoredBot[];
  bot(id: string): StoredBot;
  saveBot(input: unknown): StoredBot;
  countBots(): number;
}
