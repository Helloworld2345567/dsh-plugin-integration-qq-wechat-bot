# Repository responsibilities and recovery

[简体中文](../cn/repository-responsibility-matrix.md) | English

Application services depend on narrow `src/core/ports/` interfaces. SQLite/file implementations live under `src/infrastructure/`. See [architecture boundaries](architecture-boundaries.md). This page records business constraints; ports, adapters and tests own exact methods, tables and error codes.

## Responsibilities

| Boundary | Main ports | Preserved constraints |
| --- | --- | --- |
| Bot / persona | `BotRepository`, `PersonaConfigRepository` | Bot/channel-account ownership; monotonic persona revisions and expectedRevision checks; file journal and active version consistency |
| Sessions / bindings | `SessionRepository`, `BindingRepository` | Scope ownership; atomic binding/session updates; reset/activate advance generation; cursors bind filters and collection revision |
| Inbox / memory | `InboxRepository`, `MemoryRepository` | Scope/message-ID inbox idempotency; version CAS for memory correction; forget tombstones prevent stale-source resurrection |
| Assets / media jobs | `AssetRepository`, `MediaJobRepository` | Asset/index writes in one transaction; explicit scope/source-session/path ownership; durable job state |
| Delivery | `DeliveryRepository`, `DeliveryQueueRepository` | QQ reply sequence numbers and delivery records are written in one transaction. Retries reuse the original record and sequence. Unknown outcomes require operator confirmation |
| Automation | `AutomationRepository` | Schedules/proactive settings and runs belong to scope/bot; restart reloads enabled schedules and preserves interrupted runs |
| Statistics | `StatsDataPort`, `StatsProjectionRepository`, `StatsSessionRepository` | Idempotent facts, rebuildable projections; missing evidence remains unknown |
| Managed services | `ProfileRepository`, `CapabilityAcceptanceRepository`, `ServiceHealthRepository`, `ServiceStateRepository` | Immutable Profile revisions, configuration/resource content hashes, revision-bound acceptance and durable health/fence/jobs |
| Runtime / diagnostics | `RuntimeOwnershipRepository`, `EvolutionRepository`, telemetry ports | Exclusive data-directory ownership, durable evolution phases, immutable metric ownership and explicit session-action states |
| Workspace / history | `HistoryLocationRepository`, `ChatHistoryPort`, `BotHistoryPort`, `WorkspacePort` | Identity-derived paths; atomic on-demand history exports; deletion only touches owned bot/session files |
| Channel / interaction state | `CursorStore`, `MusicStateRepository`, `SingingStateRepository`, `VoiceLibrarySettingsRepository` | Channel/bot cursor isolation; music/singing candidates bind scope and session generation, without cross-session reuse |

Raw `records` has no public business port. Owning infrastructure adapters control kinds and access; legacy/fault-injection tests use `tests/sqlite-fixtures.ts`.

## Transactions and conflicts

`SqlitePersistence` owns one connection. `UnitOfWork.transaction` provides multi-step atomicity; nested composite writes use savepoints or the outer transaction. Refactoring must not split atomic operations into independent commits. File journals and database commits follow each adapter's recovery sequence; SQLite rollback does not cover file I/O.

New ports require explicit scope/identity and typed pagination requests/cursors. Preserve revision/CAS and existing error categories, including `ConflictError`, `SESSION_OWNERSHIP_MISMATCH`, `PAGE_CURSOR_MISMATCH`, `PAGE_STALE`, `PAGE_CURSOR_INVALID` and Profile revision/content-hash errors. Explain schema or compatibility changes separately instead of hiding them in responsibility changes.

## Startup recovery

| Persisted state | Recovery |
| --- | --- |
| Inbox `processing` | Mark `interrupted` |
| Delivery `sending` | Mark `unknown`, without automatic replay |
| Pending progress notice | Mark `cancelled`, without stale delivery |
| Media job running/queued | Mark `interrupted`; directory cleanup respects ownership and live processes |
| Session action running | Mark `interrupted` |
| Persona file journal | Recover journal before reading active configuration |
| Service fence / job | Preserve until service state is resolved and recovery is explicit |

Retention must preserve records required by queued, sending or unresolved operations. See [session/workspace cleanup](architecture.md#sessions-workspaces-and-cleanup) for deletion boundaries.

## Verification

`npm run check:architecture` checks SQL/repository ownership. `tests/repository-contract.test.ts` uses real temporary SQLite for reopen persistence, isolation, CAS, cursors, rollback and recovery. Related business tests cover each boundary; `npm run verify:release` runs the complete source release gate.
