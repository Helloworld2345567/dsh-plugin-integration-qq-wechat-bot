import type {SqliteDatabase} from './database.js';

/** Create the current repository tables and indexes. */
export function initializeSchema(database: SqliteDatabase): void {
  const db = database.db;
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS inbox(scope TEXT NOT NULL,id TEXT NOT NULL,received_at INTEGER NOT NULL DEFAULT 0,direct_image INTEGER NOT NULL DEFAULT 0,json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,scope TEXT NOT NULL,json TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL DEFAULT 0,bot_id TEXT NOT NULL DEFAULT '',turn_id TEXT NOT NULL DEFAULT '',output_index INTEGER NOT NULL DEFAULT 0,UNIQUE(scope,id));
      CREATE TABLE IF NOT EXISTS memory(scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,source TEXT NOT NULL,quote TEXT NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL,PRIMARY KEY(scope,key));
      CREATE TABLE IF NOT EXISTS forgotten(scope TEXT NOT NULL,source TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(scope,source,key));
      CREATE TABLE IF NOT EXISTS memory_sources(scope TEXT NOT NULL,key TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(scope,key,source));
      CREATE TABLE IF NOT EXISTS asset_index(id TEXT PRIMARY KEY,scope TEXT NOT NULL,session TEXT,kind TEXT NOT NULL,created_at INTEGER NOT NULL,size INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS collection_revisions(name TEXT PRIMARY KEY,revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS inbox_scope_state ON inbox(scope,state);
      CREATE INDEX IF NOT EXISTS records_kind_id ON records(kind,id);
      CREATE INDEX IF NOT EXISTS records_turn_metric_owner ON records(json_extract(json,'$.scopeKey'),json_extract(json,'$.sessionId'),json_extract(json,'$.turnId')) WHERE kind='turn-metric';
      CREATE INDEX IF NOT EXISTS records_stats_native_session ON records(kind, json_extract(json,'$.sessionId')) WHERE kind='stats-native';
      CREATE INDEX IF NOT EXISTS records_stats_auxiliary_session ON records(kind, json_extract(json,'$.sessionId')) WHERE kind='stats-auxiliary';
      CREATE INDEX IF NOT EXISTS deliveries_state_scope ON deliveries(state,scope);
      CREATE INDEX IF NOT EXISTS deliveries_scope_state_id ON deliveries(scope,state,id);
      CREATE INDEX IF NOT EXISTS deliveries_sent_asset_receipt ON deliveries(scope,json_extract(json,'$.receipt'))
        WHERE state='sent' AND json_extract(json,'$.output.type')='asset';
      CREATE INDEX IF NOT EXISTS deliveries_bot_state_created ON deliveries(bot_id,state,created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS deliveries_scope_created ON deliveries(scope,created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS deliveries_turn_index ON deliveries(scope,turn_id,output_index,state);
      CREATE INDEX IF NOT EXISTS asset_scope_session_kind_created ON asset_index(scope,session,kind,created_at DESC,id DESC);`);
  // Existing inboxes predate direct commands. Only deferred rows need their timestamp for expiry.
  database.transaction(()=>{
    if(db.prepare("SELECT 1 FROM pragma_table_info('inbox') WHERE name='direct_image'").get())return;
    db.exec(`ALTER TABLE inbox ADD COLUMN received_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inbox ADD COLUMN direct_image INTEGER NOT NULL DEFAULT 0;
      UPDATE inbox SET received_at=json_extract(json,'$.timestamp') WHERE state='deferred'`);
  });
}
