# Getting Started

[简体中文](../cn/getting-started.md) | English

## Prerequisites

On Windows 10/11, use PowerShell 7 and prepare:

- Node.js 24+, Python 3.12 or 3.13, and DeepSeek Harness `0.2.1-rc.5`;
- `ffmpeg` and `ffprobe` for audio/video;
- npm registry access and accounts for QQ/WeChat authorization.

Confirm these commands work. Install the corresponding dependency if a command is missing or its version is unsupported:

```powershell
node --version
python --version
ffmpeg -version
ffprobe -version
```

The base installation needs no CUDA, GPT-SoVITS, Music, RVC or model weights. Base Python dependencies are in `requirements.txt`, optional Edge TTS dependencies in `requirements-voice-generation.txt`. Deploy external services and models separately.

## Choose an installation mode

| Mode | Managed scope | Instructions |
| --- | --- | --- |
| Existing Harness profile | Adds the main plugin; you manage the existing profile's startup and updates | [Existing Harness installation](install-existing-harness.md) |
| Standalone bot product | Creates an isolated `bots` profile, data and workspace; installs main plugin and `dsh-bot-lifecycle` together for supervision and upgrade recovery | [Standalone deployment](deploy-product-profile.md) |

Run the selected guide's commands from the project root. Use that same guide for upgrades, rollback and removal; do not copy the standalone coordinator into an existing Harness profile.

## First setup and verification

1. Open **Bot panel** in Harness settings. If absent, check the active profile, Harness version and installed bundles. Standalone products load both the main plugin and `dsh-bot-lifecycle`.
2. Configure a chat model and credentials in Harness model settings. Harness credentials also stores QQ/WeChat account credentials; keep them out of personas and release files.
3. Create a persona with a name and prompt. Use `schemaVersion: 4`.
4. Create a bot, select its channel and persona, configure its model/replies/media, and authorize QQ/WeChat. Each bot owns its runtime settings; changes apply from the next turn.
5. Start the bot and send ordinary text in an authorized private chat. Once text works, verify each required media capability.
6. Inspect delivery records: `pending`/`registered` means queued, `failed` means confirmed failure, and `unknown` means the outcome after submission could not be confirmed. Platform receipts establish delivery.

The UI follows Harness language. **Services** independently selects system-message language for all bots. See [Configuration](configuration.md) for full settings.

## Add optional capabilities

- Installation or usage failures: [Troubleshooting](troubleshooting.md).

Unregistered or unavailable capabilities show `missing` or `blocked` without silently switching services. Health and automated tests do not replace actual platform delivery, complete media output or listening checks. Operators verify platform authorization, quotas and external-service availability separately.
