# Configuration Reference

[简体中文](../configuration.md) | English

This page documents only configuration read by current code/tests. Setting an unlisted environment variable does not add support for it. The UI supports Chinese and English; personas accept only `schemaVersion: 4`.

## Precedence and general rules

- Personas own prompts and files; each bot stores its model, replies, media, tool and skill permissions. Bots can share personas; switching preserves history, bot settings and session overrides.
- Persona edits create revisions; bot settings save independently. Both apply next turn, while running turns keep frozen configuration. Existing bots copy runtime settings once from their V4 persona; later legacy persona-field edits cannot overwrite them.
- Configure image services under Services and select them in bot media settings; other media use managed Service Profiles. Harness credentials owns QQ/WeChat, chat-model and media-analysis credentials.

## Product and runtime directories

Environment variables do not change persona revisions; changes normally require restarting the process that inherits them. Configure paths locally and use placeholders in public reports.

Standalone scripts directly accept only `BOT_HOME`, `BOT_WORKSPACE_ROOT` and `BOT_PYTHON` for operator directory configuration. Children receive fixed `DSH_HOME=BOT_HOME`, `DSH_AGENTS_HOME=BOT_HOME/agents`, `BOT_PERSONAS_ROOT=BOT_HOME/personas`, and `BOT_DATA_HOME=BOT_WORKSPACE_ROOT/.runtime/storages/bot-integration`. External values with those names do not override product layout. Only existing-Harness/direct-plugin launches use their individual defaults.


| Variable/configuration | Default behavior and scope | Restart |
| --- | --- | --- |
| `BOT_HOME` | Product root; defaults to working-directory `.runtime/bot-data`; used by launcher, lifecycle and installation records | Yes |
| `DSH_HOME` | Existing-Harness/direct-plugin data-root fallback; participates in plugin-directory derivation. Standalone fixes it to `BOT_HOME` | Yes |
| `BOT_DATA_HOME` | Existing/direct-plugin SQLite directory, ahead of `DSH_HOME` derivation. Standalone fixes workspace `.runtime/storages/bot-integration` | Yes |
| `BOT_WORKSPACE_ROOT` | Defaults to working-directory `.runtime/workspaces`; first standalone install writes `BOT_HOME/workspace.json`, reused at startup. Sessions, attachments, caches and worker workspaces | Yes |
| `BOT_PERSONAS_ROOT` | Existing/direct-plugin persona root, otherwise derived from plugin data. Standalone fixes `BOT_HOME/personas` | Yes |
| `BOT_PYTHON` | Media interpreter; existing Harness defaults to `python`, standalone to `BOT_HOME/media-venv`. Requires Python 3.12/3.13 and base requirements | Yes |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, or the variable selected in Services | Credential source for image services; OpenAI reads `openAiKeyEnv`, Google Gemini reads `googleKeyEnv`, defaulting to `OPENAI_API_KEY` and `GEMINI_API_KEY` respectively. ComfyUI does not use a key | After changing the value |
| `BOT_VOICE_MODELS_ROOT` | Initial voice-library root; saved panel settings win. Models/weights/reference audio remain external | Yes, or reopen/refresh service |
| `BREEZE_TTS_URL` | Default Breeze-TTS-2.cpp HTTP address; saved panel address wins | Yes, or reopen/refresh |
| `GPT_SOVITS_ROOT` | Default external GPT-SoVITS startup directory; saved panel value wins. Used only by explicit Start, never automatic | Yes |
| `BREEZE_TTS_ROOT` | Default external Breeze startup directory; saved panel value wins. Explicit Start only | Yes |
| `BREEZE_TTS_VOICES_ROOT` | Default `.breeze` directory; saved panel value wins; refresh discovers saved voices | Yes, or refresh |

The host injects `BOT_ANALYSIS_API_KEY` from Harness credentials per task; the launcher generates `BOT_LAUNCH_TOKEN`; directory-opening actions temporarily inject `BOT_OPEN_DIRECTORY`. Do not set, record or commit these runtime values.

The OpenAI and Google addresses saved in the Services panel must be HTTPS without credentials, query or fragment. The key field stores only an uppercase environment-variable name, never its value. Google defaults to `https://generativelanguage.googleapis.com/v1beta`, model `gemini-2.5-flash-image`, and key variable `GEMINI_API_KEY`. ComfyUI uses the saved local `comfyUiBaseUrl` and API workflow path. Direct script calls use `--protocol`, `--base-url`, `--model` and `--workflow` for the relevant settings; `--api-key-env` selects the credential variable. A missing selected credential fails without trying another variable. See the [image-generation skill](../../skills/image-generation/SKILL.md).

Address, model, protocol and workflow are explicit arguments, without environment fallbacks. OpenAI-compatible and Google requests can set `image_generation.model` for one operation without changing defaults or automatically switching models on failure; ComfyUI models come from the workflow.

### Session image service selection

In trusted private chats, `/image` or `/image list` shows the current-turn and next-turn image services and session override state. Switch with `/image openai`, `/image comfyui`, or `/image google`; protocol names are case-insensitive. Natural requests such as “switch the image service to Google” use `bot_image_control` with the same behavior.

Selection precedence is session override → bot image settings → global Services default. `/image reset` clears the session override. Changes apply next turn; running generation keeps its original service. Switching and requesting an image in the same message still uses the original service for that turn.

