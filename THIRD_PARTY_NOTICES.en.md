# Third-party Notices

[简体中文](THIRD_PARTY_NOTICES.md) | English

This document states only sources and boundaries verifiable from the current checkout. Tags, commits and copyright ownership not confirmed by the checkout, dependency metadata or public upstream licenses are not invented. For dependencies specified by version ranges, consult the upstream notices of the version actually installed.

## Distributed with this project or installed as runtime dependencies

| Project | Upstream repository/source | Tag or commit | Original license | Project path/use | Modified? |
| --- | --- | --- | --- | --- | --- |
| DeepSeek Harness | <https://github.com/deepseek-ai/deepseek-harness> | npm `0.2.1-rc.5`; upstream source commit unconfirmed in this checkout | MIT | npm runtime `@deepseek-ai/dsh` and its peer/transitive packages | No; integration uses public plugin contracts |
| Cordis | Dependencies of the same Harness distribution | npm `~4.0.5`; upstream source commit unconfirmed | MIT (dependency metadata) | Harness peer/runtime closure | No |
| `json-bigint` | <https://www.npmjs.com/package/json-bigint> | npm `1.0.0` (lockfile) | MIT | Runtime JSON numeric handling | No |
| `qrcode` | <https://www.npmjs.com/package/qrcode> | npm `1.5.4` (lockfile) | MIT | Runtime QR codes | No |
| `silk-wasm` | <https://www.npmjs.com/package/silk-wasm> | npm `3.7.1` (lockfile) | MIT; SILK implementation retains upstream notices | Runtime audio codec | No |
| `ws` | <https://www.npmjs.com/package/ws> | npm `8.22.1` (lockfile) | MIT | QQ/WeChat WebSocket transport | No |
| `yaml` | <https://www.npmjs.com/package/yaml> | Current lockfile version | ISC | Configuration and patch parsing | No |
| `zod` | <https://www.npmjs.com/package/zod> | Current top-level lockfile version | MIT | Runtime schema validation | No |
| TypeScript, esbuild, tsx and `@types/*` | Respective npm repositories; versions in `package-lock.json` | Exact lockfile versions | Lockfile `license` fields (MIT or Apache-2.0) | Development, builds and type checking | No |

All `resolved` URLs in `package-lock.json` use the public npm registry and retain integrity hashes. The lockfile is authoritative for complete transitive versions and license fields. `npm run check:licenses` checks direct dependencies, sources and lockfile license fields.

## Reused/adapted code distributed with this project

### astr-bot-sakura reuse

- Upstream: <https://github.com/Helloworld2345567/astr-bot-sakura>
- Tag/commit: no verifiable upstream tag or commit is available in this checkout; none is guessed.
- Original license: existing project provenance records identify MIT. The publisher should add exact copyright lines or a commit after confirming the corresponding upstream files.
- Paths: `python/dsh_bot_runtime/skills/image_generation/` (image client), `skills/image-generation/` (skill contract), `python/dsh_bot_runtime/social_posts.py` (social posts), and `python/dsh_bot_runtime/video_understanding/` (video analysis core).
- Modified: yes. AstrBot imports were removed in favor of framework-independent worker/service interfaces. Session, quota, URL validation, media limit, error classification and Harness-managed configuration controls were added.
- These directories are distributed in the npm package, so this notice accompanies it. An unconfirmed upstream commit must not be presented as verified provenance.

### Image client

- `python/dsh_bot_runtime/skills/image_generation/image_api.py` is the canonical image HTTP client distributed by this project. The namespaced worker executes image operations through a fixed module entry.
- Upstream references and licensing follow the astr-bot-sakura record above. API contracts in `skills/image-generation/references/` do not relicense third-party service protocols.
- Image service keys are not in code or packages; they come from environment variables/managed configuration.

### Video analysis code (formerly video_understanding_core)

- `python/dsh_bot_runtime/video_understanding/` is the distributed framework-independent video analysis core used by media-analysis and the singing worker.
- Provenance follows the existing astr-bot-sakura records. Do not fill in an unconfirmed tag/commit.
- Changes include download/public-address validation, FFmpeg media probing, size/duration/concurrency limits, model input/output schemas, sanitized errors and credentials that are never persisted to disk.
- It does not contain AstrBot's AGPL implementation or grant rights to any external platform or model.

## Behavioral references that are not packaged

| Project | Repository | Original license | Relationship | Deployer obligations |
| --- | --- | --- | --- | --- |
| AstrBot | <https://github.com/AstrBotDevs/AstrBot> | AGPL-3.0-or-later | Reference for public adapter behavior and protocol boundaries; AGPL implementation not packaged | Use of AstrBot itself or its code requires AGPL compliance; this MIT package does not contain its code |
| `@tencent-weixin/openclaw-weixin` | <https://github.com/Tencent/openclaw-weixin> | MIT | iLink protocol/behavior reference only; OpenClaw runtime not packaged | This package includes neither the OpenClaw runtime nor a proprietary QQ connector; Tencent APIs and terms still govern platform use |
| unified-chat mode | User-authorized `unified-chat-mode` 1.0.12 behavioral reference | Explicit authorization recorded by the project maintainer | Behavior adaptation only; no external local-path dependency is distributed | Do not redistribute unpublished original project files as part of this package |

These reference projects are not included in the npm archive. QQ and iLink adapters were written for this project against public HTTP/WebSocket wire protocols; they are not copies of AGPL reference implementations.

## Optional external integrations (not packaged)

- Music: operators may use <https://github.com/CharlesPikachu/musicdl> in a separate Python environment. Existing project configuration records version `2.14.2`, but it is not a locked dependency of this package. The checkout contains no upstream commit/tag.
- Musicdl uses PolyForm Noncommercial 1.0.0. It is not part of this MIT package and is installed by neither the npm package nor `requirements.txt`. Operators installing it separately must follow its noncommercial distribution/use restrictions and preserve its original license.
- RVC, GPT-SoVITS, CUDA, HuBERT/ContentVec, RMVPE, model weights and other external TTS/Music services are neither packaged nor listed in the main Python requirements. Deployers must review their licenses and model terms separately.

## Python dependencies (current test snapshot)

User requirements retain version ranges. This table summarizes licenses for the current CI/local test snapshot; complete notices supplied by the dependencies take precedence.

| Package | Snapshot | License summary | Main dependency? |
| --- | --- | --- | --- |
| requests | 2.34.2 | Apache-2.0 | Yes |
| Pillow | 13.0.0 | MIT-CMU (installed License-Expression is authoritative) | Yes |
| aiohttp | 3.14.3 | Apache-2.0 AND MIT | Yes |
| yarl | 1.25.1 | Apache-2.0 | Yes; imported directly, not dependent on aiohttp's transitive installation |
| pypdf | 6.21.4 | BSD-3-Clause | Yes |
| python-docx | 1.2.0 | MIT | Yes |
| pypdfium2 | 5.14.0 | BSD-3-Clause, Apache-2.0 and PDFium/dependency licenses | Yes |
| openpyxl | 3.1.5 | MIT | Yes |
| yt-dlp | 2026.10.26 | Unlicense (installed metadata is authoritative) | Yes |
| edge-tts | 7.3.1 | LGPLv3; optional voice-generation dependency | No; installed separately |

See [Python dependencies](docs/en/python-dependencies.md) and the [dependency audit](docs/en/dependency-audit.md) for full versions and security checks. Installers must retain upstream licenses and NOTICE files; this project does not relicense them as MIT.
