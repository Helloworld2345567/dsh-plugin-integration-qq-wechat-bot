# Dependency and Supply-chain Audit

[简体中文](../dependency-audit.md) | English

This is the reviewable phase-2 baseline, not a claim of zero vulnerabilities. Audit date: 2026-11-03; environment: Node 24.17.0, npm 11.13.0, Python 3.13.14. CI also covers Python 3.12.

## Provenance and reproducible installation

- Lockfile v3 uses `https://registry.npmjs.org/` for all `resolved` URLs and retains npm integrity. Root `.npmrc` declares that registry; regional/private mirrors are not implicit sources.
- `npm ci` uses the lockfile without extra project installation logic beyond lifecycle scripts; release checks use `npm pack --ignore-scripts`. Restricted networks may explicitly use `npm_config_registry`, `--registry` or organization caches, without changing committed resolved sources.
- User `requirements.txt` / `requirements-voice-generation.txt` retain compatible ranges. Pillow was tightened from `>=10,<13` to `>=13,<14` for security fixes. Corresponding CI files pin verified versions without packaging Python environments/services.
- Base media and optional voice-generation dependencies are separate. Music/RVC/GPT-SoVITS/CUDA/weights/services are outside main npm/Python dependencies.
- Phase-5 import auditing found direct `yarl` use in vendored networking, so user ranges explicitly include `yarl>=1.17,<2`, with CI snapshot `1.25.1` already verified alongside aiohttp. This removes a transitive-install assumption without adding networking capability.

## npm audit results

Executed for this snapshot:

```text
npm audit --json
npm ls --all
npm outdated --json
```

There were `196` reported items: `189 high`, `7 moderate`, `0 critical`, `0 low`. `npm audit --omit=dev --json` matched the full result, so development dependencies alone do not explain the count. `npm ls --all` passed. Outdated differences mainly concerned Harness candidates and major tool upgrades.

### Runtime vulnerabilities and deferred items

| Scope | Finding | Action |
| --- | --- | --- |
| `@deepseek-ai/dsh` and `0.2.1-rc.5` subpackages | High reports across direct runtime and many pinned transitive packages | Deferred: extensions/peer contracts bind this version; compatibility changes require native acceptance, not `audit fix --force` |
| `undici` | High runtime findings through Harness/LLM dependencies | Defer to a compatible Harness release; not directly declared |
| `zod` < 4.6.6 | Old nested Harness versions only; direct top-level is 4.6.7 | Defer to compatible Harness upgrade, without forced overrides breaking its contracts |
| `@modelcontextprotocol/client` 2.2.0 | Moderate in Harness MCP subtree | Defer to Harness upgrade; plugin does not directly call its business API |
| `fflate` 0.8.2 | Moderate in Harness LibreOffice subtree; other paths have 0.8.3 | Defer to compatible Harness upgrade |

`npm run audit:dependencies` permits only documented Harness transitive items and reports actual counts. Undocumented packages, direct business-dependency vulnerabilities or new severity levels fail. This is known deferral, not a security exemption or zero-vulnerability statement.

### Direct dependencies safely updated

- `ws` changed from `8.22.0` to `8.22.1` within the Node 24-compatible major, under MIT, with updated lockfile integrity. Types, TypeScript/Python tests, build and release checks ran.
- No direct vulnerabilities in `yaml`, `zod`, `json-bigint`, `qrcode`, `silk-wasm` or development tools required forced upgrades in this audit. Outdated output alone does not justify major TypeScript/esbuild/Node-types/Harness upgrades.
- Harness peers remain `0.2.1-rc.5` and Cordis `~4.0.5`; higher-version compatibility was not established in this phase.

## Python audit

| File | Purpose | Version policy |
| --- | --- | --- |
| `requirements.txt` | User media/document/download packages | Compatible ranges for Python 3.12/3.13; pip resolves wheels |
| `requirements-voice-generation.txt` | Optional Edge TTS | Compatible range; absence does not affect base bot/media |
| `requirements-ci.txt` | Reproducible CI | Exact 2026-11-03 tested versions |
| `requirements-voice-generation-ci.txt` | Optional TTS CI | Exact 2026-11-03 tested versions |

`python -m pip check` passed. Initial audit reported 39 Pillow vulnerabilities in `12.3.0`, all fixed in `13.0.0`. The user range became `Pillow>=13,<14`, CI uses `13.0.0`, and rerun `pip-audit` reported `vulns: []` for base and optional Edge TTS dependencies. Licenses were checked with `pip-licenses --from=mixed --format=json`; audit tools run only in temporary environments and are not packaged.

To reproduce:

```powershell
python -m pip install -r requirements-ci.txt -r requirements-voice-generation-ci.txt
python -m pip install pip-audit==2.10.1 pip-licenses==5.5.5
pip-audit -r requirements.txt -r requirements-voice-generation.txt
pip-licenses --from=mixed --format=table
```

Installed metadata/upstream notices govern licenses. Optional `edge-tts` uses LGPLv3 and its notices must be preserved. `pypdfium2` includes PDFium/dependency licensing beyond its wrapper. Current yt-dlp metadata says Unlicense, but platform/media-content rules still apply.

## Decision rules

1. Never run `npm audit fix` / `npm audit fix --force` directly.
2. Each direct upgrade states reason, license and provenance and passes Node 24, Harness `0.2.1-rc.5`, Windows, full tests and release checks.
3. Record pinned Harness risks as known deferrals that cannot be independently upgraded. Do not reduce counts with overrides, patches or removed findings before a compatible release is verified.
4. Lockfile changes use public registry URLs and retain integrity; restricted-network caches/mirrors are explicit configuration, not committed hidden sources.
