# Configuration Reference

[简体中文](../configuration.md) | English

This page documents only configuration read by current code/tests. Setting an unlisted environment variable does not add support for it. The UI supports Chinese and English; personas accept only `schemaVersion: 4`.

## Precedence and general rules

- The installer/launcher inject product-profile directories together; existing Harness profiles do not automatically adopt them.
- The Services panel owns the image endpoint, model and **key environment-variable name**, never the key value; persona/bot media settings only select the image protocol. Legacy persona fields remain readable as a fallback for older installations without service settings.
- QQ/WeChat, chat-model and media-analysis credentials belong to Harness credentials or controlled worker injection, not personas, repositories, CLI arguments or archives.
- Environment changes do not increment persona revisions and usually require restarting the inheriting Harness/product process. Persona edits create revisions; bot settings save independently. Both apply next turn.
- Directory variables have defaults; set them before installation/start only when overriding. Use no real absolute paths in Issues, logs or examples.

## Product and runtime directories

Standalone scripts directly accept only `BOT_HOME`, `BOT_WORKSPACE_ROOT` and `BOT_PYTHON` for operator directory configuration. Children receive fixed `DSH_HOME=BOT_HOME`, `DSH_AGENTS_HOME=BOT_HOME/agents`, `BOT_PERSONAS_ROOT=BOT_HOME/personas`, and `BOT_DATA_HOME=BOT_WORKSPACE_ROOT/.runtime/storages/bot-integration`. External values with those names do not override product layout. Only existing-Harness/direct-plugin launches use their individual defaults.

None of the variables below changes persona revisions.

