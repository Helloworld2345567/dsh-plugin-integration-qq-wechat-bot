# Static Architecture Boundaries and Maintainer Contract

[简体中文](../architecture-boundaries.md) | English

This makes existing runtime boundaries executable. It defines dependency directions without changing QQ/WeChat business behavior, databases, permissions, credentials, media, personas or lifecycle semantics. Run `npm run check:architecture` after production-module changes; the release gate runs the same check.

## Module responsibilities

| Module | Sole responsibility | Does not own |
| --- | --- | --- |
| `src/index.ts` | **Composition root:** open persistence, create adapters/ports, inject services and connect lifecycle | Reusable business rules; exception is assembly-only |
| `src/core/` | Platform-independent domain types, policies, services and port contracts | Browser UI, QQ/WeChat protocols, Harness Context, coordinator, SQLite implementation |
| `src/core/ports/` | Narrow application-visible contracts with fixed semantics, typed requests and CAS/revisions | DB handles, SQL, generic record kinds, sending/model calls |
| `src/infrastructure/` | Sole SQLite/file persistence implementation boundary | Business rules, permissions or sending |
| `src/infrastructure/sqlite/` | Connection, schemas/migrations, transactions, row mapping, aggregate adapters | Direct business-layer imports or rules |
| `src/infrastructure/files/` | Persona drafts, workspace history and file journals | DB records or business decisions |
| `src/channels/` | QQ/WeChat protocol, login, receive/send and format adaptation | Harness admin APIs, persona rules, repositories/SQLite |
| `src/harness/` | Harness integration, admin API, tool registration, Node process/worker ports | Browser rendering, channel business rules, SQL/repository implementations |
| `src/client/` | Browser management UI using API and shared pure types | Node built-ins, SQLite, channels, server Harness or repositories |
| `src/i18n/` | Pure shared resources, message descriptors and formatting | Node I/O, storage, channels, Harness Context or UI state |
| `packages/bot-lifecycle/src/` | Standalone upgrades, drain, recovery, rollback, entry and independent build | Root src, messaging, personas or business repositories |
| `packages/bot-lifecycle/src/contract/` | Single shared serializable protocol, artifact identity, journals and source integrity | Store/Runtime/channels/delivery/personas/admin implementations |
| `packages/bot-lifecycle/` | Independently installable lifecycle source, build scripts and artifacts | Main-plugin/channel internals |
| `python/` | Workers, controlled service entries and shared runtime | Host identity, permissions or delivery decisions |
| `skills/` | Skill declarations and controlled entries | Store, credentials or platform sending |
| `scripts/` | Development/build/install/test/release helpers | Business code implicitly imported by src runtime |
| `tests/` | Tests, fixtures and contracts, never production dependencies | Release runtime entries |

## Allowed dependency directions

Arrows mean the left side may depend on the right. Unlisted cross-layer directions are prohibited by default.

```text
src/client       -> browser API, src/core/client-contracts.ts (type-only)
client/core/harness -> src/i18n (pure resources; no reverse imports)
src/channels     -> core channel contracts, pure policies and ports
src/harness      -> core contracts, services and ports
packages/bot-lifecycle/src -> same-package contracts, Node, Cordis Plugin Manager types
src/core         -> Node, declared dependencies, core modules/ports, neutral lifecycle contract
src/core/ports   -> core domain/service types (type-only)
src/infrastructure -> core ports/domain types, Node (sole SQLite/file persistence)
src/index.ts     -> core + infrastructure + channels + harness + neutral lifecycle port
scripts          -> pure script helpers; CLI explicitly invokes side effects
Python skills    -> shared Python modules and vendored namespace
```

| Caller | May depend on | Rule |
| --- | --- | --- |
| client | client, browser contracts | Server DTOs are low-level pure types, not implementations |
| core | core, ports | Concrete processes/network/Harness/persistence are injected |
| ports | Domain/service types | Only business-needed contracts, no DB handles/SQL |
| infrastructure | ports, domain types | Implements ports; SQL/migrations/transactions/mapping stay here |
| channels | core | Public channel contracts; platform protocol remains adapter-owned |
| harness | core, ports | Connects Harness and implements ports, not persistence |
| lifecycle | lifecycle contracts | Health/drain/resume/artifact identity only |
| composition root | All production layers | Construction, effects and connections only |

### Limited composition-root exception

`src/index.ts` can import core/channels/harness/lifecycle for assembly. This exception is not transitive: being eventually imported by index does not permit reverse dependencies elsewhere. The root cannot contain reusable channel branches, permission decisions or sending rules.

## Prohibited directions

