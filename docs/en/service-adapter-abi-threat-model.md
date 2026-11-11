# Service Adapter ABI v1 Threat Model

[简体中文](../service-adapter-abi-threat-model.md) | English

This is the security-audit baseline for a proposed third-party Service Adapter ABI v1. The ABI is a serialized host/controlled-subprocess protocol; internal TypeScript `ServiceAdapter` remains a host implementation detail. Production work stopped for the reasons recorded below.

## Assets and trust boundaries

The host exclusively owns repositories, session/channel identity, permissions, personas, Profile revisions, credentials, input-handle resolution, job/output directories, quotas, concurrency, cancellation, Asset registration, validation, delivery, acceptance and public projections. An Adapter receives only required frozen Profile data, controlled handles, host directories, deadlines and explicitly declared minimal credentials.

Boundaries: operator registration → artifact/package validation → immutable manifest/catalog → controlled process port → ABI request/response → host checks/registration. Personas, skills, workspaces, chat and model output are never code-discovery/trust sources.

## Threats and controls

| Threat | Fail-closed control | Evidence |
| --- | --- | --- |
| Malicious/malformed manifest | Strict schema, field/depth/byte caps, manifest/ABI/protocol/host API versions; reject unknown fields | Manifest conformance |
| Traversal/symlink/junction/reparse | Normalized package-relative entry; segment lstat/realpath containment; reject special files | Traversal/reparse tests |
| Hash replacement/TOCTOU | Bind canonical artifact/manifest hashes and package identity; recheck registration/enable; resolve from revalidated root | Hash replacement smoke |
| Unknown signing key | If signed, accept only operator trust-store keys | Signature tests |
| Revoked artifact/dependency | Immediately block jobs; validate required/optional dependencies, versions, cycles, revocation | Revocation tests |
| Malicious install scripts | Separate install/register; archive checks run no scripts; installed npm is not automatically trusted; no discovery | Archive smoke |
| Host environment access | Minimal allowlist, never complete process.env; job-local HOME/TEMP | Environment conformance |
| Endpoint/path/credential leaks | Bounded stderr drain never forwarded; sanitize public diagnostics/observations; private Profiles excluded | Safe diagnostics tests |
| Output escape | Single-segment relative handles; reject reparse and check realpath/size/magic/format/integrity | Escape tests |
| Oversized JSON/output/logs | Hard message/depth/stdout/stderr caps; terminate/classify overflow | Oversized tests |
| Process escape/fork abuse | Fixed executable/argv; POSIX process group/Windows tree termination; confirm cancellation only after entire tree exits | Teardown tests |
| Public listeners | No listen address in ABI or host network identity; insufficient network enforcement requires OS sandbox and disabled Adapter | Operator verification |
| Unknown network outcome | Timeout/disconnect/cancellation without proof of remote stop becomes UNKNOWN_STATE and a fence | Unknown-fence tests |
| Remote work after cancellation | Recheck AbortSignal, authorization, generation, Profile; no delivery/replay on unknown | Cancellation tests |
| Job-ID replay | Host IDs/idempotency keys; reject existing key; recover/status queries original job only | No-replay tests |
| Idempotency conflict | Unique service ID + key; no resubmission | Idempotency tests |
| Namespace collision | Global service/package/operation/tool/permission collision checks, reserved names rejected | Collision tests |
| Profile drift | Frozen revision/hash; checks before submission, after response and around each output validation | Freeze tests |
| Session/authorization revocation | No identity passed to Adapter; host checks before execution/registration | Runtime tests |
| Forged channel/delivery identity | ABI has no delivery/channel/session fields; results cannot send messages | Schema/architecture tests |
| ABI downgrade | Manifest/envelope versions; negotiation must equal host-requested version; major mismatch rejected | Negotiation tests |
| Host/Adapter mismatch | API range, manifest/protocol versions and required capabilities all checked before enable | Compatibility tests |
| Missing/cyclic/colliding dependencies | Required missing/incompatible/revoked/cyclic fails; absent optional disables only unnegotiated capabilities | Dependency tests |
| Recovery resubmits inference | recover/status carries original job ID only, without operation/parameters/input; no automatic execute | Recovery tests |

## Runtime check order

1. Confirm trusted, unrevoked, enabled, compatible artifact.
2. Check operation/catalog/policy/Profile/authorization/generation.
3. Create isolated job/output/input directories and resolve handles.
4. Send only ABI envelope/minimal credentials to the controlled process.
5. Recheck cancellation, authorization, generation and Profile after response.
6. Validate output ownership/type/size/format/integrity. Only the host registers Assets, acceptance or delivery.
7. Unconfirmed cancellation/tree/remote state means unknown plus a service fence, never automatic replay.