| Variable/configuration | Sensitivity | Default behavior and scope | Restart | Standalone-only? | Package/Issue guidance |
| --- | --- | --- | --- | --- | --- |
| `BOT_HOME` | Path may reveal private information | Product root; defaults to working-directory `.runtime/bot-data`; used by launcher, lifecycle and installation records | Yes | Primarily | Use `<absolute-product-home>` placeholders |
| `DSH_HOME` | Path may be private | Existing-Harness/direct-plugin data-root fallback; participates in plugin-directory derivation. Standalone fixes it to `BOT_HOME` | Yes | No | Names/placeholders only |
| `BOT_DATA_HOME` | Path may be private | Existing/direct-plugin SQLite directory, ahead of `DSH_HOME` derivation. Standalone fixes workspace `.runtime/storages/bot-integration` | Yes | No | No real paths |
| `BOT_WORKSPACE_ROOT` | Path may be private | Defaults to working-directory `.runtime/workspaces`; first standalone install writes `BOT_HOME/workspace.json`, reused at startup. Sessions, attachments, caches and worker workspaces | Yes | No | No real/database/log paths |
| `BOT_PERSONAS_ROOT` | Path may be private | Existing/direct-plugin persona root, otherwise derived from plugin data. Standalone fixes `BOT_HOME/personas` | Yes | No | No real paths |
| `DSH_AGENTS_HOME` | Path may be private | Harness agents; standalone injects `BOT_HOME/agents`, not an independent operator setting | Yes | Primarily | No real paths |
| `BOT_PYTHON` | Nonsensitive config | Media interpreter; existing Harness defaults to `python`, standalone to `BOT_HOME/media-venv`. Requires Python 3.12/3.13 and base requirements | Yes | No | Name only, no local interpreter path |
| `BOT_IMAGE_BASE_URL` | Endpoint may expose operations | OpenAI-compatible image URL saved by the Services panel; otherwise `https://api.openai.com/v1`. Legacy persona URLs are fallback only | Yes | No | Safe placeholders only |
| `BOT_IMAGE_MODEL` | Nonsensitive config | OpenAI image model saved by the Services panel; otherwise `gpt-image-2`. Legacy persona models are fallback only | Yes | No | Model placeholders, no private model paths |
| `BOT_IMAGE_KEY_ENV` | Variable name is public; referenced value secret | Actual key variable name; absent explicit setting prefer `IMAGE_ACCESS_KEY`, accept `SAKURA_IMAGE_API_KEY`, then default name `IMAGE_ACCESS_KEY` | Yes | No | Variable names only, never values |
| `IMAGE_ACCESS_KEY` | **Secret** | Default actual image key, read only by backend process | Yes | No | Exclude from packages, Issues, logs and `.env.example` |
| `SAKURA_IMAGE_API_KEY` | **Secret** | Compatibility alias used only without `IMAGE_ACCESS_KEY` | Yes | No | No real values |
| `SAKURA_IMAGE_BASE_URL` / `OPENAI_BASE_URL` | Endpoint | Legacy image URL aliases, lower priority than `BOT_IMAGE_BASE_URL` | Yes | No | Placeholders only |
| `SAKURA_IMAGE_MODEL` | Nonsensitive config | Legacy model alias, lower priority than `BOT_IMAGE_MODEL` | Yes | No | Placeholders only |
| `BOT_ANALYSIS_API_KEY` | **Short-lived secret** | Fixed ASR/media worker injection name. Key comes from Harness model-provider credentials and is injected for each subprocess, not operator-supplied | No manual setting/restart | No | No real/fabricated values; not public configuration |
| `BOT_VOICE_MODELS_ROOT` | Path may be private | Initial voice-library root; saved panel settings win. Models/weights/reference audio remain external | Yes, or reopen/refresh service | No | No real/weight paths or files |
| `BREEZE_TTS_URL` | Nonsensitive config | Default Breeze-TTS-2.cpp HTTP address; saved panel address wins | Yes, or reopen/refresh | No | Placeholders; no credentials/runtime logs |
| `GPT_SOVITS_ROOT` | Path | Default external GPT-SoVITS startup directory; saved panel value wins. Used only by explicit Start, never automatic | Yes | No | Placeholders only |
| `BREEZE_TTS_ROOT` | Path | Default external Breeze startup directory; saved panel value wins. Explicit Start only | Yes | No | Placeholders only |
| `BREEZE_TTS_VOICES_ROOT` | Path | Default `.breeze` directory; saved panel value wins; refresh discovers saved voices | Yes, or refresh | No | Placeholders only |
| `BOT_LAUNCH_TOKEN` | **Runtime secret nonce** | Random per `scripts/start.mjs` launch for local launcher/bot/lifecycle IPC stop/ready/restart handshake; never fix manually | Launcher-managed | Yes | Never record, copy or commit |
| `BOT_OPEN_DIRECTORY` | Short-lived private path | Windows Open directory injects a validated path into a PowerShell helper; not user configuration | Per action | No | No real values or `.env.example` entry |

`BOT_IMAGE_BASE_URL` must be HTTPS without credentials, query or fragment for OpenAI-compatible services. ComfyUI uses the local `comfyUiBaseUrl` and API workflow path saved in the Services panel. Image key variable names must be uppercase. See the [image-generation skill](../../skills/image-generation/SKILL.md).

## Installer, launcher and Harness variables

These do not change persona revisions.

| Variable/argument | Sensitivity | Purpose/default | Restart | Scope | Package/Issue guidance |
| --- | --- | --- | --- | --- | --- |
| `BOT_INSTALL_LAYERS` | Nonsensitive | Layer list; `--layers=` wins. Defaults to required `core,basic-media`; optional `voice-generation`, `music`, `singing-rvc` | Reinstall | Standalone installer | Layer names, no local paths |
| `BOT_SOURCE_ROOT` | Path | Source-root override for local source/test/rollback validation; not normal release installation | Reinstall | Development/test/rollback | No real paths |
| `DSH_PROFILE` | Harness/CLI-managed | Selected profile; plugin does not read it, define a default or write credentials | Harness-managed | Existing Harness/CLI | `<profile>` only |
| `DSH_PROFILE_DIR` | Harness-managed private path | Current profile directory; plugin does not read it or define a default | Harness-managed | Existing Harness/CLI | No real paths |
| `DSH_SESSION_ID` | Runtime identifier | Harness test isolation; not plugin configuration | Harness-managed | Harness/testing | No real session IDs |
| `DSH_WEB_URL` | Runtime information | Harness-managed Web URL; not a product endpoint setting | Harness-managed | Harness/testing | No real URLs |

