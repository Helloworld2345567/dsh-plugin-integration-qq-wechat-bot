# Deploy a Standalone Bot Product Profile

[简体中文](../deploy-product-profile.md) | English

The installer creates an isolated `bots` profile, product data, media Python environment and workspace, installing the main plugin and `dsh-bot-lifecycle` together. Other Harness profiles are unaffected. See [Getting started](getting-started.md) for prerequisites/initial setup and [Configuration](configuration.md) for variables.

## Install from source and start/stop

Run from the project root. For production, replace the placeholders below with absolute paths. Development can omit both variables to use `.runtime/bot-data` and `.runtime/workspaces`:

```powershell
$env:BOT_HOME = '<absolute-product-home>'
$env:BOT_WORKSPACE_ROOT = '<absolute-workspace-root>'
npm ci
python -m pip install -r requirements.txt
npm run verify:release
node scripts/install.mjs .
node scripts/start.mjs --port 3080
```

The initial Python dependencies support source verification. The installer creates a separate media environment and installs base dependencies, using `uv` when available or Python `venv`/`pip` otherwise. If `BOT_PYTHON` is set, it uses that interpreter.

Open the Harness URL printed at startup and follow [first setup and verification](getting-started.md). Stop the supervised instance with:

```powershell
node scripts/stop.mjs
```

Use the same `BOT_HOME` for installation, startup, shutdown and updates; set the environment variables again in a new terminal.

### Optional dependencies

Default layers are `core,basic-media`. For Edge TTS, replace the installation command with:

```powershell
node scripts/install.mjs . --layers=core,basic-media,voice-generation
```

You can also set `BOT_INSTALL_LAYERS`. Available layers are `core`, `basic-media`, `voice-generation`, `music` and `singing-rvc`; the first two are required. Optional layers install only declared project dependencies. Deploy external services, CUDA and models separately.

### Control the bot service separately

Set main-plugin configuration `autoStart: false` to load the panel, settings and history without connecting channels or executing background tasks. The panel toolbar's **Start/Stop bot service** preserves individual bot enabled preferences; each card's **Run** switch controls that bot. Keep the same profile and a single Harness process. External TTS/RVC services use their own start/stop procedures.

## Install a pinned GitHub Release

Pin the repository, semver tag, `.tgz` asset and expected SHA-256:

```powershell
node scripts/bootstrap-github.mjs `
  --repository=OWNER/REPO `
  --ref=v1.2.3 `
  --asset=PACKAGE.tgz `
  '--sha256=<64-lowercase-hex-digest>' `
  '--home=<absolute-product-home>'
```

Replace all example values. Bootstrap checks the GitHub HTTPS download, expected hash and archive structure before installation. Local source/archive installation records its current hash and package identity, which does not establish download provenance.

## Update and recover

Back up `BOT_HOME` and `BOT_WORKSPACE_ROOT` before updating. The former contains personas/product state; the latter contains sessions, attachment indexes, engine caches and workspaces. Harness credentials manages credentials.

When the current coordinator and candidate main package are mutually compatible, a managed upgrade can drain work and replace only the main package. Activation failure restores the previous verified main package at most once. After a successful upgrade, trusted administrators can request `/evolve rollback <task-id>` with a historical task ID. Unknown external delivery outcomes are never replayed.

Coordinator changes, protocol-major changes or incompatible capabilities require an offline paired-bundle update. Replace the path with a trusted package directory or archive:

```powershell
node scripts/stop.mjs
node scripts/install.mjs '<package-directory-or-tgz>'
node scripts/start.mjs --port 3080
```

The installer verifies paired compatibility, records a journal and excludes concurrent launcher use. Rerun the installer after interruption to complete recovery. If a previous archive fails verification, keep the product stopped; do not delete the journal or manually replace only one bundle. Older installations without `lifecycle-installation.json` also require offline paired installation.

On `LIFECYCLE_*` errors, retain `installation.json`, `lifecycle-installation.json`, `lifecycle-installations/`, `evolution/` and package archives, then rerun the installer from trusted source or a verified archive. See [upgrade/rollback troubleshooting](troubleshooting.md#11-upgrade-or-rollback-fails-after-installation) for locks and recovery, and the [lifecycle bundle](../../packages/bot-lifecycle/README.en.md) / [ADR 0004](adr/0004-lifecycle-bundle-compatibility.md) for compatibility and retained data.

## Uninstall

There is no dedicated uninstall command. Run `node scripts/stop.mjs`, back up data to retain, then remove the product profile, `BOT_HOME` and workspace according to your retention policy. Deleting these directories deletes their runtime data. Remove external services and models using their own deployment procedures.
