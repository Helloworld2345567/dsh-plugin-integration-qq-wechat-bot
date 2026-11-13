# QQ / WeChat Harness Plugin

[简体中文](README.md) | English

QQ and WeChat bot integration, multiple personas, session management and media capabilities for DeepSeek Harness.

## Features

- Official QQ and WeChat iLink channels.
- Multiple bots, independent sessions and session-level identity isolation.
- Separate persona content and per-bot model, tool and skill settings.
- Image generation and understanding, automatic speech recognition, AI voice replies and video analysis.
- Independent RVC speech-to-speech (STS) conversion of user-selected vocals into the configured target voice.
- Song search/download through a separate Music environment, with session songs available for RVC conversion.
- Unified media-analysis for public Douyin/Bilibili links, video downloads/analysis, image galleries and original web images.
- Concurrent image format/quality/size transforms; complete videos split and converted concurrently into GIFs below 10 MB at a minimum 12 fps.
- Short progress reminders in the current persona's style every minute during long private-chat tasks.
- Controlled file, media and message delivery.
- Statistics, failure records and recoverable lifecycle management.
- A React management panel with configuration changes taking effect on the next turn.

## Language support

Documentation and the management UI support Simplified Chinese and English. The UI follows Harness language settings and switches live. **System message language** on the Services page independently controls help, errors and progress messages for all bots; it defaults to Chinese and affects new operations after saving.

Creating a persona from the panel fills its initial prompt in the current UI language. Existing personas and drafts are not rewritten when the language changes. Built-in personas on fresh installations follow the user's conversation language. UI and system-message settings do not force the model's reply language or TTS inference language. Built-in skills and model operation instructions have a single English source.

## Requirements

- Node.js 24+.
- Python 3.12 or 3.13.
- DeepSeek Harness 0.2.1-rc.5.
- `ffmpeg` and `ffprobe` for audio/video processing.

## Quick start

Read [Getting started](docs/en/getting-started.md) before the first installation. It provides copyable commands, initial checks, upgrade, rollback and removal boundaries for both existing Harness profiles and standalone bot product profiles. See the [configuration reference](docs/en/configuration.md) for environment variables and [troubleshooting](docs/en/troubleshooting.md) for common failures.

## Choose an installation mode

Both modes share the main plugin and do not modify each other.

### Mode 1: Install into an existing Harness

For users who already maintain a Harness profile. Install the main bundle with Harness plugin commands; no project-specific profile or standalone lifecycle coordinator is created.

Follow [Install into an existing DeepSeek Harness](docs/en/install-existing-harness.md).

### Mode 2: Deploy a standalone bot product profile

For operators who want the project to manage an isolated `bots` profile, workspace, supervised startup, upgrades and rollback. The product installer installs both the main bundle and `dsh-bot-lifecycle`.

Follow [Deploy a standalone bot product profile](docs/en/deploy-product-profile.md).

Both support a minimal installation without GPT-SoVITS, Music, RVC, CUDA or model weights. The catalog displays unregistered capabilities as `missing` or `blocked` and never silently selects another service. Base media dependencies are in `requirements.txt`; optional Edge TTS dependencies are in `requirements-voice-generation.txt`. Operators always deploy external service projects and model weights separately.

## Governance and dependencies

See [Contributing](CONTRIBUTING.en.md), the [development guide](docs/en/development.md) for setup/minimum checks, the [test contract](docs/en/testing.md) for test layers/acceptance boundaries, and the [architecture boundary contract](docs/en/architecture-boundaries.md) for dependency directions and extension rules. Use the [security policy](SECURITY.en.md) for security issues and [support guide](SUPPORT.en.md) for routing other questions. Dependency sources, audit results, Python 3.12/3.13 support and licensing boundaries are documented in the [dependency audit](docs/en/dependency-audit.md), [Python dependencies](docs/en/python-dependencies.md) and [third-party notices](THIRD_PARTY_NOTICES.en.md).

## Configuration

Set local RVC/GPT-SoVITS model directories on the panel's **Services** page for automatic discovery, then select and save voices under **Bots → Media**. Refresh Services after adding models. See [Model library configuration and selection](docs/en/voice-model-library.md).

Personas support only `schemaVersion: 4`; V3 and earlier configurations are no longer read, migrated or used as a fallback. Service model paths belong to private Profile configuration.

1. Configure a chat model and credentials in Harness model settings.
2. Create/select a persona on **Personas**, then enter its name and prompt.
3. Create a bot on **Bots**, bind a persona, configure its model, reply behavior and media, and authorize the channel.
4. Start the bot to use it in QQ or WeChat.

