# Contributing

[简体中文](CONTRIBUTING.md) | English

Thank you for contributing. The project maintains Simplified Chinese and English documentation and UI. This guide covers code, documentation and releases.

## Bilingual maintenance

- Chinese documents retain their paths. Root and subpackage documents use matching `.en.md` siblings; detailed English documents live in `docs/en/`, with matching filenames and ADR numbers.
- Each document pair has a `简体中文 | English` link at the top. English document navigation should use English counterparts; source code, licenses and single-source English skills share their original targets.
- Update both languages in the same change whenever functionality, commands, configuration, versions or limits change. Keep section order, commands, configuration keys, numbers and compatibility facts aligned.
- Use consistent terms: 机器人 / bot, 人格 / persona, 会话 / session, 服务配置 / Service Profile, 投递 / delivery, 能力 / capability, 固定系统提示 / system message. Names, IDs, user content and original third-party diagnostics are not automatically translated.
- UI, system messages and diagnostics use semantic keys and parameters. Both languages must have matching keys and placeholders. Built-in `SKILL.md` files and model operation instructions have one English runtime source, not two runtime copies.
- `npm run check:docs` checks pairs, reciprocal language links, links and anchors. `npm run check:contracts` checks command contracts in both versions of developer documentation. Automated checks do not replace semantic translation review.

## Development entry points and test contract

See the [development guide](docs/en/development.md) for initial setup, directory ownership, test safety boundaries and minimum checks by change type; the [test contract](docs/en/testing.md) for test layers, variables, CI and sanitized evidence; and the [architecture boundary contract](docs/en/architecture-boundaries.md) for module responsibilities, allowed dependency directions and extension restrictions. The first two pages are the maintained entry points for contributor commands.

## Development environment (Windows)

- Windows 10/11 and PowerShell 7.
- Node.js 24 or newer; `package.json` pins the Harness runtime to `0.2.1-rc.5`.
- Python 3.12 or 3.13. Install base media dependencies from `requirements.txt`; optional Edge TTS dependencies come from `requirements-voice-generation.txt`.
- `ffmpeg` and `ffprobe` must be callable from PowerShell.
- QQ, WeChat, Music, RVC, GPT-SoVITS, CUDA and model weights are not development dependencies and must not be added to the main package or CI.

Do not copy local Harness profiles, runtime data, credentials, user IDs or service endpoints into the repository.

## Installation

```powershell
npm ci
python -m pip install -r requirements.txt
# Install only when voice generation is needed:
python -m pip install -r requirements-voice-generation.txt
```

CI uses the documented test version files `requirements-ci.txt` and `requirements-voice-generation-ci.txt` for reproducible verification; they do not replace user input requirements files.

## Local verification

Before submission, run the applicable checks from this command list:

```powershell
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
npm run verify:release
npm run release:pack
$env:BOT_TEST_PYTHON = (Get-Command python).Source
npm run test:native
npm run test:lifecycle-native
npm run test:install-smoke
npm run audit:dependencies
```

`test:native` requires a runnable native Harness environment. Installation smoke tests require the project's test Python interpreter setting. If Harness or external platform credentials are unavailable, state which acceptance checks were not run and why in the PR; do not substitute mock results for them.

Use the release check:

```powershell
npm run release:pack
```

It creates archives only in a temporary directory, validates their contents and cleans them up; it neither commits nor publishes packages. Do not run `npm audit fix` or `npm audit fix --force` directly. Assess dependency upgrades individually.

## Dependencies and licenses

- `package-lock.json` uses public npm registry integrity checks; do not write regional mirrors into it.
- `@deepseek-ai/dsh`, Cordis and peer packages belonging to the same Harness runtime remain at their compatible versions. Do not upgrade without compatibility evidence.
- For added or upgraded dependencies, explain the reason, runtime/development scope, license, upstream URL and Node 24/Windows verification in the PR.
- Python dependency changes must also update version ranges, CI snapshot documentation and `THIRD_PARTY_NOTICES.md`. Do not add CUDA, models, RVC or Music projects to the main dependencies.
- If supply-chain or licensing facts cannot be confirmed, hold the merge and provide source evidence. Do not guess commits, copyright holders or licenses.

## Branches, commits and PRs

- Create short-lived branches from current `main`; do not rewrite shared branch history.
- Start commit messages with concise verbs; `type: summary` such as `chore: ...`, `fix: ...` or `feat: ...` is recommended.
- Keep each PR focused on one issue, describing behavior changes, compatibility, dependency/license effects and rollback.
- Attach commands actually run and their results. Explain any skipped native Harness, platform or external service acceptance tests.
- Do not push, publish or send QQ/WeChat/other platform messages without explicit authorization.
- Do not upload credentials, runtime logs, databases, user data, model weights, signed download links or local paths in PRs.

## Files that must not be committed

Do not commit or package:

- `.runtime/`, `.codex/`, `node_modules/`, virtual environments, caches or `__pycache__/`.
- Databases, logs, archives (including `.tgz`), temporary outputs or test workspaces.
- `.env`, platform tokens, API keys, Harness credentials, user IDs or signed URLs.
- RVC/GPT-SoVITS/CUDA models, checkpoints, indexes or other model weights.
- Runtime data from external Music, QQ, WeChat or TTS services.

Credentials must be managed through Harness credentials. Image service keys may come only from environment variables or managed configuration.
