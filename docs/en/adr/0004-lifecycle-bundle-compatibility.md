# ADR 0004: Versioned Compatibility Between Main Plugin and Lifecycle Coordinator

[简体中文](../../adr/0004-lifecycle-bundle-compatibility.md) | English

- Status: Accepted
- Date: 2026-11-04

## Context

The coordinator can drain/replace the main plugin but owns the replacement transaction, Plugin Manager calls, rollback and supervised restart. It cannot hot-replace itself during that transaction. The older integer handshake did not bind main-package version, coordinator API, compatibility ranges, capabilities and paired artifact identities. Arbitrary old/new combinations must not run by guesswork.

## Decision

### 1. Three independent versions

- **Bundle/package version:** npm artifact identity; main is currently `0.2.x`, coordinator has its own version.
- **Runtime protocol:** main plugin's serializable handshake, `major.minor.patch`. Different majors are incompatible; an explicit coordinator range determines accepted minor/patch versions.
- **Coordinator API:** drain, health, hot replacement and supervision API, also `major.minor.patch`; the main plugin explicitly declares its accepted range.

Internal TypeScript interfaces are not the public protocol. Machines read `dshLifecycle` in both package manifests and serializable runtime fields only.

### 2. Bidirectional declarations

Main declares `schemaVersion`, `role: main`, `runtimeProtocol`, `coordinatorApiRange`, its capabilities and required coordinator capabilities.

Coordinator declares `schemaVersion`, `role: coordinator`, `coordinatorApi`, `runtimeProtocolRange`, `mainPackageRange`, its capabilities and required main capabilities.

Ranges permit statically interpretable `=`, `<`, `<=`, `>`, `>=` against numeric three-part versions only; no `*`, tags or implicit inference.

### 3. Handshake, capabilities and instance identity

The handshake includes protocol name, contract schema, role, package name/version, runtime protocol or coordinator API, ranges, capabilities, required capabilities, launcher-process instance nonce and loaded artifact identity. Both directions must match; every required capability must exist and instances must be identical. Coordinator unload immediately makes `active` false.

Missing fields, forged structure, unsatisfied ranges, missing capabilities and instance/artifact mismatches fail closed. Stable errors include:

- `LIFECYCLE_METADATA_MISSING`
- `LIFECYCLE_METADATA_INVALID`
- `LIFECYCLE_PROTOCOL_INCOMPATIBLE`
- `LIFECYCLE_COORDINATOR_TOO_OLD`
- `LIFECYCLE_COORDINATOR_API_INCOMPATIBLE`
- `LIFECYCLE_MAIN_TOO_OLD`
- `LIFECYCLE_MAIN_VERSION_INCOMPATIBLE`
- `LIFECYCLE_CAPABILITY_MISSING`
- `LIFECYCLE_IDENTITY_MISMATCH`
- `LIFECYCLE_ARTIFACT_MISMATCH`
- `LIFECYCLE_OFFLINE_PAIR_REQUIRED`

Diagnostics identify categories and safe recovery actions, never credentials, platform identities or business data.

### 4. Old/new combinations and update modes

- An old coordinator encountering a main package requiring a higher API rejects hot upgrade with `LIFECYCLE_COORDINATOR_TOO_OLD` / `LIFECYCLE_OFFLINE_PAIR_REQUIRED`.
- A new coordinator encountering a main package below `mainPackageRange` rejects startup with `LIFECYCLE_MAIN_TOO_OLD`.
- Protocol-major mismatch is rejected regardless of apparently close package versions.
- Compatible minor negotiation requires both version ranges and all required capabilities to match.

Main-only replacement requires the current coordinator to accept candidate protocol/package/capabilities and the candidate to accept coordinator API/capabilities. Otherwise stop the supervised launcher and install both bundles offline through `scripts/install.mjs`. The old coordinator never hot-replaces itself.

### 5. Check points

1. **Before build/packaging:** build coordinator from `packages/bot-lifecycle/src/index.ts`; source digest, list, version, contract and output hashes in `dist/lifecycle-build.json` must match.
2. **Before installation/profile changes:** validate both archives, hashes, package names, version declarations and bidirectional compatibility; launcher must be stopped.
3. **Startup:** validate `installation.json`, separate `lifecycle-installation.json`, both archive hashes and installed identities/versions/contracts/compatibility.
4. **Before draining:** current coordinator must hot-manage both candidate and previous main; otherwise reject before drain.
5. **After activation:** launcher validates ready IPC main identity, protocol, both package versions, coordinator API and coordinator identity.

### 6. Offline paired transaction and rollback

While stopped, installer completes preflight, then records `lifecycle-installations/<id>.json` with candidate/previous archive paths, SHA-256, package versions, identities and contracts. Install coordinator then main, so no running process sees intermediate pairs. Validation/metadata-commit failure triggers one rollback, previous main then previous coordinator, owned outside the launcher. Revalidate both identities afterward. A mismatched previous archive hash stops recovery rather than guessing.

`installation.json` retains schemaVersion 1. New `lifecycle-installation.json` stores current/previous pairs without silently migrating old files. Missing records in old installations fail closed at startup; operators must stop and run the trusted installer. Evolution journal phases, unknown outcomes, no replay, one rollback, fences, cancellation and supervision retain their semantics.

## Consequences

Existing Harness profiles install only main, without managed lifecycle promises. Standalone profiles use coordinator, paired installation state and supervisor. Only explicitly declared/tested combinations are supported, not arbitrary cross-version compatibility.