## Stop conditions and deployment prerequisites

If the platform cannot prove tree termination, minimal environment or directory containment, third-party Adapters stay disabled. Never fall back to host-process `import`, `require`, `eval` or callbacks. Changes to database schema, delivery, lifecycle, permissions or generation need another ADR, migration/rollback design and test environment; ABI v1 does not implement them.

This process boundary is not a general container-security claim. Production requiring arbitrary-network/syscall/file-read restrictions must add low-privilege accounts, job objects/sandbox and egress policy outside the ABI. Keep disabled when insufficient.

## Current implementation audit: stopped

The audit stopped before production implementation because Windows `NodeControlledProcessPort` only attempts tree termination with `taskkill /T /F`:

- No Job Object `KILL_ON_JOB_CLOSE`, breakaway prohibition or process-count cap proves descendants remain tracked.
- Children use the host user token; cwd/minimal environment do not isolate files, so readable repositories, Profiles, workspaces and credentials remain accessible.
- No AppContainer/restricted token, ACL sandbox or equivalent confines access to artifact/input/job directories.
- No network namespace/WFP/AppContainer controls prevent public listeners/arbitrary network access.
- taskkill success does not prove detached descendants, remote requests or system effects stopped.
- stderr is discarded and stdout capped, but there is no independent stderr cap, inherited-handle allowlist or per-job short-lived credential pipe.

These trigger the stop condition requiring provable isolation/tree termination, with no dynamic-import fallback. Therefore:

1. No third-party Adapter integration; built-ins remain unchanged.
2. The public no-ABI-commitment statement remains.
3. No dynamic import/require, npm auto-trust, install scripts or database migration.
4. Unfinished production ABI/registry drafts were removed; only this model/audit remains.

## Acceptable alternatives

### A. Implement a native isolation broker first (recommended)

Add a small auditable broker at Harness/infrastructure boundaries, not a large plugin/container framework:

- Windows: restricted token/AppContainer, `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`, non-breakaway Job Object with `KILL_ON_JOB_CLOSE`, read-only artifact, minimal job/input/output ACLs, default-deny WFP/AppContainer listener/egress policy.
- Linux, if supported: dedicated UID, mount/user/pid/network namespaces, `no_new_privs`, seccomp, cgroup v2; read-only artifact and one read-write job mount.
- Missing verified capabilities must report unsupported and keep Adapters disabled.

### B. Verified external sandbox launcher

Fixed launchers/arguments may be registered only after verifying identity/hash, isolation capability reports and conformance evidence. Operator trust or an ordinary wrapper is not isolation proof. No npm auto-trust or discovery from personas/workspaces/model output.

### C. Publish a candidate specification only

JSON Schema/protocol/conformance designs can be reviewed as draft. Until broker and install/revocation smoke are complete, export no stable ABI, enable no third-party packages and retain existing disclaimers.

## Migration and rollback design

- Keep `createBuiltin`; future third-party composition injects a serialized process port. Registration uses a separate repository without altering Profile/acceptance history.
- Separate install/register/enable. Before enable recheck hash, signature/explicit trust, ABI, dependencies, entry containment and broker capabilities.
- Revocation atomically blocks new jobs, then asks the broker to cancel trees; unconfirmed stopping creates unknown fences. Removing registration retains revisions/jobs/acceptance evidence.
- Disabling third-party registry composition returns to built-ins without changing channels, delivery, permissions, generations, schema or lifecycle.

## Required environment before continuing

A repeatable native-isolation fixture on CI and target Windows must prove:

1. No host database/Profile/workspace-secret/non-job-credential reads.
2. No writes outside permitted roots or symlink/junction/reparse escape.
3. No descendant breakaway; cancellation, timeout, host crash or broker-handle close removes the entire tree.
4. No public listeners or unauthorized network access by default.
5. Only explicit handles inherited; closed per-job credential channels cannot be reused or leak through environment/argv/output/diagnostics.
6. Defined limits for large input/output, deep JSON, slow readers, refusal to exit and concurrent cancellation.
7. Unproven termination yields durable unknown fences; recovery queries the original job, never resubmits.
8. Install/revocation/restart/release smoke proves fixtures, private keys, credentials and test Adapters are excluded from production packages.
