import type {RuntimeOwnershipRepository} from '../../core/ports/runtime.js';
import type {SqliteDatabase} from './database.js';
import {localizedError} from '../../core/errors.js';

/** Exclusive runtime data directory ownership across Harness consumer instances. */
export class SqliteRuntimeOwnershipRepository implements RuntimeOwnershipRepository {
  constructor(private readonly database: SqliteDatabase) {}
  claim(owner: string): void {
    this.database.transaction(() => {
      const previous = this.database.records.get<{owner:string;pid:number}>('runtime', 'owner');
      if (previous) {
        let alive = true;
        try { process.kill(previous.pid, 0); }
        catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
        if (alive) throw localizedError('runtimeOwnerActive');
      }
      this.database.records.put('runtime', 'owner', {owner, pid:process.pid});
    });
  }
  release(owner: string): void {
    this.database.transaction(() => {
      if (this.database.records.get<{owner:string}>('runtime', 'owner')?.owner === owner) this.database.records.delete('runtime', 'owner');
    });
  }
}
