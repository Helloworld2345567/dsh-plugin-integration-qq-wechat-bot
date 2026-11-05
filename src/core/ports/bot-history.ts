/** One bot's owned rows and scopes, produced by the persistence adapter. */
export interface BotHistoryRecord {
  kind: string;
  id: string;
}

export interface BotHistorySnapshot {
  scopes: ReadonlySet<string>;
  sessions: ReadonlySet<string>;
  jobs: ReadonlySet<string>;
  records: readonly BotHistoryRecord[];
}