Configure image protocol, endpoint, model, key environment-variable name and ComfyUI workflow under **Services → Image generation service**; **Media → Image** selects the protocol for each bot. The image script reads the key variable selected in Services, defaulting to `OPENAI_API_KEY` when no name is configured. The host passes the variable name and corresponding credential to the worker; endpoint, model, protocol and workflow come from saved service settings as explicit arguments, without environment fallbacks. Voice, music and voice conversion continue to use managed Service Profiles.

Persona files consist of `config.json` and `persona.md`; SQLite stores the active revision. Apply file changes from the panel. They take effect on the next turn while the current turn retains its frozen configuration.

The Persona page manages prompts and files only. Each bot independently stores its model, reply behavior, media and tool permissions. On upgrade, existing bots copy runtime settings once from their former personas. Later persona-file edits do not overwrite bot settings. Switching personas changes the prompt while preserving bot settings and current session model/voice overrides; bots with different settings can share one persona.

Trusted private-chat users may use permitted controlled tools. Permissions are checked again at execution, so revocation immediately blocks subsequent calls.

Chat uses progressive tool disclosure: each turn starts with a short capability catalog, and the model loads the required schemas and instructions through `bot_tools`. Loading resets next turn. Persona and channel rules remain active; Web GUI instructions are excluded from bot prompts. New message text omits platform message IDs, and the host resolves memory sources from the current user's exact text. Existing message history is preserved; `/compact` or a new session can reduce older context.

Complete assistant text before a tool call is sent before the tool runs. Once the tools and turn finish, the bot sends the remaining final text and attachments. This applies to all tools in regular chats, scheduled tasks and proactive chats. Reasoning and raw tool JSON are not forwarded. Automatic TTS reads only the final text, excluding the earlier text sent before tools.

Bot IDs accept 1–80 English letters, digits, underscores and hyphens, including digits-only IDs. Credentials are isolated by the original ID in Harness credentials. Existing lowercase-letter-first IDs containing only lowercase letters, digits and hyphens continue to use their existing credentials.

Each bot card has **Delete**, with its name and ID in the confirmation. Deletion stops connections and running tasks, clears account authorization, permanently removes all of the bot's sessions (including old and child sessions), messages, memories, attachments, media jobs and automation records, and removes it from the list. Persona configuration and user working directories remain. The bot ID stays reserved to prevent delayed old operations from regaining its identity; use a new ID for a new bot.

Each chat session in Overview also has **Delete**. Confirmation permanently clears that session and its conversation history while keeping channel attachments and long-term memories. Deleting the current session stops its tasks and creates a blank session with the same model and voice overrides; deleting an older session leaves the current one running. Sessions held by another interface cannot be deleted until that owner releases them.

Directory browsing in Services uses the DSH native directory picker. Selecting a path updates the draft; Save applies it. Windows standalone installation creates `Desktop` within the redirected user profile so system folder dialogs have a valid default location.

Chat files default to `BOT_WORKSPACE_ROOT/<bot-id>/<channel-session-key>/`, or the selected custom working directory. `history/<session-key>/` stores readable JSONL history. `images`, `videos`, `audio` and `files` hold attachments, further organized by `received`, `generated`, `sent` (registered for sending), date, session key and attachment ID. Equal filenames do not overwrite one another. Other model-created artifacts go to `outputs/`; media job temporary files live in `.bot/jobs/` and are cleaned after execution.

The installer places shared databases, original session logs, attachment indexes and engine caches in `BOT_WORKSPACE_ROOT/.runtime/`, retaining native session IDs when moving old data. The standalone launcher assigns workspace-local process home/temp directories to third-party tools. Personas and credentials remain in the configured product data directory. Changing directories moves existing attachments while retaining their IDs. Deleting a bot clears classified attachments and readable history while retaining other user files in its working directory.

Trusted private-chat media operations have no daily call quota or daily cumulative video-analysis duration cap. This includes image/video downloads, image generation, transcription and voice generation. Trust is evaluated both at turn start and execution; newly granted trust applies next turn and revocation applies immediately. Per-file limits, the 300-second video-analysis limit, concurrency and storage limits still apply.

## Edge TTS / GPT-SoVITS / Breeze TTS replies

Enable voice under **Bots → Media → Voice TTS**. Edge TTS needs no API key and produces MP3. GPT-SoVITS and Breeze TTS use operator-registered managed Service Profiles: service addresses, model weights, reference audio or saved Breeze voice IDs remain private. Bots save only the selected profile, enabled state and reply mode. Personas accept V4 only; service addresses and local paths are managed through Profiles. Reference text must match the actual content of the 3–10-second primary reference audio.

**On demand** uses `bot_voice` for reading requests. **Text + voice** appends audio to final chat, scheduled-task and proactive-chat text while retaining the text. An explicit voice attempt in the turn suppresses automatic synthesis. Automatic reading skips code blocks and bare URLs but retains link text. Overlong/unreadable text remains text-only; ordinary synthesis failure shows a notice and returns the text.

