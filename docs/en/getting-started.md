# Getting Started

[简体中文](../getting-started.md) | English

This is the executable installation entry point. The project provides Simplified Chinese and English documentation/UI, without a commitment to a third-party Adapter ABI or external platform/service acceptance.

## Prerequisites

For Windows 10/11 and PowerShell 7:

- Node.js 24 or newer.
- Python 3.12 or 3.13.
- DeepSeek Harness `0.2.1-rc.5`.
- `ffmpeg` and `ffprobe` callable from PowerShell.
- Access to the required npm registry. `package-lock.json` uses public npm registry integrity checks.

The base installation installs declared Node/Python dependencies only, without requiring CUDA, RVC, GPT-SoVITS, Music or weights. Edge TTS, Music, RVC and GPT-SoVITS are optional layers/external services configured separately.

Check tools first:

```powershell
node --version
python --version
ffmpeg -version
ffprobe -version
```

Base Python dependencies come from `requirements.txt`; install `requirements-voice-generation.txt` only for built-in Edge TTS. Do not copy QQ/WeChat credentials, Harness credentials, service keys or models into the project.

## Choose an installation path

Both paths share the main plugin but have different responsibilities:

| Path | For | Changes | Lifecycle |
| --- | --- | --- | --- |
| [Existing Harness](install-existing-harness.md) | Users maintaining a Harness profile | Adds only the main bundle to that profile | No project coordinator |
| [Standalone product profile](deploy-product-profile.md) | Operators needing isolated data/workspaces and supervision | Creates/manages the project's `bots` profile, data and workspaces | Installs `dsh-bot-lifecycle` for drain, supervised restart, upgrades and one rollback |

Do not mix the paths: existing-Harness installation does not take over the profile, and standalone deployment does not modify other profiles.

## A. Install into an existing Harness profile

Run PowerShell from the repository root:

```powershell
npm ci
python -m pip install -r requirements.txt
npm run build
npm run verify:release
dsh plugin --profile <profile> add .
```

Replace `<profile>` with an existing profile name. Stop Harness using it before installation and restart after `add .`. Do not edit the profile's `package.json` or copy `cordis.patch.yml` manually.

Media workers use `python` by default. Set `BOT_PYTHON` before starting Harness to use a different Python 3.12/3.13 interpreter. For Edge TTS, also run:

```powershell
python -m pip install -r requirements-voice-generation.txt
```

Open Harness settings and confirm **Bot panel** appears. This mode creates no project `bots` profile and supplies no managed upgrades, supervised restarts or automatic rollback.

## B. Deploy a standalone product profile

Use existing scripts rather than assembling Harness profile files yourself:

```powershell
npm ci
python -m pip install -r requirements.txt
npm run verify:release
node scripts/install.mjs .
node scripts/start.mjs --port 3080
```

Set production data/workspace directories before installing. Replace the safe placeholders below; do not commit actual local paths:

```powershell
$env:BOT_HOME = '<absolute-product-home>'
$env:BOT_WORKSPACE_ROOT = '<absolute-workspace-root>'
node scripts/install.mjs .
node scripts/start.mjs --port 3080
```

By default the installer creates `bots`, a media Python environment with `requirements.txt`, shared workspace storage, the main bundle and `dsh-bot-lifecycle`. Default layers are `core,basic-media`. Optional `voice-generation` installs only declared Edge TTS dependencies. Operators still deploy and verify Music, RVC, GPT-SoVITS and models. Use `--layers=` or `BOT_INSTALL_LAYERS`; both required layers must remain present.

The launcher stops through a local authenticated control endpoint and receives lifecycle signals through an IPC nonce. Stop the standalone instance with:

```powershell
node scripts/stop.mjs
```

The coordinator and operator share upgrade/rollback/data responsibilities. For local source or `.tgz`, installation validates archive structure and records current SHA-256 plus installed identity; that does not establish download provenance. Fixed GitHub Release installation requires an operator-provided expected SHA-256, checked by bootstrap before installation. Journal-driven upgrades recheck recorded archive hashes. Failed healthy startup can restore a still-matching previous archive at most once. Keep `BOT_HOME`/workspace backups before upgrading. After a successful upgrade, a trusted administrator can queue rollback with `/evolve rollback <task-id>` using a historical task ID. Rollback retains personas, sessions, attachments and credentials and does not replay uncertain external deliveries. See the [lifecycle bundle](../../packages/bot-lifecycle/README.en.md) and [ADR 0003](adr/0003-lifecycle-and-uncertain-outcomes.md).

There is no standalone uninstall command. Stop first, back up retained data, then remove the product profile, `BOT_HOME` and workspace according to your retention policy; deleting them deletes their runtime data. Remove a plugin from an existing Harness profile using that version's Plugin Manager/settings removal action, not manual deletion of dependencies/profile files.

## First verification

Follow this order; consult [troubleshooting](troubleshooting.md) on failure:

1. **Plugin loading:** confirm **Bot panel** in settings; for standalone deployment verify `bots` loads both main and lifecycle bundles. Supervised-restart availability requires installation smoke or actual restart-journal evidence. If missing, check the running profile, Harness version and installed bundle identity.
2. **Models and credentials:** configure the chat model in Harness. Media analysis reuses managed provider credentials; never put keys into personas, command arguments or `.env.example`.
3. **Persona:** create a named persona and prompt. Only `schemaVersion: 4` is accepted; V3/earlier files are not read, migrated or used as fallback.
4. **Bot:** select QQ/WeChat and its account, bind the persona, configure model/reply behavior under **Run**, and capabilities under **Media**. Runtime settings are independent per bot and survive persona switches; edits apply next turn.
5. **Authorization:** use **Bots → Authorization**. Operators handle platform authorization, event permissions, account status and limits; credentials enter only Harness credentials.
6. **First message:** once connected, send an ordinary test message from an authorized QQ private chat or WeChat conversation. Verify text first, then required media.
7. **Delivery:** `pending`/`registered` mean queued; `failed` means confirmed failure; `unknown` means the result after submission could not be confirmed. Only platform receipts prove delivery.

## Capability boundaries

- Platform authorization and operator accounts are not supplied by the main package.
- External TTS/Music/RVC/GPT-SoVITS/CUDA services and weights are not installed by it.
- Unregistered/unavailable capabilities display `missing`/`blocked`; no silent service substitution.
- UI language follows Harness; all bots' system-message language is independently selectable on Services.
- No third-party Adapter ABI is promised.
- Tests/health prove code, protocol or detectability, not external platform/service or character-quality acceptance.
- See [configuration](configuration.md) for environment sources and restart boundaries.
