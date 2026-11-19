# RVC voice conversion (STS)

[简体中文](../singing-conversion.md) | English

STS converts selected audio into the bot's chosen RVC voice through `bot_sing` and `singing-conversion`. Reading text uses the separate TTS capability; see [voices and model library](voice-model-library.md).

## Environment and configuration

Provide an RVC Python environment, FFmpeg/ffprobe, HuBERT/ContentVec, RMVPE, RVC v1/v2 F0 weights and an optional matching index. GPT-SoVITS weights cannot be used for RVC. Retrieval rate must be zero without an index; a corrupt configured index fails explicitly.

Enable **Bots → Media → Voice conversion STS** and select an available Profile. Leave speaker ID, pitch in semitones or retrieval rate blank to inherit the corresponding Profile value. Entering `0` overrides that value. Both CLI and HTTP conversions use the bot settings captured when the turn started. The Profile owns model paths, versions, interpreter, device, separator and endpoint. Output defaults to MP3 at 192 kbps. WAV is also supported.

Library-discovered `rvc_cli_v1` Profiles run per job without a persistent service. For `rvc_http_v1`, start the adapter from the plugin directory, setting the variables to your actual paths:

```powershell
& $env:RVC_PYTHON -B python/rvc_service.py --rvc-root $env:RVC_ROOT --data-dir $env:RVC_DATA_DIR --device cuda --port 9881
```

Use `--device cpu` without CUDA. The service listens only on loopback and runs separately from GPT-SoVITS; compatible installations may share a Python environment. Inference uses RVC's `VoiceConverter` API and loads models independently for each job.

## Select a source

| Action | Purpose |
| --- | --- |
| `prepare` | Register current-session audio or real public candidates without downloading or inferring |
| `list` | Show the current candidate set and numbers |
| `convert` | Convert a candidate using its set, number, source type and optional format |
| `sing` | Convert by song/artist or a Music search candidate; see [Music integration](music-integration.md) |

Upload audio, including a decodable ordinary file, or provide a public HTTPS audio, Bilibili or Douyin link. Attachments and candidates must belong to the current session; old candidate numbers cannot select replacement sources. Explicit conversion requests or an awaiting-upload state can bypass initial ASR; ordinary voice messages are still transcribed.

Use `vocals` for pure vocals; confirm accompaniment when the source is unknown. `mixed` requires separation enabled in private RVC Profile configuration, with a `vocals` or `vocals-aggressive` model and weights, plus instrumental mixing/volume preferences. Separation is off by default, requiring pure vocals. Music-library tracks count as mixed audio.

## Output, cancellation and recovery

Local audio input has a **100 MiB** budget; generated audio supports up to **200 MiB**. Named-song conversion produces a complete MP3 strictly below 20,000,000 bytes; explicit-upload conversion may retain WAV. Oversized output fails without truncation or silent format changes. QQ voice segmentation, full-file handling and upload limits are described in [QQ media delivery](qq-media-delivery.md).

Each turn freezes bot and Profile configuration. Revocation, disabling STS or switching sessions prevents subsequent execution and delivery. Each explicit conversion creates an independent job, with multiple calls allowed per turn. Failures do not automatically rerun or switch sources. Cancellation stops controlled processes; if server termination cannot be confirmed, further conversions wait until the service is confirmed idle.

Successful conversion registers a current-session attachment for the persistent delivery queue. Delivery recovery reuses it without inference. Unknown message-submission outcomes are not blindly replayed. An STS attempt suppresses automatic TTS reading of the result explanation for that turn.

## HTTP adapter protocol

| Endpoint | Behavior |
| --- | --- |
| `GET /health` | Protocol, state, active job and queue information; no inference |
| `POST /v1/jobs` | Multipart `audio` and host-frozen JSON `parameters` |
| `GET /v1/jobs/{id}` | Read `queued/running/succeeded/failed/cancelled` |
| `GET /v1/jobs/{id}/result` | Read the complete WAV from a successful job |
| `DELETE /v1/jobs/{id}` | Cancel the process tree and clean partial output |

The service uses a single-slot FIFO. A job ID never repeats inference; an uncertain submission is queried rather than resubmitted. The host supplies paths, identity and model parameters. See [rvc_service.py](../../python/dsh_bot_runtime/rvc_service.py) for the protocol implementation.

## Acceptance and limitations

Complete configuration and successful health checks do not prove voice quality. Convert a full sample, listen to the target voice and record acceptance for the current configuration revision; repeat after changes. Automated tests cannot establish real voice quality or platform delivery; see [testing](testing.md).

Public sources may disappear. Models, separation quality, memory use and inference time depend on the target device and audio duration. Model weights, private service configuration, acceptance audio and runtime records are excluded from release packages.
