import {botSchema, type BotConfig, type BotInstance} from '../../core/types.js';
import type {BotRepository} from '../../core/ports/bot.js';
import type {PersonaConfigRepository} from '../../core/ports/persona.js';
import type {SqliteDatabase} from './database.js';

/** Channel identities.  A channel identity may never change after creation. */
export class SqliteBotRepository implements BotRepository {
  constructor(private readonly database: SqliteDatabase, private readonly personas: () => PersonaConfigRepository) {}
  bots(): BotInstance[] {return this.database.records.list<BotInstance>('bot');}
  bot(id: string): BotInstance {
    const bot = this.database.records.get<BotInstance>('bot', id);
    if (!bot) throw new Error('机器人不存在');
    return bot;
  }
  saveBot(input: unknown): BotInstance {
    const value = botSchema.parse(input);
    this.personas().config(value.configId);
    return this.database.transaction(() => {
      if (value.accountId && this.bots().some(bot => bot.id !== value.id && !bot.archived && bot.channel === value.channel && bot.accountId === value.accountId)) throw new Error('该平台账号已经绑定其他机器人');
      const previous = this.database.records.get<BotInstance>('bot', value.id);
      if (previous && (previous.channel !== value.channel || (previous.accountId && previous.accountId !== value.accountId))) throw new Error('已有机器人的渠道身份不可修改；请创建新机器人');
      this.database.records.put('bot', value.id, value);
      return value;
    });
  }
  countBots(): number {return this.database.records.count('bot');}
  /** Validates that every bot still points at an applied configuration. */
  configFor(id: string): BotConfig {return this.personas().config(id);}
}
