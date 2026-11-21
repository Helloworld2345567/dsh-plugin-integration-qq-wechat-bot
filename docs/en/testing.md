# Testing and acceptance

[简体中文](../cn/testing.md) | English

Tests use Node.js 24+, Python 3.12/3.13 and Harness `0.2.1-rc.5`. Use offline fixtures or local test servers by default, never real credentials or platform connections, and do not send platform messages. See [development](development.md) for minimum checks by change type.

## Command purposes

| Command | Failures detected and requirements |
| --- | --- |
| `npm run check:environment` | Missing base dependencies, FFmpeg/ffprobe, lockfile or unsupported versions; read-only, optional voice dependencies report `OPTIONAL` |
| `npm run check:architecture` | Invalid dependencies, cycles, SQL ownership, Python namespaces or build entries; read-only and offline |
| `npm run check:skills` | Invalid declarations, parameters, routes, references or context budgets; read-only |
| `npm run generate:skills` | Generates TS/Python registries; add `-- --check` to detect drift without writing |
| `npm run inspect:skills` | Displays a compact skill/tool/operation catalog; read-only, not runtime acceptance |
| `npm run test:skills` | Skill contracts, generated registries and focused skill unit regressions |
| `npm run typecheck` | TypeScript type errors |
| `npm run test` (or `npm test`) | TypeScript logic, SQLite and protocol fixtures; some media cases require test Python/FFmpeg |
| `npm run test:unit -- tests/<affected>.test.ts` | Runs only the selected TypeScript files; without file arguments it matches `npm test` |
| `npm run test:python` | Worker protocols, namespace imports, import side effects and media regressions; test Python required, FFmpeg for some cases |
| `npm run test:python:unit -- tests/<affected>.py` | Runs only the selected Python unittest files; without file arguments it matches `npm run test:python` |
| `npm run check:python-dependencies` | Requirement syntax, missing base packages or `pip check` conflicts; does not install dependencies |
| `npm run build` | Main/lifecycle build failures; writes ignored `dist/` output and build digests |
| `npm run check:docs` | Broken local links/anchors, missing language pairs and invalid CI YAML |
| `npm run check:contracts` | Drift between documented commands/versions, npm scripts, CI and test isolation |
| `npm run check:licenses` | Dependency license or provenance mismatches; reads installed metadata |
| `npm run check:release` | Missing package files or included runtime data, tests or credentials in npm dry-run |
| `npm run verify:release` | Shared architecture, skill, type, build, TS/Python, dependency, documentation, license and release gate |
| `npm run release:pack` | Runs the same source gate, then creates, validates and removes a temporary npm archive |
| `npm run test:native` | Real Agent loop, persistence and fixture provider in a temporary Harness profile |
| `npm run test:lifecycle-native` | Bundle compatibility, draining, main hot upgrade, supervised restart and failure rollback |
| `npm run test:install-smoke` | Actual archive installation, installed Python worker, supervised start/restart and launcher cleanup; needs `BOT_TEST_PYTHON` |

A pass only establishes the check's covered behavior. Do not repeat a release command's included gates immediately before or after it; run the three native integration checks separately. Repository contracts use real temporary SQLite for reopen persistence, scope isolation, revision/CAS, cursors, rollback and deterministic recovery.

## Test environment and variables

Runners use a minimal environment allowlist, isolated home/temp directories and dynamic ports instead of copying all of `process.env`. Python uses a fixed package root and `-B -P -m`, never inherited `PYTHONPATH`. The native fixture's `OPENAI_API_KEY` is a fixed fake value set by its runner.

| Variable | Purpose |
| --- | --- |
| `BOT_TEST_PYTHON` | Explicit Python 3.12/3.13 test interpreter, independent of production |
| `BOT_TEST_TMP` | Workspace/CI temporary root; each run creates and cleans its own child directory |
| `BOT_TEST_WEB_TOOLS_SOURCE` | Optional local `dsh-web-tools` fixture; must be inside the checkout with a validated package name |
| `BOT_TEST_ANALYSIS_KEY` | Obviously fake credential-routing fixture; no real service calls |
| `NATIVE_TEST_RESULT`, `LIFECYCLE_NATIVE_FOLDER` | Runner-created result file or lifecycle temporary root |
| `BOT_HOME`, `BOT_WORKSPACE_ROOT`, `BOT_PERSONAS_ROOT`, `BOT_DATA_HOME`, `BOT_PYTHON` | Runner-created/validated isolated directories and interpreter |
| `PYTHONPATH` | Runner-set trusted `python/` root, not an inherited user input |

Do not use shared Harness profiles, real account/group/user IDs, tokens, cookies, model endpoints or user npm/pip configuration. Keep test variables out of production configuration and public issues.