Trusted private chats can temporarily change session voices with `/tts` and `/sts`: use `/tts list` or `/sts list`, then `set` with an exact ID. `/tts reset` and `/sts reset` restore bot defaults. TTS supports `edge/<voice>`, GPT-SoVITS and Breeze Profiles; STS supports RVC Profiles. Changes apply next turn without changing bot defaults and cannot enable a disabled capability. Natural-language requests use `bot_voice_control` with the same list/set/reset flow.

GPT-SoVITS queues complete SoVITS loading, GPT loading, reference-audio setup and synthesis in order for each request. It does not cache the current character. Configured versions may be v1, v2, v2Pro, v2ProPlus, v3, v4, v5dev or v5turbo and must match the actual models. Output is non-streaming WAV. Speed is adjustable; style requests degrade to ordinary reading. `chant` and explicit MP3 are unsupported. Built-in voice uses `edge_tts`.

Breeze TTS uses the `breeze-tts-2-cpp` HTTP service, defaulting to local HTTP port 8080; the Services page can change this address. Refresh reads `/v1/voices` and registers saved service voices only. Requests use JSON `response_format=wav` and produce 24 kHz mono WAV. With a trusted Breeze project directory configured, **Start Breeze TTS** runs the fixed `Start-Breeze.ps1` and waits for health checks. Refreshing/closing the plugin does not automatically start/stop Breeze. Chinese and English are officially supported; Japanese input is experimental. Breeze has no speed control; passing speed preserves the text result and records a degradation observation.

**Configured** means parameters are present. Acceptance for the current persona revision comes from a separate actual acceptance record. Inspect the full audio and listen to the target character; repeat acceptance after revision changes.

### Limitations / Known Issues

One bot process exclusively owns each inference service instance. Do not manually switch models or restart it during a task. Restart before initial integration, and when changing the language or v1/non-v1 text-frontend family for existing reference text, to clear old caches. Identical reference text on one service must use a consistent reference language/frontend family. Loading models each time adds latency; client cancellation does not mean computation immediately stops on the server. WeChat currently sends playable audio files.

## RVC voice conversion (STS)

RVC selects models/characters through managed Service Profiles. Service addresses, `.pth` weights and optional `.index` files remain private. Bots store only profile references, enabled state and allowlisted preferences such as pitch/output format. RVC v1/v2 F0 models are supported; retrieval rate is `0` without an index. Enabling adds `bot_sing` and `singing-conversion`. Missing/blocked profiles remain visible and never silently change models.

The adapter uses a Python environment with `rvc` installed and reuses the RVC project's `VoiceConverter` interface. RVC and GPT-SoVITS run separately on different ports, though they may share a compatible Python environment. After installing FFmpeg, HuBERT/ContentVec, RMVPE and character weights, start the supplied adapter:

```powershell
# Run from the plugin directory; set the actual interpreter, RVC root and runtime data directory.
& $env:RVC_PYTHON -B python/rvc_service.py --rvc-root $env:RVC_ROOT --data-dir $env:RVC_DATA_DIR --device cuda --port 9881
```

Use `--device cpu` without CUDA. The service listens only on loopback. **Check service** verifies the adapter protocol. Actual acceptance requires full conversion and listening, followed by recording results for the current configuration revision; editing configuration invalidates reuse of older acceptance.

Users may upload audio (including ordinary WeChat audio files), or search/select public HTTPS audio, Bilibili or Douyin sources. `bot_sing` actions `prepare/list/convert` register, list and convert candidates belonging to the current session. Convert only when the user explicitly identifies isolated vocals. Without separation configured, audio with accompaniment requires isolated vocals instead. Private RVC Profile settings hold the separation model (`vocals` or `vocals-aggressive`), weights, accompaniment remix choice and volume. Separation defaults off; `mixed` input stays blocked until fully configured. Output defaults to MP3 192 kbps, with WAV optional. Input retains a 100 MiB local-processing budget and generated audio supports 200 MiB; oversize output is neither truncated nor silently reformatted.

QQ delivery has a 200 MiB hard limit for images, video, audio and files. Direct upload is used only up to 5,000,000 bytes; larger files use official multipart upload without changing format. Soft limits do not cause local rejection; QQ decides fallback file types. WeChat retains separate limits. Attachment registration, queued delivery and platform-confirmed delivery are distinct states. Rejected uploads fail; only a network interruption after submission leaves an unknown outcome. See [QQ media delivery](docs/en/qq-media-delivery.md) for limits, multipart flow and sources.

Conversion binds the turn's frozen persona. Cancellation terminates the server child-process tree; revoked permissions or a changed session prevent further delivery. Failures do not automatically rerun or switch sources; delivery recovery reuses the attachment. After an STS attempt, automatic TTS does not read the result explanation. See [STS integration](docs/en/singing-conversion-plan.md).

### Limitations / Known Issues

