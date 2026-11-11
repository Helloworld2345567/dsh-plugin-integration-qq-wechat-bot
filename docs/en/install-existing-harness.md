# Install into an Existing DeepSeek Harness

[简体中文](../install-existing-harness.md) | English

See [Getting started](getting-started.md) for prerequisites, first verification and capability boundaries, [configuration](configuration.md) for variables and [troubleshooting](troubleshooting.md) for failures.

This mode adds QQ/WeChat bots to a Harness profile you already maintain. It installs only the main bundle, without taking over the profile or installing the standalone coordinator.

> Documentation and UI support Simplified Chinese and English. The UI follows Harness language; bot system-message language is independent on Services.

## Prerequisites

- Windows 10/11 and PowerShell 7.
- Node.js 24+.
- Python 3.12 or 3.13.
- DeepSeek Harness 0.2.1-rc.5.
- `ffmpeg` and `ffprobe`.
- A Harness profile you can stop and restart.
- No CUDA, RVC, GPT-SoVITS, Music or weights required for the base installation.

## Install from source

```powershell
npm ci
python -m pip install -r requirements.txt
npm run build
npm run verify:release

dsh plugin --profile <profile> add .
dsh --profile <profile> --no-open
```

Replace `<profile>` with your existing profile. Stop Harness using it before installation and restart afterward. Do not manually edit its `package.json` or copy `cordis.patch.yml`.

If media workers use an interpreter other than command-line `python`, set `BOT_PYTHON` before starting Harness to a Python 3.12/3.13 interpreter with dependencies installed. Edge TTS also needs:

```powershell
python -m pip install -r requirements-voice-generation.txt
```

## Verification

1. Open Harness settings.
2. Confirm **Bot panel** in the sidebar.
3. Configure a chat model and credentials in Harness model settings.
4. Create a persona/bot and complete QQ or WeChat authorization.
5. Start the bot and send a test message.

If the panel is absent, check that the profile loads `dsh-plugin-integration-qq-wechat-bot` and Harness is `0.2.1-rc.5`.

## Capability boundaries

This mode creates no project `bots` profile and installs no `dsh-bot-lifecycle`. The main plugin works normally, but version handshakes, managed hot upgrades, supervised restarts, offline paired-bundle journals and automatic rollback belong only to [standalone deployment](deploy-product-profile.md). Existing-profile operators must replace the main package using their own shutdown/upgrade procedure. Do not copy in the standalone coordinator; undeclared cross-version combinations are not supported.

GPT-SoVITS, Music, RVC, CUDA, weights and third-party external projects are not installed with the main plugin. Unregistered capabilities show `missing`/`blocked` without silently switching services.
