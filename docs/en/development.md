# Development

[简体中文](../cn/development.md) | English

This page covers source development; use [getting started](getting-started.md) for deployment. See [contributing](CONTRIBUTING.md#bilingual-maintenance) for bilingual maintenance.

For panel refactoring and extensions, follow the [UI design guidelines](ui-design-guidelines.md).

## Setup

Prepare Node.js 24+, Python 3.12 or 3.13, `ffmpeg` and `ffprobe`. npm installs the pinned Harness `0.2.1-rc.5`; use PowerShell 7 on Windows. Basic development needs no platform credentials, CUDA, weights or external media services.

Run from the repository root:

```powershell
npm ci
python -m pip install -r requirements.txt
# When testing optional Edge TTS:
python -m pip install -r requirements-voice-generation.txt
npm run check:environment
```

The environment check is read-only and does not connect platforms. Missing optional voice-generation reports `OPTIONAL`; fix missing base dependencies, unsupported versions or FFmpeg first. CI uses `requirements-ci.txt` and `requirements-voice-generation-ci.txt` for tested versions.

## Layout and development boundaries

TypeScript lives in `src/`, media implementations in `python/dsh_bot_runtime/`, skill declarations in `skills/`, and tests in `tests/`. The independent lifecycle bundle owns its build under `packages/bot-lifecycle/`; the root build invokes it. Do not copy protocol or integrity algorithms manually. See [architecture boundaries](architecture-boundaries.md) for responsibilities, dependencies and extension steps.

Ordinary tests use fixtures, temporary profiles and a minimal subprocess environment. They do not read shared Harness profiles or real credentials or call external platforms/model services. Runners choose the Python package root instead of inheriting caller `PYTHONPATH`. Keep runtime and temporary data out of commits and packages.

## Choose checks by change

Identify the failure a check should detect before running it. These are minimum pre-submission scopes; [testing](testing.md) explains commands and environments.

| Change | Checks |
| --- | --- |
| Documentation | `npm run check:docs`; add `npm run check:contracts` for command/version changes and `npm run check:release` for published-file changes |
| TypeScript core or build scripts | `npm run check:architecture`, `npm run typecheck`, `npm run test:unit -- tests/<affected>.test.ts`, `npm run build`; add `npm run test:python:unit -- tests/<affected>.py` for Python protocol changes |
| Python worker | `npm run check:architecture`, `npm run test:python:unit -- tests/<affected>.py`, `npm run check:python-dependencies`; verify archived `-P -m dsh_bot_runtime.worker` when package entries change |
| Skill declarations or routes | `npm run generate:skills`, `npm run test:skills`; add Python tests for Python implementation changes |
| UI or language resources | `npm run typecheck`, `npm run test:unit -- tests/<affected>.test.ts`, `npm run build`; verify both languages, placeholders and draft preservation |
| Lifecycle | Source gate and `npm run test:lifecycle-native`; add `npm run test:install-smoke` for installation changes |
| Installer or release contents | `npm run release:pack`, `npm run test:install-smoke` |

## Release and native integration

`npm run verify:release` runs the shared source gate. For an actual archive, run `npm run release:pack` directly: it runs the same gate, then creates, validates and deletes a temporary npm archive without uploading or publishing it.

Run native integration separately; each command covers a different layer:

```powershell
$env:BOT_TEST_PYTHON = (Get-Command python).Source
npm run test:native
npm run test:lifecycle-native
npm run test:install-smoke
```

These use local fixtures, create no real bots and send no platform messages. Record actual results and omissions in the PR. Operators separately accept real delivery, media quality and listening results. Keep only necessary sanitized failure diagnostics; stop subprocesses and remove temporary directories when tests finish.