Existing profiles use `dsh plugin --profile <profile> add .`; standalone profiles use `scripts/install.mjs`, `scripts/start.mjs`, `scripts/stop.mjs`. Do not forge profile identity with environment variables.

## Plugin Config (not environment variables)

TTS and STS voices are independent. Refresh under **Bots → Media** scans saved library settings without first saving the draft. Voice selection remains in the bot draft with other edits until **Save**, then applies next turn. Addresses/directories save on **Services**. ASR/video understanding follow the bot's chat model; ASR can independently select chat or transcription protocol.

**Processing replies** under **Bots → Run** controls stage notices during unfinished private tasks. It defaults on, at 60-second intervals configurable from 10–3600 seconds; off sends final results only.

`bot.settings` independently stores models, media, reply behavior, image style, tools and skills. Existing bots copy settings once from their V4 persona on first load. Later `bot.save` preserves settings when absent and replaces them in full when supplied. Persona files retain V4 and legacy runtime fields for reading compatibility, but those fields cannot overwrite migrated bot settings. Personas edits ID, name, prompt and files only; switching preserves bot settings and session overrides.

The main Config schema has these fields, configurable in the Harness bundle:

| Field | Default/purpose | Restart | Persona revision |
| --- | --- | --- | --- |
| `dataDir` | Bot runtime directory; absent value derives from `BOT_DATA_HOME`, `DSH_HOME` and `.runtime/bot-data` | Plugin reload | No |
| `python` | Media worker interpreter; otherwise `BOT_PYTHON` or `python` | Plugin reload | No |
| `debounceMs` | Merge delay for inbound messages in one session; `2000` ms, range `0–60000` | Plugin reload | No |
| `autoStart` | `true`; `false` loads panel/configuration/history and waits for explicit service start before channels/background tasks | Plugin reload | No |
| `messageLocale` | `zh` (default) or `en` for all bots' help/results/errors/progress. Saves immediately under **Services → Bot service**, persisted by Harness | No; subsequent operations | No |

### Language scopes

UI follows Harness `locale.preference` independently of global `messageLocale`. UI switching does not rewrite system-message settings, personas, drafts or TTS `promptLang`/`textLang`.

Commands, ordinary turns and each automation run capture system-message language at start. Active tasks, queued session actions and their restart recovery retain that language. Recurring tasks use the latest setting on the next run. Old configuration/records without a language field mean Chinese; generated messages are neither retranslated nor resent.

Panel-created personas receive initial text once in the current UI language. Fresh-install built-in personas preserve identity/behavior but follow user/conversation language rather than requiring Chinese. Existing installations' personas are not rewritten. Built-in skills/model operation instructions use one English source; normal replies follow persona/user requirements.

## Development/test-only variables

These are read by test runners, not user configuration; do not copy them into production `.env` or Issues: `CI_PYTHON`, `BOT_TEST_PYTHON`, `BOT_TEST_TMP`, `BOT_TEST_WEB_TOOLS_SOURCE`, `BOT_TEST_IMAGE_KEY`, `NATIVE_TEST_RESULT`, `LIFECYCLE_NATIVE_FOLDER`. Runners also clear or temporarily set isolation variables such as `HOME`, `TEMP`, `npm_config_store_dir`.

## Contents excluded from environment/release files

Do not put QQ/WeChat tokens, account/user/group IDs, Harness credentials, API keys, cookies, signed URLs, databases, full logs, weights or absolute local paths into `.env`, personas, Issues, PRs or npm archives. `.env.example` contains names, empty values and safe guidance only; it is not a credential template. See [security](../../SECURITY.en.md) and [support](../../SUPPORT.en.md).
