# Deploy a Standalone Bot Product Profile

[简体中文](../deploy-product-profile.md) | English

See [Getting started](getting-started.md) for prerequisites, first verification and boundaries, [configuration](configuration.md) for variables and [troubleshooting](troubleshooting.md) for failures.

This mode creates/manages an isolated `bots` profile, product data directory, media Python environment, workspace, main bundle and coordinator bundle. Other Harness profiles are not modified.

> Documentation and UI support Simplified Chinese and English. UI language follows Harness; bot system-message language is independent on Services.

## Prerequisites

- Windows 10/11, PowerShell 7, Node.js 24+, Python 3.12/3.13 and DeepSeek Harness 0.2.1-rc.5.
- `ffmpeg` and `ffprobe`.
- No CUDA/RVC/GPT-SoVITS/Music/weights needed for the base installation.
- Optional `uv`; otherwise Python `venv` and `pip` are used.

## Local source deployment

```powershell
npm ci
npm run verify:release
node scripts/install.mjs .
node scripts/start.mjs --port 3080
```

Defaults are `.runtime/bot-data` for product data and `.runtime/workspaces` for workspaces. Set explicit production directories before installation:

```powershell
$env:BOT_HOME = '<BOT_HOME>'
$env:BOT_WORKSPACE_ROOT = '<BOT_WORKSPACE_ROOT>'
node scripts/install.mjs .
node scripts/start.mjs --port 3080
```

Stop the supervised instance:

```powershell
node scripts/stop.mjs
```

Defaults install `core,basic-media`, not CUDA, external GPT-SoVITS/Music/RVC projects or weights. For optional Edge TTS:

```powershell
node scripts/install.mjs . --layers=core,basic-media,voice-generation
```

Available layers are `core`, `basic-media`, `voice-generation`, `music`, `singing-rvc`; the first two are required. Optional layers install only this project's declared supporting dependencies. External services still require separate deployment and acceptance.

## Load the panel separately from bot services

Keep the original profile, plugins and session storage. Switching to an empty profile to separate start/stop would hide existing plugins, the bot panel and history.

Set main Config `autoStart: false` to load the panel, personas, models and history without connecting channels or consuming background tasks. Hosts can call `startService()`, `stopService()` and `serviceRunning()` independently. Stopping preserves bot enabled preferences/history; starting a single bot in the panel also starts its required background consumers.

One Harness process owns each bot data directory. Service commands control the runtime inside that process, not a second Harness writing the same database. External GPT-SoVITS, Breeze TTS and RVC retain their own lifecycle entries.

The panel toolbar's **Start bot service** and **Stop bot service** change channel services without changing individual enabled preferences. Each bot's **Run** switch independently connects/disconnects that bot.

## Pinned GitHub Release deployment

Remote production installation pins repository, semver release tag, `.tgz` asset and expected SHA-256 together:

```powershell
node scripts/bootstrap-github.mjs `
  --repository=OWNER/REPO `
  --ref=v1.2.3 `
  --asset=PACKAGE.tgz `
  --sha256=<64-lowercase-hex-digest> `
  --home=<BOT_HOME>
```

Bootstrap permits HTTPS GitHub addresses only, validates redirects/DNS at each hop, and calls the installer only after hash/tar safety checks. Recovery uses a previous archive only if its hash still matches.

## Verification

1. Open the Harness URL printed at startup.
2. Open **Bot panel** in settings.
3. Configure the chat model, personas and channel authorization.
4. Verify core chat.
5. Separately verify actual GPT-SoVITS output, full music downloads and RVC conversion.

Profile health means detectable now, not accepted media output. Acceptance binds persona and Profile revisions.

## Data and upgrades

- Personas/product state live in `BOT_HOME`.
- Sessions, attachment indexes, engine caches and default workspaces live in `BOT_WORKSPACE_ROOT`.
- Harness credentials manages credentials; they never enter release files.
- `dsh-bot-lifecycle` is a separate bundle, not an internal main-plugin service. `installation.json` retains its schema; `lifecycle-installation.json` separately records current/previous main/coordinator archive hashes, identities, versions and contracts.

### Replace only the main package

A managed hot upgrade requires the coordinator to accept the candidate runtime protocol, package version and capabilities, and the candidate to accept the coordinator API/capabilities. The coordinator validates candidate/previous hashes/contracts before draining. Activation failure restores the previous main package only once, without replaying unknown external outcomes.

### Update both bundles offline

When protocol major, coordinator API, package ranges or required capabilities change, the old coordinator does not hot-replace itself:

```powershell
node scripts/stop.mjs
node scripts/install.mjs <package-directory-or-tgz>
node scripts/start.mjs --port 3080
```

The installer checks paired compatibility before profile changes and requires a stopped launcher. Installer/launcher share a product-level exclusive lock. It installs coordinator and main offline, records a safe journal, and verifies both hashes, identities, versions and contracts. An interrupted install tries one previous-main → previous-coordinator recovery. After forced termination, rerun the installer to converge a nonterminal journal. A mismatched old archive hash keeps the product stopped; do not delete the journal, guess versions or manually replace only one bundle. See [upgrade/rollback troubleshooting](troubleshooting.md#11-upgrade-or-rollback-fails-after-installation) for manual lock archival conditions.

### Incompatible recovery

On `LIFECYCLE_*` errors, keep the profile stopped; retain `installation.json`, `lifecycle-installation.json`, `lifecycle-installations/`, `evolution/` and archives; rerun the installer from trusted source or a verified archive; start the launcher only after startup checks pass. Older installations without `lifecycle-installation.json` are not silently migrated and require the same offline paired installation.

See [ADR 0001](adr/0001-delivery-modes.md), [ADR 0003](adr/0003-lifecycle-and-uncertain-outcomes.md) and [ADR 0004](adr/0004-lifecycle-bundle-compatibility.md).
