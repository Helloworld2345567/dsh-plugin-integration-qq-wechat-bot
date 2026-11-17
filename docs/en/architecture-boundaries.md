# Architecture boundaries and extensions

[简体中文](../architecture-boundaries.md) | English

This page defines source responsibilities and dependencies. See [architecture](architecture.md) for behavior and [repository responsibilities](repository-responsibility-matrix.md) for persistence. Run `npm run check:architecture` after production-module changes; fix ownership/dependencies identified by rule IDs instead of widening allowlists.

## Module responsibilities

| Location | Responsibility and allowed dependencies |
| --- | --- |
| `src/index.ts` | Composition root: create adapters, inject ports, register entries/lifecycle; cross layers only for wiring |
| `src/core/` | Platform-neutral types, policies and application services; internal modules, Node, declared dependencies and neutral lifecycle contracts |
| `src/core/ports/` | Narrow business interfaces and typed requests; no SQL, database handles or generic record kinds |
| `src/infrastructure/` | Implements core ports and owns persistence/file I/O |
| `src/infrastructure/sqlite/` | Sole SQLite connection, schema/migrations, transactions and repository implementations |
| `src/infrastructure/files/` | Persona/workspace files and journals |
| `src/channels/` | Platform protocols, authorization, sending/receiving and formats; core channel contracts/pure policies only |
| `src/harness/` | Harness services, tools, admin API, controlled processes and workers; core contracts/application services |
| `src/client/` | Browser panel; admin API, client modules and pure types from `src/core/client-contracts.ts` |
| `src/i18n/` | Shared pure language resources without I/O, UI state or server implementations |
| `packages/bot-lifecycle/src/` | Independent coordinator, upgrade/drain/rollback and bundle entry; no root `src/` imports |
| `packages/bot-lifecycle/src/contract/` | Single shared source for serialized protocols, artifact identity, journals and integrity contracts |
| `python/` | Media/service workers; reusable code only in `python/dsh_bot_runtime/`, root scripts are thin CLIs |
| `skills/` | Instructions, references, catalog and operation declarations; no Python implementation |
| `scripts/` | Explicit development/build/install/test commands, not business implementations |
| `tests/` | Tests and fixtures, never production dependencies |

The `src/index.ts` wiring exception does not extend to other modules or reusable business logic. Core must not import client, concrete channel, Harness or coordinator implementations; use ports. Client must not import Node, databases or server runtimes. Production must not depend on tests, fixtures or temporary directories.

Only `src/infrastructure/sqlite/` imports `node:sqlite`; only infrastructure holds database handles, prepares SQL or accesses raw records. Business code depends on ports, not repository implementations. Do not restore removed `src/core/store.ts`, `src/infrastructure/sqlite/store.ts` or `src/lifecycle/` as compatibility facades.

## Cross-layer data contracts

- Channel identity owns sessions, attachments, memories and outputs. Models cannot supply trusted identity, scope, local paths or platform targets.
- Jobs freeze configuration and Profile revisions. Queue, execution, output registration and delivery still check cancellation, current permissions and session generation.
- Private Profiles, credentials, endpoints and weight paths stay out of public persona projections and cross-layer errors. Return stable categories and sanitized diagnostics.
- Only V4 personas are supported; V3 is not read, migrated or used as fallback. Unregistered capabilities remain `missing`/`blocked`, without silent substitution.
- Unknown submission results are not replayed automatically; recovery retains job, Asset and delivery identities.
- Service Adapters receive frozen jobs, controlled inputs and assigned directories. They do not own Store, Session, channel identity, delivery or Harness Context. The internal interface is not a third-party ABI commitment.

## Extension steps

| Addition | Implementation and boundary |
| --- | --- |
| Channel | Implement `ChannelAdapter` in `src/channels/` and register at composition root; keep platform protocols out of core |
| Repository | Define a narrow scope/identity-aware port in `src/core/ports/`, implement/compose in infrastructure, preserving atomicity and recovery |
| Admin API | Validate contracts in `src/harness/admin-contract.ts`, implement in `admin.ts`; client consumes public DTOs |
| Service Adapter | Define pure core contracts and inject processes from Harness/composition root; host validates/registers output handles |
| Skill | Update catalog, `operations.json` and instructions, implement fixed entries in `dsh_bot_runtime/skills/`, regenerate registries |
| Lifecycle capability | Update independent package contracts/coordinator and native tests; use narrow drain/resume ports and reject incompatible versions |

Python imports use full `dsh_bot_runtime...` names or explicit relative imports. Do not modify `sys.path`, create modules from arbitrary paths or accept model-provided entries. The host sets a trusted root and starts `-P -m`, without inheriting caller `PYTHONPATH`. Imports must not start networks, threads, subprocesses, servers or databases, write files or edit profiles. Use explicit `main`/`execute` entry points.

Repository extensions verify persistence, isolation, revision/CAS, cursors and transaction rollback against real temporary SQLite. Lifecycle owns its build and prepack rejects stale dist; do not copy protocols, identity or hash algorithms into the main package. See [ADR 0004](adr/0004-lifecycle-bundle-compatibility.md) for bundle design and [ADR 0005](adr/0005-repository-ports.md) for repositories.

## Static gate

`npm run check:architecture` reads current source without fixed module counts or manual inventory snapshots. It checks TypeScript runtime cycles, cross-layer imports/exports/dynamic imports, SQLite ownership, production/test boundaries, Python namespaces/import effects, package entries, shared contracts and release layout.

Use `node scripts/check-architecture.mjs --inventory` for a module inventory. Output contains repository-relative paths only: `status: PASS` on success, rule IDs/files/targets on failure. It does not replace runtime tests, platform delivery or external model acceptance.
