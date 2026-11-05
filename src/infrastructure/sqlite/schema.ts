import type {SqliteDatabase} from './database.js';

/**
 * Schema bootstrap and in-place migrations.
 *
 * The DDL, index set and legacy backfills are byte-for-byte the same statements
 * this package has always executed at open time.  Repository extraction must
 * never change a table, an index or a stored value.
 */
export function initializeSchema(database: SqliteDatabase): void {
  const db = database.db;
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS inbox(scope TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,scope TEXT NOT NULL,json TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL DEFAULT 0,bot_id TEXT NOT NULL DEFAULT '',turn_id TEXT NOT NULL DEFAULT '',output_index INTEGER NOT NULL DEFAULT 0,UNIQUE(scope,id));
      CREATE TABLE IF NOT EXISTS memory(scope TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,source TEXT NOT NULL,quote TEXT NOT NULL,version INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL,PRIMARY KEY(scope,key));
      CREATE TABLE IF NOT EXISTS forgotten(scope TEXT NOT NULL,source TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(scope,source,key));
      CREATE TABLE IF NOT EXISTS memory_sources(scope TEXT NOT NULL,key TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(scope,key,source));
      CREATE TABLE IF NOT EXISTS asset_index(id TEXT PRIMARY KEY,scope TEXT NOT NULL,session TEXT,kind TEXT NOT NULL,created_at INTEGER NOT NULL,size INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS collection_revisions(name TEXT PRIMARY KEY,revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS inbox_scope_state ON inbox(scope,state);
      CREATE INDEX IF NOT EXISTS records_kind_id ON records(kind,id);
      CREATE INDEX IF NOT EXISTS records_stats_native_session ON records(kind, json_extract(json,'$.sessionId')) WHERE kind='stats-native';
      CREATE INDEX IF NOT EXISTS records_stats_auxiliary_session ON records(kind, json_extract(json,'$.sessionId')) WHERE kind='stats-auxiliary';`);
  const deliveryColumns = new Set((db.prepare('PRAGMA table_info(deliveries)').all() as {name:string}[]).map(row => row.name));
  for (const [name, sql] of [['created_at', 'INTEGER NOT NULL DEFAULT 0'], ['bot_id', "TEXT NOT NULL DEFAULT ''"], ['turn_id', "TEXT NOT NULL DEFAULT ''"], ['output_index', 'INTEGER NOT NULL DEFAULT 0']] as const) if (!deliveryColumns.has(name)) db.exec(`ALTER TABLE deliveries ADD COLUMN ${name} ${sql}`);
  for (const row of db.prepare("SELECT id,json FROM deliveries WHERE created_at=0 OR bot_id='' OR turn_id=''").all() as {id:string;json:string}[]) {
    try {
      const delivery = JSON.parse(row.json) as {createdAt?:number;botId?:string;turnId?:string;index?:number};
      db.prepare('UPDATE deliveries SET created_at=?,bot_id=?,turn_id=?,output_index=? WHERE id=?').run(delivery.createdAt ?? 0, delivery.botId ?? '', delivery.turnId ?? '', delivery.index ?? 0, row.id);
    } catch {/* Invalid legacy rows remain at the deterministic tail. */}
  }
  db.exec('CREATE INDEX IF NOT EXISTS deliveries_state_scope ON deliveries(state,scope);CREATE INDEX IF NOT EXISTS deliveries_scope_state_id ON deliveries(scope,state,id);CREATE INDEX IF NOT EXISTS deliveries_bot_state_created ON deliveries(bot_id,state,created_at DESC,id DESC);CREATE INDEX IF NOT EXISTS deliveries_scope_created ON deliveries(scope,created_at DESC,id DESC);CREATE INDEX IF NOT EXISTS deliveries_turn_index ON deliveries(scope,turn_id,output_index,state);CREATE INDEX IF NOT EXISTS asset_scope_session_kind_created ON asset_index(scope,session,kind,created_at DESC,id DESC);');
  for (const row of db.prepare("SELECT id,json FROM records WHERE kind='asset'").all() as {id:string;json:string}[]) {
    try {
      const asset = JSON.parse(row.json) as {id:string;scopeKey:string;sessionId?:string;kind:string;createdAt:number;size:number};
      db.prepare('INSERT INTO asset_index VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,session=excluded.session,kind=excluded.kind,created_at=excluded.created_at,size=excluded.size').run(asset.id, asset.scopeKey, asset.sessionId ?? null, asset.kind, asset.createdAt, asset.size);
    } catch {/* Invalid legacy metadata remains inaccessible. */}
  }
}
