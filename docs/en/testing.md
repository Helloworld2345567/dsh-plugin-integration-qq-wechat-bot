# Testing and Acceptance Contract

[简体中文](../testing.md) | English

The project maintains Simplified Chinese and English. Tests default to offline-first code/protocol verification: no real QQ/WeChat credentials, real bots or platform connections. Do not send platform messages. Tests make no commitment to a third-party Adapter ABI or external model/service results.

## Test layers

| Command | Purpose | Temporary files/subprocesses | Harness | FFmpeg | Python | Network | Real credentials | Expected output/failure evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `npm run check:architecture` | Module graph, dependency directions, runtime cycles, entries/directories | Read-only; no business process | No | No | No | No | Forbidden | JSON `PASS`; failures contain rule IDs and relative paths only |
| `npm run typecheck` | TypeScript gate | Does not change source; npm/tsc manage Node processes | No | No | No | No | Forbidden | No tsc errors; sanitized terminal errors only |
| `npm test` | Isolated TypeScript logic/fixtures | Temporary `.codex`; restricted Node/Python children | No | Fixture-dependent | Some media fixtures use test interpreter | No real external network; fixtures/local servers only | Forbidden | All Node tests pass; short sanitized failure output |
| `npm run test:python` | Worker, cold imports in varying orders, side-effect-free imports, media limits/protocols | unittest temporary outputs; no retained pyc/cache/runtime data | No | Test-dependent | Yes, 3.12/3.13 | Real services forbidden | Forbidden | `OK`; no credentials/absolute paths in tracebacks |
| `npm run check:python-dependencies` | Requirement syntax, pip check, base packages | Read-only; restricted Python child | No | No | Yes | No installation/download by default | Forbidden | JSON `PASS` or explicit missing packages; optional absence is not a base failure |
| `npm run build` | Main dist and lifecycle bundle/contract/source-output digests from its own source | Excluded build directories; esbuild children/workers | No | No | No | No | Forbidden | Successful build; stale lifecycle dist/digest drift must fail |
| `npm run check:docs` | Markdown links, anchors, language pairs and CI YAML | Read-only | No | No | No | No | Forbidden | JSON `PASS`; relative document paths on failure |
| `npm run check:contracts` | Docs/npm scripts/CI versions/runner isolation | Read-only | No | No | No | No | Forbidden | JSON `PASS`; identify drifting commands, versions or runners |
| `npm run check:licenses` | npm/Python licenses and provenance | Read-only or installed metadata | No | No | Optional | No | Forbidden | JSON `PASS`; no user paths or credentials |
| `npm run check:release` | npm pack dry-run, contents and sensitive text | Dry-run; no retained archive | No | No | No | No | Forbidden | JSON `PASS`; no `.codex`, `.runtime`, database, log, credential or fixture |
| `npm run verify:release` | Unified architecture/type/TS/Python/dependency/build/docs/license/archive gate | Existing excluded dist/temp directories only | No | No | Yes | No | Forbidden | All stages succeed; sanitized summary by failed stage |
| `npm run release:pack` | Run the same gate, create/validate/clean actual npm archives | Temporary archives/directories cleaned in `finally` | No | No | No | No | Forbidden | JSON archive summary/hash; no uploaded runtime data |
| `npm run test:native` | Native Harness plugin integration, real loop/persistence, fixture provider | Temporary profile/workspace and restricted children; retain sanitized evidence only on failure | Temporary profile | Fixture-dependent | Test interpreter | No real platform/external model | Obvious fake fixture credentials only | `status: PASS`; evidence contains sanitized summaries only |
| `npm run test:lifecycle-native` | Native installation, handshake, hot main upgrades, drain, supervised restart, one rollback | Temporary profile, dynamic port, terminated child-process trees | Temporary profile | No | Test interpreter | Real services forbidden | Fixture values only | `status: PASS`; coordinator survives main unload; failure logs exclude tokens/databases |
| `npm run test:install-smoke` | Actual npm installer, namespaced worker, supervised start/restart | Empty product home, temp workspace, dynamic port; failure evidence only | Temporary profile | No | `BOT_TEST_PYTHON` | Local smoke only; no external platforms | Forbidden | `status: PASS`, zero bots; installed-archive document worker and launcher-state cleanup verified |

Lifecycle unit/native/installation tests cover full compatibility; incompatible protocol major; old coordinator/main; compatible minor capability negotiation; missing/forged metadata; capability-free legacy pairs; permitted main hot replacement; rejection requiring offline paired upgrades; startup identity/version/hash checks; supervised restart after draining; recovery to the previous artifact after activation failure; one rollback after interrupted paired installation; source/output digest drift; and invalid identity patterns. Tests neither import QQ/WeChat messaging nor send messages.

`npm run check:environment` is a read-only preflight, not a replacement for these gates. It checks OS, Node 24+, Harness `0.2.1-rc.5`, Python 3.12/3.13, ffmpeg/ffprobe, base Python packages and lockfile. Missing voice-generation displays `OPTIONAL` without blocking the base workflow.

## Repository contract suite