Overrides survive restarts, new or cleared sessions, and persona switches. Restoring history uses that session's saved selection. Disabled image capabilities prevent setting a service, but queries and clearing overrides remain available. Commands only select existing service configuration: they do not change addresses, keys, models or workflows, probe service health, or automatically switch services after generation failures.

## Installer, launcher and Harness variables

`BOT_INSTALL_LAYERS` defaults to required `core,basic-media`, with optional `voice-generation`, `music`, `singing-rvc`; CLI `--layers=` takes priority. `BOT_SOURCE_ROOT` is for source installation, testing and rollback validation only.

Harness manages `DSH_PROFILE`, `DSH_PROFILE_DIR`, `DSH_SESSION_ID` and `DSH_WEB_URL`; they are not plugin settings. Existing Harness installs with `dsh plugin --profile <profile> add .`; standalone products use `scripts/install.mjs`, `scripts/start.mjs` and `scripts/stop.mjs`.

## Plugin Config (not environment variables)

TTS and STS voices are independent. Refresh under **Bots → Media** scans saved library settings without first saving the draft. Voice selection remains in the bot draft with other edits until **Save**, then applies next turn. Addresses/directories save on **Services**. ASR/video understanding follow the bot's chat model; ASR can independently select chat or transcription protocol.

**Processing replies** under **Bots → Run** controls stage notices during unfinished private tasks. It defaults on, at 60-second intervals configurable from 10–3600 seconds; off sends final results only.

The main Config schema has these fields, configurable in the Harness bundle:

| Field | Default/purpose | Restart |
| --- | --- | --- |
| `dataDir` | Bot runtime directory; absent value derives from `BOT_DATA_HOME`, `DSH_HOME` and `.runtime/bot-data` | Plugin reload |
| `python` | Media worker interpreter; otherwise `BOT_PYTHON` or `python` | Plugin reload |
| `debounceMs` | Merge delay for inbound messages in one session; `2000` ms, range `0–60000` | Plugin reload |
| `autoStart` | `true`; `false` loads panel/configuration/history and waits for explicit service start before channels/background tasks | Plugin reload |
| `messageLocale` | `zh` (default) or `en` for all bots' help/results/errors/progress. Saves immediately under **Services → Bot service**, persisted by Harness | No; subsequent operations |

### Workspaces and attachment cleanup

A bot's custom Workspace path is a root. Both default and custom roots append `<botId>/<scopeKey>`; Agents work under `sessions/<sessionId>/`, with ordinary artifacts in `outputs/`. The channel media library remains separate, so new sessions can reuse retained media by attachment ID. The panel shows resolved directories.

Workspace provides registered-byte statistics, kind/origin/cutoff filters, a cleanup preview and keep markers. Cleanup only removes selected registered attachments, protecting current sessions, active tasks, pending or retryable deliveries and kept items. Session deletion removes its session directory and registered attachments, retaining attachments still used by other sessions. Overview exports readable JSONL on request instead of rewriting it after every turn.

Deleting the current session stops its tasks and creates a blank session retaining model/voice/image-service overrides; deleting an older session leaves the current one unaffected. Session deletion also removes its attachments marked as kept. Attachments still used by other sessions, user files outside session directories and long-term memories remain. Bot deletion stops tasks, removes authorization and permanently clears its sessions, messages, memories, attachments, media jobs and automation records, retaining personas and other user files. The old bot ID stays reserved; use a new ID for a new bot.

### Language scopes

UI follows Harness `locale.preference` independently of global `messageLocale`. UI switching does not rewrite system-message settings, personas, drafts or TTS `promptLang`/`textLang`.

Commands, ordinary turns and each automation run capture system-message language at start. Active tasks, queued session actions and their restart recovery retain that language. Recurring tasks use the latest setting on the next run. Old configuration/records without a language field mean Chinese; generated messages are neither retranslated nor resent.

Panel-created personas receive initial text once in the current UI language. Fresh-install built-in personas preserve identity/behavior but follow user/conversation language rather than requiring Chinese. Existing installations' personas are not rewritten. Built-in skills/model operation instructions use one English source; normal replies follow persona/user requirements.

## Development/test-only variables

See [testing](testing.md) for interpreter, temporary-directory and native-test variables; do not copy them into production configuration.

## Contents excluded from environment/release files

Do not put QQ/WeChat tokens, account/user/group IDs, Harness credentials, API keys, cookies, signed URLs, databases, full logs, weights or absolute local paths into `.env`, personas, Issues, PRs or npm archives. `.env.example` contains names, empty values and safe guidance only; it is not a credential template. See [security](../../SECURITY.en.md) and [support](../../SUPPORT.en.md).

## Schedules, proactive conversations and progress

Trusted private users can manage tasks in natural language, such as “remind me in ten minutes,” “say good night daily at midnight Beijing time” or “enable daily proactive chats,” without enabling local tools. Schedules support one-off, interval and daily zoned times, survive restarts and defer while busy. Proactive conversations default off; enabled defaults are three per day, quiet hours 00:00–09:00, at least 180 minutes apart and a 30-minute cooldown after user activity.

Background tasks use the current session's history/persona and require a running host. Stopping the current task cancels reply generation; pausing/deleting the schedule stops future triggers. QQ proactive quotas and WeChat context validity are platform-controlled. Generation completion does not confirm delivery; consult delivery records.

Processing replies calls the turn's chat model for private stage notices, falls back to local text on failure and stops on completion/cancellation. Groups, scheduled tasks and proactive conversations do not use these notices.
