import {storageDescriptor} from '../../i18n/storage.js';
import {LocalizedError} from '../../core/errors.js';
import {botSchema,botSettingsFromConfig, type BotConfig, type BotInstance} from '../../core/types.js';
import type {BotRepository} from '../../core/ports/bot.js';
import type {PersonaConfigRepository} from '../../core/ports/persona.js';
import type {SqliteDatabase} from './database.js';

/** Channel identities.  A channel identity may never change after creation. */
export class SqliteBotRepository implements BotRepository {
  constructor(private readonly database: SqliteDatabase, private readonly personas: () => PersonaConfigRepository) {}
  bots(): BotInstance[] {return this.database.records.list<BotInstance>('bot');}
  bot(id: string): BotInstance {
    const bot = this.database.records.get<BotInstance>('bot', id);
    if (!bot) throw new LocalizedError(storageDescriptor('botMissing'),'机器人不存在');
    return bot;
  }
  saveBot(input: unknown): BotInstance {
    const value = botSchema.parse(input);
    const persona=this.personas().config(value.configId);
    return this.database.transaction(() => {
      if (value.accountId && this.bots().some(bot => bot.id !== value.id && !bot.archived && bot.channel === value.channel && bot.accountId === value.accountId)) throw new LocalizedError(storageDescriptor('accountAlreadyBound'),'该平台账号已经绑定其他机器人');
      const previous = this.database.records.get<BotInstance>('bot', value.id);
      if (previous && (previous.channel !== value.channel || (previous.accountId && previous.accountId !== value.accountId))) throw new LocalizedError(storageDescriptor('botIdentityImmutable'),'已有机器人的渠道身份不可修改；请创建新机器人');
      const next={...value,settings:value.settings??previous?.settings??botSettingsFromConfig(previous?this.personas().config(previous.configId):persona)};
      this.database.records.put('bot', value.id, next);
      return next;
    });
  }
  migrateSettings(): void {
    this.database.transaction(()=>{
      for(const bot of this.bots())if(!bot.settings){
        const persona=this.personas().findConfig(bot.configId);
        if(!persona){if(bot.archived)continue;throw new LocalizedError(storageDescriptor('botConfigMissing',{id:bot.id}),`机器人 ${bot.id} 的配置不存在`);}
        this.database.records.put('bot',bot.id,{...bot,settings:botSettingsFromConfig(persona)});
      }
    });
  }
  countBots(): number {return this.database.records.count('bot');}
  /** Validates that every bot still points at an applied configuration. */
  configFor(id: string): BotConfig {return this.personas().config(id);}
}
