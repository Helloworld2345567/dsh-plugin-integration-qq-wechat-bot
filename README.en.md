# QQ / WeChat Harness Plugin

[简体中文](README.md) | English

QQ official channels, WeChat iLink, multiple bots and personas, and image, voice, music and video tools for DeepSeek Harness.

## Features

- Independent bot settings, channel sessions, attachments and long-term memory; persona changes preserve sessions.
- Image generation/editing and understanding, speech recognition, TTS replies, video analysis and media conversion.
- Music search/download and RVC voice conversion through optional external services and models.
- Scheduled tasks, proactive chat, controlled tools and progress reminders in trusted private chats.
- Chinese/English management UI; configuration applies from the next turn, with separate UI and bot system-message languages.
- Standalone deployment with supervised startup, managed upgrades and rollback.

## Install and get started

Requires Node.js 24+, Python 3.12/3.13 and DeepSeek Harness `0.2.1-rc.5`; audio/video processing requires `ffmpeg` and `ffprobe`. Use PowerShell 7 on Windows.

Read [Getting started](docs/en/getting-started.md), then choose one installation mode:

| Mode | Use when |
| --- | --- |
| [Install into existing Harness](docs/en/install-existing-harness.md) | You maintain an existing profile and its startup/update process |
| [Deploy a standalone bot product](docs/en/deploy-product-profile.md) | The installer should manage an isolated `bots` profile, workspace and lifecycle coordinator |

The base installation does not require CUDA, GPT-SoVITS, Music, RVC or model weights. Deploy optional capabilities separately; unconfigured capabilities show `missing` or `blocked`.

After installation, configure a chat model and credentials in Harness, open **Bot panel**, create a persona and bot, authorize QQ/WeChat, and send a test message. Each bot owns its model, media and permission settings. Persona files support only `schemaVersion: 4`.

## Documentation

| Task | Documentation |
| --- | --- |
| Configure bots, environment variables and workspaces | [Configuration](docs/en/configuration.md) |
| Diagnose installation, connection and media failures | [Troubleshooting](docs/en/troubleshooting.md) |
| Configure TTS/RVC models and voices | [Voice model library](docs/en/voice-model-library.md) · [RVC conversion](docs/en/singing-conversion.md) |
| Connect music and understand QQ delivery limits | [Music integration](docs/en/music-integration.md) · [QQ media delivery](docs/en/qq-media-delivery.md) |
| Develop, test and understand the architecture | [Development](docs/en/development.md) · [Testing](docs/en/testing.md) · [Architecture](docs/en/architecture.md) · [Dependency boundaries](docs/en/architecture-boundaries.md) · [ADRs](docs/en/adr/) |
| Review dependencies and licenses | [Python dependencies](docs/en/python-dependencies.md) · [Dependency audit](docs/en/dependency-audit.md) · [Third-party notices](THIRD_PARTY_NOTICES.en.md) |

## Development and release

Implementation lives in `src/`, media workers in `python/`, skills in `skills/`, and auxiliary bundles in `packages/`. Scripts and tests live in `scripts/` and `tests/`.

`npm run verify:release` runs the release gates. `npm run release:pack` creates a temporary archive, validates its contents and removes it. See [Development](docs/en/development.md) for setup and checks appropriate to each change.

See [CONTRIBUTING](CONTRIBUTING.en.md) for contributions, [SUPPORT](SUPPORT.en.md) for usage help, [SECURITY](SECURITY.en.md) for security reports, and [CODE_OF_CONDUCT](CODE_OF_CONDUCT.en.md) / [AGENTS](https://github.com/Helloworld2345567/dsh-plugin-integration-qq-wechat-bot/blob/main/AGENTS.md) for collaboration rules. Release history is in [CHANGELOG](CHANGELOG.en.md).

## License

[MIT](LICENSE). External services, models and dependencies retain their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.en.md).