- Client imports no Node-only module, SQLite, channels, server Harness, coordinator or server core implementation.
- Core imports no client, concrete channel, Harness implementation or coordinator; only neutral versioned lifecycle contracts are allowed.
- Lifecycle cannot cross relative paths into root src or depend on QQ/WeChat, real sending, delivery queues, Store, Runtime, channels or personas.
- Service Adapters do not own/import Store, Session, channel identity, delivery or host DB. They receive validated frozen jobs/Profiles, cancellation and controlled ports.
- Channels cannot bypass public core contracts into DB/Harness internals. Composition explicitly injects format-preparation ports.
- Production imports no tests, fixtures, `.codex` or `.runtime`; helpers/runners/evidence never become hidden runtime dependencies.
- Only SQLite infrastructure imports `node:sqlite`/references `DatabaseSync`; SQL, generic records and DB handles remain infrastructure-only.
- Business layers cannot import repository implementations/infrastructure, only narrow ports.
- Deleted `src/core/store.ts` and `src/infrastructure/sqlite/store.ts` facades must remain absent. Applications/tests construct `SqlitePersistence` and named repositories.
- Adapters/channels/lifecycle cannot import business repositories; Harness tools/admin cannot execute SQL.
- Lifecycle cannot import root internals by escaping relative paths; published entries come from declared builds.
- Python import cannot connect services, listen, launch long-lived processes, alter profiles or write runtime data; use explicit main/start/execute.

## Repository responsibilities

Each boundary exposes only needed application methods through ports, implemented by SQLite/file adapters. Contracts expose no DatabaseSync, SQL statements, generic get/list/put or caller-built record kinds.

| Boundary | Port | Adapter | Invariants | Preserved errors/tests |
| --- | --- | --- | --- | --- |
| Bot/persona | BotRepository, PersonaConfigRepository | bot-repository.ts, persona-repository.ts, files/persona-files.ts | Immutable channel identity, increasing revision, file journal before SQLite commit | Missing/archived config, ConflictError, missing bot; personas/core |
| Session/binding/generation | SessionRepository, BindingRepository | session-repository.ts | Binding/session written together; reset increments generation; unforgeable ownership | SESSION_OWNERSHIP_MISMATCH, missing/nonowned session; repository-contract |
| Inbox | InboxRepository | inbox-repository.ts | Idempotent (scope,id), explicit processor transitions | Inbound validation; core/processing-failures |
| Memory | MemoryRepository | memory-repository.ts | Verbatim user-sourced memory; deletion tombstones | Invalid length, ConflictError; core |
| Asset/job/quota | AssetRepository, MediaJobRepository, MediaQuotaRepository | asset-repository.ts, media-job-repository.ts | Atomic asset/index; quota check then increment | MEDIA_DAILY_LIMIT, missing/nonowned attachment; media-assets/media-quota |
| Delivery/recovery | DeliveryRepository, DeliveryQueueRepository | delivery-repository.ts | Turn output index order, no unknown replay, retry reuses intent | PROGRESS_DELIVERY_EXPIRED; repository-contract/delivery-worker |
| Automation/proactive | AutomationRepository | automation-repository.ts | Definitions separate from runs; disabling stops triggers | SCHEDULE_*, PROACTIVE_*; automation |
| Stats/projections | StatsDataPort, StatsProjectionRepository, StatsSessionRepository | stats-data.ts, stats-projection.ts, stats-session-repository.ts | Facts unchanged, projections rebuildable, missing stays unknown | stats |
| Profile/acceptance/health/fence | ProfileRepository, CapabilityAcceptanceRepository, ServiceHealthRepository, ServiceStateRepository | profile-repository.ts, capability-repository.ts, service-state-repository.ts | Immutable revision/hash; acceptance binds persona/Profile revisions; fences require explicit operator recovery | PROFILE_REVISION_IMMUTABLE, PROFILE_CONTENT_HASH_MISMATCH; service-contract/service-management |
| Evolution/journals | EvolutionRepository | evolution-repository.ts | Candidate separate from install baseline; separate journal | LIFECYCLE_*; evolution |
| Runtime ownership | RuntimeOwnershipRepository, RuntimeLifecyclePort | runtime-ownership-repository.ts, persistence.ts | One consumer per data directory; deterministic recovery | Active consumer, STORE_CLOSED; phase5/lifecycle |
| Telemetry/actions | TurnMetricRepository, TurnSnapshotRepository, FailureRepository, SessionActionRepository | telemetry-repositories.ts | Immutable metric ownership; deferred actions advance only via queue | TURN_METRIC_*; session-actions/processing-failures |
| Workspace/history | HistoryLocationRepository, ChatHistoryPort, BotHistoryPort, WorkspacePort | files/workspace-files.ts, bot-history.ts, session-state-repositories.ts | Identity-derived paths; deletion affects that bot only | BOT_HISTORY_PATH_INVALID, SESSION_NOT_FOUND; workspace-storage/bot-history |
| Channel cursors/replies | CursorStore in channel-ports.ts, delivery reply sequence | channel-cursor-repository.ts, delivery-repository.ts | Dual legacy/new cursor writes; monotonic QQ sequence | Cursor compatibility |
| Music/singing/library state | MusicStateRepository, SingingStateRepository, VoiceLibrarySettingsRepository | session-state-repositories.ts | Generation-bound; explicit null clears | *_SESSION_CHANGED; music-host/singing-host |

