import type {CursorStore, JsonValue} from '../../core/channel-ports.js';
import type {SqliteDatabase} from './database.js';

export class SqliteChannelCursorRepository implements CursorStore {
  constructor(private readonly database: SqliteDatabase) {}
  read(channelId: string, botId: string): JsonValue | undefined {
    return this.database.records.get<JsonValue>('channel-cursor', `${channelId}:${botId}`);
  }
  write(channelId: string, botId: string, value: JsonValue): void {
    this.database.records.put('channel-cursor', `${channelId}:${botId}`, value);
  }
}
