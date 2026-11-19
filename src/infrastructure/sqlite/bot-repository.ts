import {storageDescriptor} from '../../i18n/storage.js';
import {LocalizedError} from '../../core/errors.js';
import {botSchema,botSettingsFromConfig} from '../../core/types.js';
import type {BotRepository, StoredBot} from '../../core/ports/bot.js';
import type {PersonaConfigRepository} from '../../core/ports/persona.js';
import type {SqliteDatabase} from './database.js';

/** Channel identities.  A channel identity may never change after creation. */
export class SqliteBotRepository implements BotRepository {
  constructor(private readonly database: SqliteDatabase, private readonly personas: () => PersonaConfigRepository) {}
  bots(): StoredBot[] {return this.database.records.list<StoredBot>('bot');}
  bot(id: string): StoredBot {
    const bot = this.database.records.get<StoredBot>('bot', id);
    if (!bot) throw new LocalizedError(storageDescriptor('botMissing'),'机器人不存在');
    return bot;
  }
  saveBot(input: unknown): StoredBot {
    const value = botSchema.parse(input);
    const persona=this.personas().config(value.configId);
    return this.database.transaction(() => {
      if (value.accountId && this.bots().some(bot => bot.id !== value.id && !bot.archived && bot.channel === value.channel && bot.accountId === value.accountId)) throw new LocalizedError(storageDescriptor('accountAlreadyBound'),'该平台账号已经绑定其他机器人');
      const previous = this.database.records.get<StoredBot>('bot', value.id);
      if (previous && (previous.channel !== value.channel || (previous.accountId && previous.accountId !== value.accountId))) throw new LocalizedError(storageDescriptor('botIdentityImmutable'),'已有机器人的渠道身份不可修改；请创建新机器人');
      const next={...value,settings:value.settings??previous?.settings??botSettingsFromConfig(persona)};
      this.database.records.put('bot', value.id, next);
      return next;
    });
  }
  countBots(): number {return this.database.records.count('bot');}
}
