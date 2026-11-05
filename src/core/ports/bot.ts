import type {BotInstance} from '../types.js';

/** Channel identities (bots).  Ownership and uniqueness rules stay in the adapter. */
export interface BotRepository {
  bots(): BotInstance[];
  bot(id: string): BotInstance;
  saveBot(input: unknown): BotInstance;
  countBots(): number;
}