Human error descriptions above are translated explanations, not machine-code renames. See the [full matrix](repository-responsibility-matrix.md) for callers, keys and recovery.

### Transactions and Unit of Work

- SqlitePersistence opens one connection; UnitOfWork.transaction owns multi-step atomicity, with savepoints for composition inside existing transactions (for example enqueue).
- Preserve atomic bot create/delete; persona publication; session reset/restore/delete; asset registration/rollback; delivery intent/attempt/state/retry; automation create/execute; Profile/acceptance/health fences; cross-aggregate bot cleanup; lifecycle/evolution journal updates.
- Never split one transaction into unguarded writes; nested work uses explicit savepoints or the outer transaction.
- Existing methods without CAS retain their concurrency behavior; change it separately only with concrete bug evidence.

### Add persistence

1. Add a narrow port with explicit identity/scope and typed page requests/cursors.
2. Implement SQLite/file adapter with centralized SQL/mapping/transactions, reusing existing schema.
3. Compose in persistence.ts and expose a narrow repository; extend the bundle only for new aggregates.
4. Inject the port, not SqlitePersistence, Store or DB handles.
5. Add real temporary-SQLite contract coverage for reopening, isolation, cursor, CAS, rollback and recovery.
6. Run `npm run check:architecture && npm run typecheck && npm test`; gates reject illegal imports/SQL.

## Boundary data rules

1. Channel identity owns sessions/assets/memory/output; ownership cannot cross channels/bots.
2. Model input is never trusted identity/scope/path/private Profile path/platform target.
3. Credentials use Harness credentials or short-lived injection, never personas/logs/errors/public projections.
4. Personas accept schemaVersion 4 only; no V3 reading, migration or fallback.
5. Private Profile paths/endpoints/credentials stay private; jobs freeze revision/hash.
6. Recheck cancellation, authorization, Profile revision and generation at queue/execution/registration/delivery boundaries.
7. Cross-layer errors contain stable categories/sanitized diagnostics, not endpoints, paths, credentials, locators or traces.
8. Unknown post-submission outcomes never replay automatically; recovery reuses job/Asset identity.

## Extension rules

### Add a channel

Implement the core ChannelAdapter in channels and register at composition root. Core additions must be platform-independent contracts/policies, never `if (channel === 'qq')` business branches. Preserve ownership, permissions, credential model and other adapters.

### Add a Service Adapter

Define pure job/Profile/result/port contracts in core; inject processes/workers from Harness/composition. Adapters access only assigned input handles/job directories/frozen revisions and return relative output handles for host validation. No Store, Session, channels, delivery, persona files or Harness Context; no third-party ABI commitment.

### Add a management API

Define/validate contracts in admin-contract and implement in admin. Client consumes public API projections, never server/storage implementations. Writes preserve revision, authorization and generation checks.

### Add a Python worker

- Reusable implementation belongs only to python/dsh_bot_runtime; root Python files are approved thin shims and skills contain no Python.
- Use package-qualified or explicit relative imports; no sys.path/PYTHONPATH mutation, bare internal basenames or file-derived module keys.
- Imports perform no network/server/timer/thread/child/SQLite/filesystem/profile side effects. Use main/execute and main guards for persistent work.
- Host sets minimal fixed-root PYTHONPATH and uses `-P -m`, without inheriting caller paths or guessing from cwd.
- Models cannot supply module/script/package/trusted-resource paths or credential storage locations; errors cross layers as stable sanitized codes only.

### Add a skill

Edit operations.json/documentation and implement the controlled entry in `python/dsh_bot_runtime/skills/<skill_name>/`, loaded by the existing registry. No Store, identities, profiles or real delivery access; missing capability remains missing/blocked.

### Add lifecycle behavior

Change only contracts, coordinator, independent bundle and native tests. No business sending/login/persona/media calls; drain/resume use narrow ports. Protocol/combination changes fail closed and need explicit migration rather than silent semantic changes.

## Capability boundaries

- Chinese/English are supported; shared language resources are pure and introduce no reverse client/core dependency. UI/system-message languages are independent.
- Internal Service Adapter interfaces are not a third-party ABI promise.
- No V3 persona migration/rollback commitment.
- No external QQ/WeChat/model/Music/RVC/GPT-SoVITS/service acceptance commitment.
- Missing/blocked stays explicit without silent substitutes.
- Benchmarks describe controlled measurements, not latency/throughput guarantees.

