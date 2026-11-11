import {storageDescriptor} from '../../i18n/storage.js';
import {LocalizedError} from '../../core/errors.js';
import type {Asset} from '../../core/types.js';
import type {AssetRepository} from '../../core/ports/media.js';
import type {SqliteDatabase} from './database.js';

const indexSql = 'INSERT INTO asset_index VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,session=excluded.session,kind=excluded.kind,created_at=excluded.created_at,size=excluded.size';

/** Media assets: the immutable record plus its queryable usage index. */
export class SqliteAssetRepository implements AssetRepository {
  constructor(private readonly database: SqliteDatabase) {}
  saveAsset(asset: Asset): void {
    this.database.transaction(() => {
      this.database.records.put('asset', asset.id, asset);
      this.reindex(asset);
    });
  }
  reindex(asset: Asset): void {
    this.database.db.prepare(indexSql).run(asset.id, asset.scopeKey, asset.sessionId ?? null, asset.kind, asset.createdAt, asset.size);
  }
  findAsset(id: string): Asset | undefined {return this.database.records.get<Asset>('asset', id);}
  asset(scope: string, id: string): Asset {
    const asset = this.findAsset(id);
    if (!asset || asset.scopeKey !== scope) throw new LocalizedError(storageDescriptor('assetNotOwned'),'附件不存在或不属于当前会话');
    return asset;
  }
  recentAssets(scope: string, sessionId: string, kind?: string, limit = 24): Asset[] {
    const rows = this.database.db.prepare(`SELECT a.id,r.json FROM asset_index a JOIN records r ON r.kind='asset' AND r.id=a.id WHERE a.scope=? AND a.session=?${kind ? ' AND a.kind=?' : ''} AND a.created_at>? ORDER BY a.created_at DESC,a.id DESC LIMIT ?`).all(scope, sessionId, ...(kind ? [kind] : []), Date.now() - 600000, limit) as {id:string;json:string}[];
    const result: Asset[] = [];
    for (const row of rows) {
      const asset = JSON.parse(row.json) as Asset;
      if (asset.scopeKey !== scope || asset.sessionId !== sessionId || kind && asset.kind !== kind) {this.reindex(asset); continue;}
      result.push(asset);
    }
    return result;
  }
  deleteAsset(scope: string, id: string): void {
    this.database.transaction(() => {
      this.database.db.prepare('DELETE FROM asset_index WHERE id=? AND scope=?').run(id, scope);
      this.database.db.prepare("DELETE FROM records WHERE kind='asset' AND id=?").run(id);
    });
  }
  allAssets(): Asset[] {return this.database.records.list<Asset>('asset');}
  countAssets(): number {return this.database.records.count('asset');}
  deleteScope(scope: string): void {this.database.db.prepare('DELETE FROM asset_index WHERE scope=?').run(scope);}
  bumpCollection(): void {this.database.bump('assets');}
}
