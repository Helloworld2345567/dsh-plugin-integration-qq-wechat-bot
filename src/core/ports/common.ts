/**
 * Shared application-facing persistence contracts.
 *
 * These interfaces are the only persistence surface an application service may
 * depend on.  They never expose a database handle, raw SQL, a record kind or a
 * generic get/list/put operation.
 */
export interface Page<T> {
  items: readonly T[];
  nextCursor: string | null;
  revision: string;
}

/** Explicit transaction boundary.  Adapters join the caller's transaction. */
export interface UnitOfWork {
  transaction<T>(fn: () => T): T;
}

/** Durable storage location owned by the composition root. */
export interface StorageLocation {
  readonly home: string;
}