Fully configured separation supports `mixed` input by extracting vocals, converting them and optionally remixing accompaniment. With separation disabled, isolated vocals are still required. RVC character weights are incompatible with GPT-SoVITS weights; validate version, resource completeness and actual voice separately. Public sources may expire; search results do not guarantee downloadable content. Each conversion loads the model independently; time depends on hardware and audio length.

## Music search and download

Music reuses a separate Music project's Python environment through managed JSON subprocess calls. Operators register the project root in a Music Service Profile's private `home`; bots store only the profile reference, `enabled` and `includeLyrics`. Local paths, dependencies and source configuration are neither copied with personas nor exposed to the chat model. Music directories/sources come only from the selected Profile's `home` and `sources`.

Enable **Bots → Media → Music search and download** to add `bot_music` and `music-download`; it defaults off. Users may request the highest matching song by title/artist directly or search then select. Session songs are available for voice conversion. Lyrics default off and can be enabled on the card.

Managed Music Profiles may order `MiguMusicClient`, `KuwoMusicClient`, `QQMusicClient` and `NeteaseMusicClient`. Defaults use only sources verified by full downloads; verify real search and full download before adding a source. Downloads and song-title covers produce complete audio strictly below 20 MB. Compliant MP3 is reused; other formats are fully transcoded according to duration. **Check health** verifies only detectability. Actual download acceptance is separate and binds persona revision, Profile revision/content hash and operation. See [Music integration](docs/en/music-integration.md).

### Limitations / Known Issues

Sources can return no results, previews or failures; search success does not guarantee a full download. Platform format/size limits still apply. Original downloads and sent attachments are processed separately; oversized songs are not truncated. Singing conversion still requires RVC and vocal separation; downloading does not replace a voice model.

## Scheduled tasks and daily proactive chats

Trusted private-chat users can ask “Remind me to drink water in ten minutes,” “Say good night every day at midnight Beijing time,” or “Enable daily proactive chats.” The model saves tasks/settings through `bot_schedule` and `bot_proactive` without requiring host-tool permission. Queries, pause/resume, deletion and proactive settings also support natural language.

Schedules support one-time timestamps, intervals and daily local times in a timezone. Proactive defaults are at most 3 messages/day, quiet hours 00:00–09:00, at least 180 minutes apart and a 30-minute cooldown after the user chats. Saving settings preserves the toggle and other options; the panel shows the next proactive time. Tasks and next-run times recover after restart. Busy sessions delay execution; one-time tasks show completed afterward.

Background tasks use current session history/persona. Stopping the current task cancels a generating background reply; pausing/deleting a schedule prevents subsequent triggers. QQ background messages use proactive-send requests; WeChat uses the session's latest context credential.

## Long-task progress reminders

User-initiated private tasks default to a reminder after 60 seconds, then every 60 seconds with no count limit. They cover attachment preparation, transcription, model waiting and tool execution. Groups, schedules and proactive greetings retain their existing feedback.

Each reminder is at most 80 characters and uses the frozen persona/chat model, without tools or long-term-memory writes. Extra usage appears under **Progress** in statistics. Reminders stop immediately on completion, failure or cancellation; restart does not replay old reminders.

### Limitations / Known Issues

Reminders consume additional model usage. If generation fails or exceeds 8 seconds, a short local stage message is used and its tone may differ. Delivery depends on model latency, network and platform reply quotas/expiry; an unlimited application count does not imply unlimited platform acceptance. Local cancellation cannot recall accepted messages. Schedules/proactive chats require a running host; QQ proactive quotas and WeChat context validity remain platform-controlled. Finished generation means output entered the delivery queue; delivery records determine actual sending status.

## Common commands

```bash
npm run verify:release
```

`verify:release` runs static architecture, types, isolated TypeScript/Python tests, Python dependencies, builds, documentation/contracts/licenses and package checks. Use `npm run release:pack` to create release archives: it runs the same gate first and packages with lifecycle scripts disabled. `prepublishOnly` enforces the gate for `npm publish`. `npm run test:native`, `npm run test:lifecycle-native` and `npm run test:install-smoke` verify full Harness integration and standalone installation.

## Project layout

```text
src/       TypeScript runtime, channels, management API and panel
python/    Media workers
skills/    Image and media skills
packages/  Separately installable auxiliary bundles
scripts/   Build, installation, startup and verification scripts
docs/      Project architecture and usage documentation
tests/     TypeScript and Python tests
```

## License

MIT. See [third-party notices](THIRD_PARTY_NOTICES.en.md) for dependencies and sources.

See the [architecture](docs/en/architecture.md), [architecture boundary contract](docs/en/architecture-boundaries.md) for enforceable dependency directions/composition-root exceptions/extension rules, [ADRs](docs/en/adr/) for long-term decisions, and [AGENTS.md](AGENTS.md) for automation-agent and repository constraints.
