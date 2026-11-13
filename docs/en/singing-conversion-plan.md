# RVC Voice Conversion (STS): Integration and Acceptance

[简体中文](../singing-conversion-plan.md) | English

Managed RVC Profiles (`rvc_cli_v1` or `rvc_http_v1`) convert user-selected vocals into the persona-configured RVC target voice. Ordinary TTS uses `media.voice`/`bot_voice`; STS uses `media.singing`, `singing-conversion` and `bot_sing`.

## Runtime and inference entries

The adapter uses the RVC project's public `rvc.vc.engine.VoiceConverter`, `VoiceConversionConfig` and checkpoint interfaces, not Gradio page protocols. The interpreter must have RVC/inference dependencies installed. Separate processes may share a compatible RVC/GPT-SoVITS environment. Service arguments explicitly select `cpu` or `cuda`; CUDA Graph is disabled.

Resources are FFmpeg/ffprobe, matching Transformers HuBERT/ContentVec, RMVPE `rmvpe.pt`, inference `.pth` and optionally a matching `.index`. GPT-SoVITS weights cannot be used for RVC.

```powershell
# Run in the plugin directory with operator-configured variables.
& $env:RVC_PYTHON -B python/rvc_service.py --rvc-root $env:RVC_ROOT --data-dir $env:RVC_DATA_DIR --device cuda --port 9881
```

The service listens on loopback only. Each job runs `python/rvc_runner.py` in a dedicated child process, reading resources via the configuration parent and explicit paths. It validates declared version, `f0=1`, speaker range and index dimension (v1: 256; v2: 768). A configured corrupt index fails rather than silently disabling retrieval. Inference uses RMVPE, `resample_sr=0`, `rms_mix_rate=1.0`, `protect=0.33` and native RVC long-audio processing.

## Persona and Profile configuration

V4 `media.singing` stores `enabled`, `profileRef` and business preferences. It defaults off and requires an available RVC Profile when enabled.

Protocol, address, interpreter, RVC root, model version, `singingWeightsPath`, `singingIndexPath`, `separation.modelPath` are private Profile fields. CLI specifies `python`, `rvcRoot`, `device`; HTTP specifies `baseUrl`. These must not be written back into personas.

The turn freezes the target Profile revision. Disabling STS, revoking tools/skills or changing session prevents later execution/delivery. Model paths/service addresses do not enter model-visible summaries or tool results.

## HTTP protocol and lifecycle

`rvc_http_v1` is this plugin's adapter protocol.

| Endpoint | Behavior |
| --- | --- |
| `GET /health` | Protocol, service state, active job and queued count; no inference |
| `POST /v1/jobs` | multipart `audio` source and `parameters` host-frozen JSON |
| `GET /v1/jobs/{id}` | `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| `GET /v1/jobs/{id}/result` | Full `audio/wav` on success |
| `DELETE /v1/jobs/{id}` | Return after confirming process-tree exit and partial-output cleanup |

JSON contains `jobId`, `modelVersion`, `singingModelId`, `singingWeightsPath`, optional `singingIndexPath`, `speakerId`, `pitchShift`, `indexRate`. The host derives all fields from frozen configuration; the chat model cannot provide paths, identities or endpoints.

A single-slot FIFO covers loading, inference, output validation and cancellation cleanup. The host also serializes by normalized service address. A job ID does not repeat inference; an unknown submission response is queried, never resubmitted. The host cancels directly without relying on a possibly terminated media worker. Unconfirmed stopping records an unknown service state and blocks conversions until idle is confirmed.

## Candidates, input and delivery

`bot_sing` actions:

- `prepare`: register a session audio attachment or up to five real search candidates; no download/inference. Empty input means waiting for an upload.
- `list`: current set, numbered candidates, titles and public sources.
- `convert`: set ID, candidate number, source type and optional format.

`action=sing` with `song/artist` asks Music for the best match; `candidateSet/candidate` from `bot_music search` retains explicit selection. An acquired same-song source in the session is reused, not redownloaded or compressed first. Catalog songs are mixed; the RVC Profile must be available and the adapter validates separation. Final WAV is directly encoded into a complete MP3 strictly below 20,000,000 bytes. See [Music integration](music-integration.md).

Explicit public HTTPS audio, Bilibili and Douyin links keep the prepare/convert path and underlying download/audio extraction, without triggering video delivery. Retain public provenance and available licensing information; ordinary HTML is not audio.

Candidates are stored in repository records bound to scope, session, generation and a separate set ID. Old candidate numbers cannot select later replacement sources. Attachments must belong to the session and be `audio` or a `file` actually decoded by the worker. An explicit conversion request in user text or registered waiting-for-upload state may bypass initial ASR. Quotes/web content cannot trigger that bypass; ordinary voice still transcribes automatically.

`vocals` runs RVC; `unknown` asks about accompaniment; `mixed` without configured separation is rejected with a request for vocals. Fully configured RVC/PyMSS first separates vocals, then uses `instrumentalMix`/`volume` to decide accompaniment remixing. STS enabled state, `bot_sing` and `singing-conversion` are all required. Media tools cannot bypass the dedicated singing-conversion entry.

A conversion attempt is created before initial download/inference. Re-preparing candidates cannot reset it. Success reuses the result; failure/cancellation/unknown does not retry or switch candidates automatically. A new explicit user request is required for a new attempt.

The service returns WAV. The worker produces selected WAV or MP3 192 kbps and checks full decoding, valid samples, non-silence, duration match and size. Input has a 100 MiB local budget; generated audio and QQ delivery support 200 MiB. Video-source download limits apply before extracted-audio limits. QQ preparation preserves the original product and creates SILK bubbles of at most 300 seconds each. Longer audio is segmented and also sent as a full MP3 without losing the tail. Direct upload is limited to 5,000,000 bytes; larger files use official multipart.

Success registers one audio Asset for the scope/session and uses the durable queue. Delivery recovery reuses it rather than rerunning inference, preserving `unknown` semantics. Tool results contain safe state, filename and format, not internal paths or Asset IDs. An STS attempt suppresses extra automatic TTS of its explanation.

## Management and acceptance

The STS media card has independent settings. Enabling adds required tools/skills; disabled incomplete drafts can be saved. It shows:

- Configuration completeness, which does not prove the model runs.
- Protocol validation: `skill.singing.probe` reads `/health` and records `singing_protocol`.
- Actual voice acceptance: fully convert, inspect and listen, then record `singing` evidence with `capability.record`.
- Separation protocol/model ID/path completeness/remix/volume; off by default, permitting `mixed` when complete.

Records bind persona ID/revision; changes show not-yet-accepted. Tests cover candidate/attachment ownership, ASR compatibility, triple permissions, frozen inputs, one attempt, output limits, protocol state, FIFO cancellation and attachment reuse. Before packaging:

```text
npm run typecheck
npm test
npm run test:python
npm run build
npm run check:release
```

Protocol/mocks establish interfaces and lifecycle only. Actual character acceptance separately records output duration, conversion time and listening results. Synthetic model tests are not real voice acceptance. Local service config, weights, runtime records and generated audio do not enter release archives.

## Limitations / Known Issues

- Separation uses the current RVC/PyMSS runner; verify model completeness and audio quality on target hardware.
- Operators supply real models, HuBERT, RMVPE and indexes, checking version/resource availability on target hardware.
- Reloading per task adds time; throughput/memory depend on device, model and audio length.
- Search/public sources can expire; a candidate is not proof of download or conversion success.
