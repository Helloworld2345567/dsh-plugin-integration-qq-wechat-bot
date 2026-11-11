# Development Guide

[简体中文](../development.md) | English

This is the contributor entry point, not a production deployment guide. The project maintains Simplified Chinese and English. V3 persona migration/rollback, a third-party Adapter ABI and external platform/model acceptance are outside this phase. See [bilingual maintenance](../../CONTRIBUTING.en.md#bilingual-maintenance) for directory, terminology and same-change synchronization rules.

## Windows prerequisites

Use Windows 10/11 and PowerShell 7 on a fresh checkout, with:

- Node.js 24 or newer.
- Python 3.12 or 3.13.
- DeepSeek Harness `0.2.1-rc.5`, pinned by package engines/dependencies.
- `ffmpeg` and `ffprobe` callable from the same PowerShell.
- npm registry access when installing dependencies.

Basic development/tests need no QQ/WeChat credentials, CUDA, RVC, GPT-SoVITS, Music or model weights. Edge TTS is an optional voice-generation layer; operators deploy Music, RVC, GPT-SoVITS and other services separately.

## Initialize a fresh checkout

Run these existing commands from the repository root, in order; do not substitute unimplemented aliases:

```powershell
npm ci
python -m pip install -r requirements.txt
# Only when testing optional Edge TTS:
python -m pip install -r requirements-voice-generation.txt

npm run check:environment
npm run check:architecture
npm run typecheck
npm test
npm run test:python
npm run check:python-dependencies
npm run build
npm run check:docs
npm run check:contracts
npm run check:licenses
npm run check:release
```

`check:architecture` is a read-only, offline module-graph gate. It checks runtime import cycles; client/core/channel/Harness/lifecycle/Service Adapter/test/package boundaries; the single Python namespace; path mutation, bare internal imports and dynamic module keys; fixed skill entries; and build-entry drift. It requires lifecycle builds from `packages/bot-lifecycle/src/index.ts`, no subpackage imports of root `src/`, versioned contracts on main/coordinator, complete release exports/files and no return of `src/lifecycle/`. Persistence boundaries are included: only `src/infrastructure/sqlite/` imports `node:sqlite`, only `src/infrastructure/` prepares SQL or owns database handles, business layers cannot import repository implementations, and the old `src/core/store.ts` and `src/infrastructure/sqlite/store.ts` facades cannot return. Output contains repository-relative paths only. See [architecture boundaries](architecture-boundaries.md).

`check:environment` is a read-only, offline-first preflight. It does not alter Harness profiles, install dependencies, open platform connections or print environment variables. Missing optional voice-generation produces `OPTIONAL`; missing base Python dependencies, unsupported Python/Node/Harness, missing FFmpeg/ffprobe or a missing lockfile blocks the workflow.

For full release evidence:

```powershell
npm run verify:release
npm run release:pack
$env:BOT_TEST_PYTHON = (Get-Command python).Source
npm run test:native
npm run test:lifecycle-native
npm run test:install-smoke
```

`verify:release` is the source gate. `release:pack` runs it and then creates/validates an actual temporary npm archive. The three native/install runners cover Harness integration, native lifecycle integration and standalone installation respectively; none substitutes for another. They use fixture/local providers by default, create no real bots, do not connect to QQ/WeChat and do not send platform messages.

## Directory responsibilities

| Directory | Responsibility |
| --- | --- |
| `src/` | TypeScript runtime, channel adapters, management API and UI |
| `python/dsh_bot_runtime/` | The only public Python namespace: worker, shared media, service runners, vendored video core and skill implementations |
| `python/*.py` | Thin worker/RVC/extractor CLI compatibility entries only; no reusable implementations |
| `skills/` | Skill descriptions, references and fixed `operations.json` entries; no Python code |
| `packages/bot-lifecycle/src/` | Single source for coordinator, integrity, protocol, entry and shared versioned contracts; no imports from root `src/` |
| `scripts/` | Build, install, start, release gates and test helpers |
| `tests/` | TypeScript, Python, Harness fixtures and contract tests |
| `docs/` | User, contributor, operations and architecture documentation |

Root `npm run build` calls the lifecycle package's own `scripts/build.mjs`, generating source digests/output hashes. `npm --prefix packages/bot-lifecycle run verify:build` rejects stale dist before prepack. Do not copy protocol, identity or hash algorithms into the main package.

Runtime data, Harness profiles, credentials, databases, logs, temporary npm archives, test evidence, `.codex/`, `.runtime/` and Python caches are not source and must not be committed or packaged.

## Development safety boundaries

- Ordinary tests must not use real QQ/WeChat tokens, account/group/user IDs, Harness credentials, API keys, cookies or service endpoints.
- Tests must not send QQ/WeChat messages or call real external model, TTS, Music, RVC or GPT-SoVITS services. Use fixtures or explicit local test servers for networking.
- Test subprocesses use a minimal environment allowlist. Only the runner sets Python test/worker `PYTHONPATH` to the trusted `python/` root; never inherit caller values or copy the entire `process.env`.
- Do not edit shared Harness profiles. Tests use temporary `BOT_HOME`, `BOT_WORKSPACE_ROOT`, empty npm configuration and fixture credentials.
- Do not commit real endpoints, user IDs, full logs, databases, runtime data, signed URLs or weights.
- Do not upgrade `@deepseek-ai/dsh`, Cordis or other Harness core packages to evade failing tests. Compatible versions remain those established in phase 3.

## Minimum verification by change type

| Change | Minimum verification |
| --- | --- |
| Documentation only | `npm run check:docs`; if command/version contracts change, also `npm run check:release` |
| Builds/scripts | `npm run check:architecture`, `npm run typecheck`, `npm test`, `npm run build`, `npm run check:release` |
| TypeScript core | `npm run check:architecture`, `npm run typecheck`, `npm test`, `npm run test:python`, `npm run build` |
| Python worker | `npm run check:architecture`, `npm run test:python`, `npm run check:python-dependencies`, `npm run build`; media changes also check FFmpeg/ffprobe and archived `-P -m dsh_bot_runtime.worker` |
| Lifecycle | Source gates above and `npm run test:lifecycle-native`; add `npm run test:install-smoke` for installation changes |
| Installer/release | `npm run check:release`, `npm run verify:release`, `npm run release:pack`, `npm run test:install-smoke` |
| UI/locale | `npm run typecheck`, `npm test`, `npm run build`, `npm run check:docs`, `npm run check:release`; check both dictionaries, placeholders, live switching and draft preservation |

Operators separately verify actual external platform/model/TTS/Music/RVC/GPT-SoVITS results. Local fixtures do not replace that acceptance.

## Evidence before submission

PRs/local commit notes should list commands actually run, results and omitted checks. Failure evidence contains only necessary sanitized error categories and short logs. Remove credentials, Authorization, cookies, user/group IDs, absolute paths, databases, full messages and model files. Explicit authorization is required before pushing, publishing or sending platform messages.