`tests/repository-contract.test.ts` runs one contract suite directly against a real temporary SQLite adapter: configuration revisions, bindings, assets and pending delivery persist after reopening; scope/channel isolation; persona revision CAS; session generation and stale/forged cursors; delivery pagination/blockers; no replay of unknown outcomes; retry reuses the intent while explicit resend creates a new intent; multi-write transaction rollback; immutable Profile revisions. Store facades are no longer tested. Every added repository needs a corresponding assertion and must pass `npm run check:architecture`.

## Test environment and variables

Runners do not copy all of `process.env`. Children receive only system execution variables (`PATH`/`PATHEXT`/`SystemRoot`/`WINDIR`/`COMSPEC`), isolated HOME/temp paths and runner-created directory variables. Python runners set `PYTHONPATH` to the tested checkout or installed archive's `python/`, checking the namespace with `-B -P -m`; external `PYTHONPATH` is never inherited. Real API keys, cookies, Authorization, Harness profile/session data, user/group IDs, model endpoints and user npm/pip configuration do not enter children.

These test-only variables must not be copied into production `.env` or Issues:

- `BOT_TEST_PYTHON`: explicitly provided test interpreter, Python 3.12/3.13; not a declaration of the production interpreter.
- `BOT_TEST_TMP`: workspace/CI temporary root; each run creates and cleans a unique subdirectory.
- `BOT_TEST_WEB_TOOLS_SOURCE`: optional local `dsh-web-tools` fixture source; accepted only inside the checkout with a verified package name, never a remote package or outside path.
- `BOT_TEST_IMAGE_KEY`, `BOT_TEST_ANALYSIS_KEY`: obvious fake fixture values for credential plumbing; no real service calls.
- `NATIVE_TEST_RESULT`: runner-created result file written by the native fixture.
- `LIFECYCLE_NATIVE_FOLDER`: runner-created lifecycle fixture root.
- `BOT_HOME`, `BOT_WORKSPACE_ROOT`, `BOT_PERSONAS_ROOT`, `BOT_DATA_HOME`, `BOT_PYTHON`: isolated directories or interpreter created/validated by the runner.
- `PYTHONPATH`: runner-overridden trusted `python/` package root for `dsh_bot_runtime`, not inherited user input.

Ordinary TypeScript/Python tests must not read shared Harness profiles, `DSH_PROFILE`, `DSH_HOME`, `DSH_SESSION_ID` or real credentials. Fixture credentials use `fixture-*` placeholders only and must not enter npm archives or complete logs.

## Real acceptance boundaries

- Passing mocks/fixtures is not QQ/WeChat platform acceptance; native tests must not send real platform messages.
- Health/probe success proves only protocol compatibility or detectability, not actual media, complete audio, image quality, character voice or download acceptance.
- Operators separately verify external TTS, Music, RVC, GPT-SoVITS, models and platforms; CI makes no stable promise about them.
- Unregistered capabilities remain `missing`/`blocked`; no silent service substitution.
- Tests do not promise V3 persona migration/rollback or a third-party Adapter ABI, and a one-machine benchmark is not a performance guarantee.

## Bilingual acceptance

Verify matching Chinese/English keys, nonempty values and placeholders, and both languages in plugin metadata/configuration descriptions. The English UI covers success, empty states, validation failures, service diagnostics, notices, confirmations and accessible text. Existing notices redraw on language changes without discarding drafts. Wide, 760px and 460px layouts must accommodate English labels.

System-message language is independent of UI language: check the Chinese legacy default, persistence across refresh/restart, new language for subsequent commands/automation, and frozen language for active turns/restored queued operations. New personas receive initial text once; existing personas, user content and TTS parameters remain unchanged. English internal instructions must not force ordinary replies into English.

Structured diagnostics pass strict schemas, caches and management responses; old records remain readable, machine codes/HTTP statuses remain stable, and public parameters remain sanitized. English documentation must independently support installation/configuration. Existing gates check links, language pairs, command contracts and package inclusion.

## CI mapping and evidence

| CI layer | Work |
| --- | --- |
| Linux `quality` | Node 24, Python 3.12, the shared `verify:release` source gate and npm/Python dependency audits |
| Windows `release-gate` | Node 24, FFmpeg/ffprobe, Python 3.12 and actual `release:pack`; reuse the environment for Harness `0.2.1-rc.5` native plugin, lifecycle and standalone install acceptance |
| Windows `python-compatibility` | Reproducible dependencies and `pip check` on Python 3.13; the Windows release gate already covers 3.12 |

Each Windows native/install test runs in its own step so a later command cannot mask a failed exit code. Failed TypeScript tests retain sanitized output from the original run without automatically rerunning individual files.

CI uploads dependency-audit JSON and sanitized diagnostics for failed tests. Windows `release:pack` prints archive names, SHA-256 and entry summaries, then deletes temporary `.tgz` files rather than uploading archives. Evidence must not contain credentials, Authorization, cookies, user/group IDs, runtime data, databases, full logs, absolute local paths or model weights.

## Failure handling

Retain the error category, stage, first version line and short sanitized output tail. Terminate complete Windows process trees, prefer dynamic ports, and clean launcher state, servers, timers and temporary directories in `finally`. Retain sanitized evidence directories only when needed to diagnose failure; successful runs remove all temporary test files. Upload only generated sanitized diagnostics under `.codex/*-evidence/`, never the entire `.codex`, `.runtime`, raw logs, databases, fixture credentials or complete Harness profiles.
