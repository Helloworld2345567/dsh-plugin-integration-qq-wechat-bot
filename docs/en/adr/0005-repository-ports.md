# ADR 0005: Split Store Fully into Repository Ports

[简体中文](../../adr/0005-repository-ports.md) | English

## Status

Accepted (phase 6).

## Context

`src/core/store.ts` previously combined schemas, persona-file publishing, bindings, messages, delivery, statistics, automation, Profiles/acceptance/health, runtime ownership and generic records. Holding one Store granted every persistence capability:

- Arbitrary `store.get('kind')`, `store.db.prepare(...)` or generic `put` bypassed business semantics.
- Types did not reveal a service's actual persistence needs.
- Transactions spread across business code and could break during refactoring.
- Adapters, channels and Harness tools could access the database directly.

## Decision

1. Define narrow contracts in `src/core/ports/` for stable boundaries: bots, persona config, sessions/bindings, inbox, memory, assets/media jobs/quotas, delivery, automation, statistics, Profiles/state/acceptance/health, ownership, telemetry, evolution, workspace/history, cursors and interaction state.
2. Implement SQLite adapters in `src/infrastructure/sqlite/` and persona/workspace file adapters in `src/infrastructure/files/`. SQL, migrations, transactions and row mapping remain infrastructure-only.
3. Application services receive narrow ports through explicit `RuntimeRepositories`-style dependencies. `src/index.ts` is the sole composition root creating/injecting adapters.
4. `SqliteDatabase.transaction` / `savepoint` own transactions. Existing atomicity is preserved, not replaced by unguarded multiple writes.
5. The temporary `src/infrastructure/sqlite/store.ts` facade was removed. Contract/integration tests construct `SqlitePersistence` and use named repositories directly.
6. Architecture rules `sqlite-import`, `database-ownership`, `record-access`, `core-repository`, `channel-repository`, `harness-repository`, `client-repository` require both old Store facades to remain absent.

## Explicitly unchanged

- SQLite schemas, migration versions, tables, indexes and record meanings.
- Cursor encoding/filter fingerprints, revision/CAS, idempotency and deduplication.
- Error codes, delivery state machine, cancellation, permissions, V4 personas, media protocols, lifecycle and runtime directories.
- Public Harness behavior.

## Effects

- New persistence first needs a port contract, then an adapter, then composition-root injection. Business code cannot access records/SQL directly.
- `tests/repository-contract.test.ts` checks real temporary SQLite persistence/reopening, isolation, revision/CAS, cursors, rollback, delivery retry, immutable Profiles, acceptance binding and cross-bot deletion isolation.

## Rollback

Revert by commit: adapter extraction, service migration, and gates/docs are separate vertical slices/local commits. False-positive gates allow only precise file/responsibility exceptions, never directory-wide allowlists.
