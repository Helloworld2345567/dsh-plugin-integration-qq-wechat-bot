/**
 * Temporary compatibility shim during the Store/Repository split.
 *
 * The implementation lives in `src/infrastructure/sqlite/`.  Every production
 * module must import a narrow port from `./ports/*` instead of this module;
 * `check:architecture` enforces that, and this shim is deleted once the test
 * fixtures build their raw rows through the adapters.
 */
export {Store} from '../infrastructure/sqlite/store.js';
export {scopeKey} from './identity.js';
export {ConflictError} from './errors.js';
export {SqliteStatsProjection} from '../infrastructure/sqlite/stats-projection.js';
export type {PersistenceStage as StoreLifecycleStage} from '../infrastructure/sqlite/persistence.js';
