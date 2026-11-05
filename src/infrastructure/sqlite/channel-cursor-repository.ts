import type {CursorStore, JsonValue} from '../../core/channel-ports.js';
import type {SqliteDatabase} from './database.js';

/**
 * Channel cursors.  The legacy unscoped `cursor` row stays in sync so an older
 * build can still resume; both writes happen in one transaction.
 */
export class SqliteChannelCursorRepository implements CursorStore {
  constructor(private readonly database: SqliteDatabase) {}
  read(channelId: string, botId: string): JsonValue | undefined {
    return this.database.records.get<JsonValue>('channel-cursor', `${channelId}:${botId}`) ?? this.database.records.get<JsonValue>('cursor', botId);
  }
  write(channelId: string, botId: string, value: JsonValue): void {
    this.database.transaction(() => {
      this.database.records.put('channel-cursor', `${channelId}:${botId}`, value);
      this.database.records.put('cursor', botId, value);
    });
  }
}
