# Operations Troubleshooting

[简体中文](../troubleshooting.md) | English

Identify the installation mode, versions and failing stage before choosing a remedy. Public reports should contain sanitized codes, states and necessary versions, not credentials, full logs, databases, attachments, user IDs, signed URLs or local paths. See [support](../../SUPPORT.en.md).

## 1. Plugin absent from Harness settings

Confirm Harness `0.2.1-rc.5`, the profile used during installation and an enabled main bundle. Reinstall through the [existing-Harness guide](install-existing-harness.md) and restart; standalone products use the [product installer](deploy-product-profile.md). Resolve build/release-gate failures first instead of editing profile manifests manually.

## 2. Inactive Host row or profile

Start existing Harness with the matching `--profile <profile>` and confirm the bundle loads. For standalone products, keep the same `BOT_HOME`, run `node scripts/stop.mjs`, then `node scripts/start.mjs`. Lifecycle handshake errors belong in section 11. Only standalone products install the coordinator alongside the main bundle.

## 3. QQ authorization or event permissions fail

Confirm application status, event subscriptions and message permissions in the QQ operator console, then authorize again from the bot card. The plugin cannot perform platform approval. Validate text before media; handle permission/rate-limit errors using platform codes. Check delivery records before repeating a send whose outcome is uncertain.

## 4. WeChat iLink login, polling or media limits

For expired QR codes or polling context, cancel the old login in the panel and authorize again. Confirm connectivity and phone authorization; validate text before a small audio clip or ordinary file. Apply WeChat's current format/size limits rather than QQ chunk limits, and do not reuse old upload signatures.

## 5. Python worker fails to start

Confirm `BOT_PYTHON` selects the Python 3.12/3.13 interpreter containing the dependencies and that the workspace is writable. Check/install with that same interpreter:

```powershell
python --version
python -m pip install -r requirements.txt
```

If `BOT_PYTHON` is set, substitute that interpreter for `python`. Standalone operators can stop, rerun `node scripts/install.mjs .` to repair the media environment, then restart. Retain the missing package name, worker error code and exit stage if failure persists; protocol mismatches require matching plugin and worker versions.

## 6. Missing FFmpeg/ffprobe

Run `ffmpeg -version` and `ffprobe -version` in the same PowerShell used to start Harness. If absent, install FFmpeg and add both commands to PATH, then restart Harness/product so it inherits the new PATH. For remaining errors, record the first version line and failing operation.

## 7. Image service configuration fails

Check the OpenAI image endpoint/model/key variable and ComfyUI endpoint/API workflow under **Services**, then the protocol under **Bots → Media → Images**. Address, model, protocol and workflow have no legacy environment fallback; see [configuration](configuration.md).

OpenAI-compatible endpoints require HTTPS without credentials, query or fragment. The backend process must receive the selected credential variable (default `OPENAI_API_KEY`); restart after changing it. Confirm provider support for the selected model before a single-image test. The `gpt-image-2` default does not guarantee third-party support.

The ComfyUI Start action searches upward from the workflow directory for a project containing both `scripts/start_comfyui.ps1` and `ComfyUI/main.py`; check the deployment layout if absent. Panel startup uses `--disable-dynamic-vram --disable-pinned-memory --cache-none` and does not replace existing instances. For a Windows blue screen, preserve BugCheck/Minidump evidence and inspect memory/drivers instead of repeatedly submitting the crashing workflow; these flags cannot guarantee protection from system faults.

## 8. voice-generation is not installed

For missing Edge TTS dependencies, run `python -m pip install -r requirements-voice-generation.txt` with the actual media interpreter. Standalone products can stop, run `node scripts/install.mjs . --layers=core,basic-media,voice-generation`, then restart. Edge TTS needs no API key but uses an external network service. GPT-SoVITS, Breeze and RVC require their own environments.

## 9. RVC, Music or GPT-SoVITS is missing or blocked

`missing`/`blocked` is expected when optional services are not deployed. Check external projects, model libraries and Service Profiles under **Services**, complete missing resources and refresh; then select the voice/capability in bot media settings. Endpoints, model paths and weights belong in private Profile configuration, not personas.

Follow the [voice library](voice-model-library.md), [Music](music-integration.md) or [RVC](singing-conversion.md) guide for dependencies. A successful health/probe only demonstrates reachability or protocol support; validate actual synthesis, download or conversion output separately.

## 10. Delivery remains pending, failed or unknown

| State | Meaning and action |
| --- | --- |
| `pending` / `registered` | Awaiting delivery; check bot connectivity, queue, current identity and permissions |
| `failed` | Confirmed failure; resolve the prepare/upload/commit stage, error code and platform limit |
| `unknown` | Submitted without confirmation of platform acceptance; recover using the existing record without rerunning TTS/RVC/Music automatically |

Attachments must belong to the current channel. Create a resend intent only on an explicit user request. Generation or queuing is not proof of receipt. See [QQ delivery](qq-media-delivery.md) for media limits and states.

## 11. Upgrade or rollback fails after installation

Confirm standalone mode, unchanged `BOT_HOME` and available previous main/coordinator archives. Preserve `installation.json`, `lifecycle-installation.json`, `lifecycle-installations/`, evolution journals and old archives.

- A failed health check after a compatible main upgrade triggers at most one restoration of the previous main archive with a matching hash. Unknown external deliveries are not replayed. Trusted administrators can queue rollback of a completed compatible upgrade with `/evolve rollback <task-id>`.
- If a new coordinator is required or `lifecycle-installation.json` is absent, stay stopped and use `stop → install.mjs <package-directory-or-tgz> → start`. Failed offline installation tries one previous-main → previous-coordinator recovery.
- For previous hash/identity mismatch, rerun the installer with a trusted matching pair; do not mix bundles or replace live `node_modules` manually.
- After forced termination, `LIFECYCLE_OPERATION_STALE` requires confirming the recorded PID no longer exists before moving `BOT_HOME/lifecycle-operation.lock` into an archive. Rerun the installer to converge the unfinished journal before starting. Never remove the lock while the process is alive.

Record sanitized phase, error code and health-check stage. See [standalone deployment](deploy-product-profile.md) for update commands.

## 12. Collect sanitized diagnostics

Provide plugin version/commit, Harness/Node/Python/FFmpeg versions, installation mode, command, failing stage, error code and capability/delivery state. Add media type, size range and platform-receipt status only when relevant. Replace paths with `<path>`, identities with `<id>` and secrets with `<redacted>` before submitting. Report vulnerabilities privately through [security](../../SECURITY.en.md).
