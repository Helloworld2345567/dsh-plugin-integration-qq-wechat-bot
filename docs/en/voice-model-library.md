# Speech and local voice model library

[简体中文](../voice-model-library.md) | English

Configure installation-wide models and inference services in **Services**, then choose separate TTS speaking and STS singing voices under **Bots → Media**. Operators manage services, weights and local paths; bot settings retain Profile references and business preferences.

## Configure the library

Set the shared project's `models` directory, GPT-SoVITS endpoint and any required Breeze endpoint, voice directory and launch directory. GPT-SoVITS defaults to local port 9880; Breeze defaults to 8080. Environment variables in the [configuration reference](configuration.md) can supply initial defaults; saved panel settings take precedence.

The scanner treats the model root's parent as the external project root and uses its `.codex/venv`, `RVC` and `GPT-SoVITS` layout. Organize models by service, character and version:

```text
models/
  rvc/character/v2/
    model.pth
    model.index
    model.json
  gpt-sovits/character/v4-zh/
    gpt.ckpt
    sovits.pth
    references/default.wav
    model.json
```

Click **Refresh** after adding models. The scanner creates or updates `model.json`, preserving stable IDs, names, versions, relative paths and reference text/language; moving the whole library does not require new IDs. RVC indexes are optional, with retrieval rate zero when absent. GPT-SoVITS needs paired GPT/SoVITS weights and valid reference audio/text. Split directories or correct `model.json` when resources are ambiguous, corrupt or have duplicate IDs; the scanner does not guess a pair.

HuBERT, RMVPE, text encoders and base models retain the external project's layout instead of being copied per character. Saving settings returns immediately while relevant scanning runs in the background. Refreshing unchanged resources preserves Profile revisions. After replacement and refresh, old turns cannot execute with the old resource revision.

Breeze discovers voices through `/v1/voices` and `.breeze` files in its configured directory. Offline discovery can display voices before the service runs; synthesis still requires an online service. Refresh never starts services automatically. A configured trusted launch directory enables a button that runs the fixed launcher and waits for health. On Windows, long-running services detach from DSH/Harness's direct process tree and are not stopped when the plugin exits. RVC and Music run per job and have no persistent-service button.

## Choose voices and reply modes

Selecting a voice updates the bot draft, enables its capability and adds the required tool/skill. **Save** applies it from the next turn. Missing, disabled or incomplete Profiles cannot be applied, and the plugin never silently substitutes another model.

TTS offers two reply modes:

- **On demand** calls `bot_voice` when the user requests speech.
- **Text plus automatic voice** adds audio for final text in chat, scheduled tasks and proactive conversations. Explicit voice or STS attempts suppress duplicate automatic speech for that turn. Code blocks and bare URLs are skipped while link labels are retained; text remains available when it is too long, has no readable content or synthesis fails.

| Provider | Configuration and output | Limitations |
| --- | --- | --- |
| Edge TTS | Install the [optional voice dependencies](python-dependencies.md); no API key; MP3 output | Uses the built-in `edge_tts` protocol |
| GPT-SoVITS | Profile contains endpoint, paired weights and 3–10 seconds of reference audio with matching text; non-streaming WAV with speed control | Style requests degrade to ordinary reading; no `chant` or explicit MP3 |
| Breeze TTS | Saved voices from `breeze-tts-2-cpp`; JSON `response_format=wav`; 24 kHz mono WAV | Chinese and English are officially supported, Japanese is experimental; speed requests have no effect and are recorded as degraded |

GPT-SoVITS supports v1, v2, v2Pro, v2ProPlus, v3, v4, v5dev and v5turbo; the configured version must match the weights. Each queued request fully loads SoVITS, GPT and reference audio without caching a current character. One bot process exclusively owns an instance; do not manually switch models or restart it during jobs. Restart before initial integration and when changing the language or v1/non-v1 text frontend family for identical reference text. Identical reference text should use a consistent language/frontend family. Client cancellation does not guarantee immediate server-side termination.

See [QQ media delivery](qq-media-delivery.md) for voice bubbles and long audio. WeChat sends playable audio files. RVC setup and separation are covered in [STS integration](singing-conversion.md).

## Temporary session voices

Trusted private chats first use `list`, then `set` with the exact returned ID; `reset` restores the bot default:

```text
/tts list
/tts set edge/zh-CN-XiaoxiaoNeural
/tts set gpt-sovits/<profileId>
/tts set breeze-tts/<profileId>
/tts reset
/sts list
/sts set rvc/<profileId>
/sts reset
```

These commands store only session overrides and apply from the next turn. New sessions, restored history and persona switches retain overrides. Profiles must be `ready` and the bot must already have the capability enabled; commands cannot enable it. Natural-language switching uses `bot_voice_control` with the same list/set/reset flow.

## Acceptance

Discovery, complete configuration and health checks do not establish voice quality. Check the complete audio and listen to the target character before recording synthesis acceptance for the current configuration revision; repeat after changes. In particular, verify reference text inferred from filenames against the actual audio. Missing voices, unavailable services and invalid formats are reported explicitly without provider fallback.
