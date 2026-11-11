# Local Voice Model Library

[简体中文](../voice-model-library.md) | English

Manage installation-wide services on **Services**, then select registered voice Profiles under **Bots → Media**. TTS and STS have separate voice selectors. Services provides:

- **Model directory:** shared TTS/STS project's `models` directory.
- **Service address:** HTTP inference endpoint.
- **Breeze TTS address:** `breeze-tts-2-cpp`, default local HTTP port 8080.
- **Startup directory:** optional, explicitly operator-configured external project for starting GPT-SoVITS/Breeze; arbitrary commands are not accepted.
- **Breeze TTS voice directory:** saved `.breeze` files, such as the external project's `voices`. Refresh detects them even with Breeze stopped; synthesis still requires the service.

Click **Save**. The built-in scanner treats the model root's parent as the operator's external project root, reading its managed `.codex/venv` Python environment and relative `RVC`/`GPT-SoVITS` layout. These directories/weights are not in the main package. Breeze discovery reads `/v1/voices` and scans the configured `.breeze` directory; health/synthesis require a running service. Refresh/synthesis do not auto-start services. Only a configured startup directory plus its Start button runs a fixed external launcher and waits for health. Initial defaults may come from `BOT_VOICE_MODELS_ROOT`, `BREEZE_TTS_URL`, `GPT_SOVITS_ROOT`, `BREEZE_TTS_ROOT`, `BREEZE_TTS_VOICES_ROOT`; saved settings take precedence. Filenames and `<external-project>` below are sanitized examples, not real paths or bundled weights.

## Organize and add models

The shared project exposes `scripts/model_catalog.py`; the bot uses the same scanning logic. Organize by service, character ID and version:

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

Put each new model in its own directory and refresh. The scanner checks file contents/relationships and generates `model.json`, retaining Chinese display names, stable IDs, versions, relative paths and reference text/language. Metadata stays with the model; moving the library does not rebuild IDs.

RVC indexes are optional, with zero retrieval without one. GPT-SoVITS requires GPT/SoVITS weights and valid reference audio/text. One resource set can pair automatically; multiple weights, ambiguous references or corrupt files produce missing/ambiguous status. Split models or complete generated metadata and refresh; the system never guesses another resource set.

Shared HuBERT, RMVPE, text encoders, GPT-SoVITS base models and vocoders retain the external project's layout rather than being copied into every character folder.

## Select a voice

In a bot's Media section, select TTS **Speak** and STS **Sing** voices separately. Selection updates the bot draft, enables the capability and adds tools/skills. GPT-SoVITS/Breeze use WAV; other settings remain. **Save** applies next turn; discarding restores previous settings.

Incomplete, missing-file or disabled Profiles cannot be applied. Services centralizes directories, addresses, refresh and startup. Refresh neither starts a service nor switches voices. RVC is a per-task worker and Music a per-task tool; neither has a persistent-service button.

## Session voice commands

Trusted private chats can override voices for the current session, effective next turn, without changing bot defaults. The current turn keeps its frozen selection.

```text
/tts list
/tts set edge/zh-CN-XiaoxiaoNeural
/tts set gpt-sovits/<profileId>
/tts reset

/sts list
/sts set rvc/<profileId>
/sts reset
```

`list` returns current selection and candidates. Edge voices are built in; Profile candidates expose only public IDs, names and states. STS lists RVC Profiles only. `set` requires an exact listed ID and a `ready` Profile. The bot must already enable TTS/STS; commands cannot enable it. `reset` removes the override and restores bot defaults. Overrides survive new/restored sessions and persona switches.

## Interfaces and revisions

- `service.settings`: library settings, startup directories, configuration revision and per-model diagnostics.
- `service.settings.save`: save `modelsRoot`, addresses, GPT-SoVITS/Breeze startup directories, Breeze voice directory and `expectedRevision`, then refresh models/voices.
- `service.start`: accepts only `gpt-sovits` or `breeze-tts`; runs the configured fixed launcher, returns `already-running` when applicable; plugin exit does not stop the external process.
- `service.refresh`: refresh `rvc`, `gpt-sovits` or `breeze-tts`; RVC/GPT-SoVITS share a scan, Breeze reads its HTTP voices.
- `catalog.profiles`, `service.health`, `bot.save`: list, check and save bot settings respectively.

Resource digests/discovery sources stay in private Profile metadata; adapters receive execution config only. Identical refreshes create no revision; changing one character does not affect another, and training logs do not affect identity. Once original paths are replaced and refreshed, older turns cannot execute with old resource versions; later turns use the new revision.

## Limitations / Known Issues

Scanning and listing Breeze voices do not establish inference acceptance. Operators must verify filename-derived reference text against audio. Unclear formats, duplicate IDs and ambiguous resources require correcting the model package. Stopped Breeze, deleted voices or non-WAV output make a Profile unavailable; there is no automatic provider fallback.