## Manual acceptance

- Fixture success does not establish real QQ/WeChat delivery. Health/probe success does not establish media quality, complete audio or listening acceptance. Operators separately accept real platforms and external model services.
- Check matching translations/placeholders, usable English labels at wide, 760px and 460px layouts, and draft preservation during language switching.
- Bot system-message language is independent of UI language. Saving persists it for new operations while running turns retain their original language. Persona text, user content and TTS parameters remain unchanged.
- Unregistered capabilities remain `missing`/`blocked`, without silent service substitution. Tests do not promise third-party Adapter ABI or external service results.
- From source, `python -B tests/benchmark_media_transform.py --repeats 3` reproduces synthetic-media benchmarks and cleans temporary output. It excludes networks, models and delivery and is not a performance guarantee.

### Paired benchmark for explicit image commands and chat

On 2026-11-19, five paired inputs ran on Windows with an RTX 5060 Ti 16 GB, a live DeepSeek Flash chat model, NativeHarness, the Python worker and ComfyUI. The generation prompts requested a cyan triangle and an orange square. The edits requested an outline change on a white disk while preserving a red, green or blue background. Two edits used a current attachment and one used a quoted image. Each edit session also contained an older image with a different background color.

| Sample | Foreground model calls, chat / direct | Chat first / last image receipt (s) | Direct image receipt (s) |
| --- | --- | --- | --- |
| Generate cyan triangle | 5 / 0 | 15.371 / 15.371 | 4.664 |
| Edit red image | 10 / 0 | 45.407 / 45.411 | 4.733 |
| Edit quoted green image | 17 / 0 | 74.737 / 74.744 | 4.799 |
| Generate orange square | 5 / 0 | 14.602 / 14.602 | 4.621 |
| Edit blue image | 22 / 0 | 132.253 / 132.261 | 4.800 |

To reproduce, use an isolated profile, start a fresh session for each arm and alternate arm order. Register input assets in both arms before timing and supply the green image via synthetic `quoted.attachments`. Measure from runtime intake until the local channel adapter accepts the image. On the same build, send `//draw` or `//edit` to pass the corresponding command through chat and `/draw` or `/edit` to submit it directly. Keep the ordinary two-second chat batching window and immediate scheduling for direct commands. Disable progress reminders in both arms. Use identical workflow files and synthetic attachments within each pair. Run Anima Turbo v1.1 at 384×384, seed 42111, Euler/simple, four steps and CFG 1. For edits, connect `LoadImage → VAEEncode → KSampler` with denoise 0.24. Warm up once and disable ComfyUI node caching. Execution history showed an empty cached-node list for all 17 timed sampling runs.

Median first-image receipt times were 14.987 s for chat and 4.643 s for direct generation, and 74.737 s and 4.799 s for editing. Each chat session also made one background title call, excluded from the foreground count. Chat rewrote all five prompts and issued 3, 4 and 3 successful diffusion edits per edit request. It also invoked resizing, media downloads and unsuccessful generation attempts. Direct commands preserved the user prompt, applied the same configured style and ran one image job per request. Both arms selected the intended reference in 3/3 edit requests. Counting executed diffusion edits gives 10/10 for chat and 3/3 for direct. Checks covered the input asset, graph connection and 16 background-color samples per output. Outline quality was unscored. Median duration of a successful diffusion job was 4.783 s for chat and 4.724 s for direct commands. Receipts came from the local adapter. Live QQ/WeChat transport latency requires a separate measurement.

The five pairs were timed before the reference-input connectivity check was added. A subsequent red-image `/edit` smoke test confirmed that the connected ComfyUI `LoadImage` node used a UUID filename and received bytes identical to the source. One edit job recorded one ComfyUI call, produced one local image receipt and preserved red at all 16 background samples.

## CI and failure handling

| CI job | Scope |
| --- | --- |
| Linux `quality` | Node 24, Python 3.12, source release gate and npm/Python dependency audits |
| Windows `release-gate` | Python 3.12, FFmpeg, actual archive validation and all three native/install tests |
| Windows `python-compatibility` | Python 3.13 pinned dependency installation and `pip check` |

Stop the affected flow on failure and retain the error category, stage and necessary sanitized output tail. Do not automatically rerun individual files to hide the original failure. Clean subprocess trees, servers, timers, launcher state and temporary directories in `finally`.

CI uploads only dependency audit JSON and sanitized failure diagnostics under `.codex/*-evidence/`. Clean successful test output and delete validated `.tgz` archives. Evidence must exclude credentials, Authorization, cookies, user IDs, databases, complete logs, local paths and model weights.