## Dependency inventory and audit baseline

check-architecture uses TypeScript parsing/Node to derive `src/**/*.ts`, `packages/**/*.{ts,mjs,js}`, `scripts/*.mjs` dependencies: imports, export-from and literal dynamic imports. Unknown dynamic targets fail with relative file/line, never guessed, preventing variable import/require bypasses. Python audit covers absolute/relative imports in python/skills and rejects path mutations, bare internals, file-generated module keys, skill copies and unguarded CLIs.

Initial phase-5 baseline: 115 production TypeScript modules, 30 Python/skill modules, 541 runtime imports and 286 Python imports. Counts evolve with lifecycle contracts/build scripts and are recomputed, not thresholds. No runtime cycle, unknown dynamic target or import-time server/database/child startup was found.

| Layer | Direct targets | Conclusion |
| --- | --- | --- |
| Composition root | core/channels/harness/lifecycle protocol | Legal nontransitive assembly exception |
| client | client, client-contracts | Type-only server surface; no Node/SQLite/server runtime |
| core | core, Node, declared dependencies | No reverse client/channel/Harness/coordinator imports |
| channels | Core channel contracts/policies, platform dependencies | No Store/delivery/Harness implementation |
| harness | Core contracts/services, Harness packages | Process/worker/credentials/admin implementation boundary |
| lifecycle src | Same-package coordinator/integrity/protocol/entry/contracts | No root src or messaging/persona/delivery |
| scripts | Script helpers, Node/build packages | runtime.mjs imports are read-only; start/install explicitly prepare directories |
| Python/skills | Standard/declarative dependencies, one namespace; skills declarations/docs | Explicit import inventory; build-time host registry; lazy Python manifests |

The audited layers are composition → Harness/channel/lifecycle adapters → core contracts/services → controlled Node/Python resources. Exceptions are only composition and neutral lifecycle contracts. Previously unenforced client/server, core-reverse, production/test, cycle, package and entry constraints now run in the gate.

### Evidenced behavior-preserving fixes

- Core adapters previously imported Harness process/worker implementations; lower-layer contracts now receive composition-injected implementations.
- Browser types formerly came from multiple server files; they now use the client-contracts type-only surface.
- runtime.mjs used to create directories at import; it now parses configuration purely, with explicit preparation and read-only stop.
- Worker used to scan all manifests on import; it now waits until first operation and classifies import failures without changing routing.
- Installer/bootstrap duplicated atomic-JSON code without retry/finally cleanup; shared durable-json preserves the separate synchronous lifecycle journal and tests transient Windows locks/cleanup.
- Both source snapshots omitted optional/CI requirements; they now include all requirements with consistency tests.
- Fixed-file text tests missed new modules/export-from/dynamic imports/cycles; a whole-tree AST graph closes that gap.

### Separate semantic work

External ABI still needs its own design. Python skills moved into dsh_bot_runtime as separate remediation. ADR 0004 separately moved lifecycle source into its package and established explicit paired compatibility; this is not an implicit phase-5 exception. ADR 0005 completed repository separation without schema/migration/cursor/code/delivery/permission/generation/cancellation/lifecycle changes.

## Repository separation results (ADR 0005)

- Schemas, migration versions, tables/indexes/records, cursors, codes and runtime directories remain unchanged; only ownership/directions changed.
- The monolithic Store became aggregate SQLite adapters; business code no longer holds Store/DB handles.
- The transitional facade is gone. Tests construct SqlitePersistence and named repositories; only explicit legacy/fault fixtures touch raw records.
- sqlite-import, database-ownership, record-access and core/channel/harness/client-repository rules forbid both former facade paths, with exact composition/infrastructure exceptions only.

## Gate output

`npm run check:architecture` is read-only/offline. `node scripts/check-architecture.mjs --inventory` provides relative module inventories. Success is `"status": "PASS"`; failures contain stable rule IDs, relative paths and targets, not local absolute paths. It checks:

- No production TypeScript runtime cycles.
- Client/core/channel/lifecycle/Adapter/production-test/package boundaries.
- SQLite/generic-record ownership and SQL/DB confinement.
- No business repository/infrastructure/facade imports; composition exception stays local.
- Python inventory, namespace, internal resolution, fixed entries and import-time side effects.
- No spread of composition exceptions.
- Main exports and three build entries, with lifecycle built by its own script/source.
- No lifecycle path escape or revived src/lifecycle; one shared contract source.
- Versioned main/coordinator contracts and subpackage exports/files/dist.
- Declared directories match the repository without allowlists hiding violations.
