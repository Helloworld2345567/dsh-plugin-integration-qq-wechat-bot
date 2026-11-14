# Operations Troubleshooting

[简体中文](../troubleshooting.md) | English

Use the structured checks below from the repository root or an operator-designated directory. Examples contain no platform credentials, user/group IDs, signed URLs, database contents or absolute local paths. Stop sensitive running tasks before collecting evidence, retaining only sanitized codes, versions and states.

## Common safety rules

- Do not paste tokens, cookies, Harness credentials, API keys, user/group IDs, message text, signed download URLs, model paths or absolute local paths into commands, Issues, excerpts or screenshots.
- Do not upload databases, complete logs, runtime directories, attachments, weights or unsanitized platform responses.
- `health`/`probe` establishes detectability/protocol only, not actual delivery, complete downloads, TTS/RVC/GPT-SoVITS quality.
- `pending`/`registered` means queued, `failed` confirmed failure, `unknown` unconfirmed outcome after submission. Only platform receipts establish delivery.

## 1. Plugin absent from Harness settings

**Symptom:** No Bot panel, or main bundle absent from startup logs.

**Safe checks:** Verify the intended profile, Harness `0.2.1-rc.5`, and stop the current process before reinstalling. Do not share profile paths/credentials.

**Possible causes:** Missing Plugin Manager installation, wrong profile, build/gate failure, disabled bundle entry or incompatible runtime.

**Recovery:** Existing Harness: `npm ci`, `npm run build`, `npm run verify:release`, then `dsh plugin --profile <profile> add .` and restart. Standalone: use `node scripts/install.mjs .` and `node scripts/start.mjs`, not the existing-profile command. Do not manually edit manifests.

**Sanitized evidence:** Harness/Node/Python versions, failing release-gate stage, source-directory versus fixed-archive installation and error codes.

**Exclude:** Profile paths, credentials, startup tokens, user data, complete logs, signed archive URLs.

## 2. Inactive Host row or profile

**Symptom:** Installed plugin shows an inactive Host row or no available profile.

**Safe checks:** Verify the launched profile is the installation target, not another instance; check `engines.dsh` and whether `bots` was manually removed/overwritten.

**Possible causes:** Inactive profile, disabled main bundle, main/coordinator version-instance handshake mismatch, or confusing the two installation modes.

**Recovery:** Existing Harness: start with the correct `--profile <profile>` and verify settings. Standalone: `node scripts/stop.mjs`, then `node scripts/start.mjs` using the same `BOT_HOME`. Do not install lifecycle as a separate third-party runtime.

**Sanitized evidence:** Placeholder profile name, Host row state, Harness version, bundle names and handshake availability.

**Exclude:** Real paths, IPC nonce, credentials and full startup logs.

## 3. QQ authorization or event permissions fail

**Symptom:** QR/authorization failure, no events after connection, or platform permission/rate-limit errors.

**Safe checks:** Check application, bot account, subscriptions and messaging permissions in the QQ operator console. Authorization must target this bot/conversation; do not share QQ/group numbers.

**Possible causes:** Incomplete authorization/subscriptions, account permissions/state, limits or platform outage. The plugin cannot perform platform review/approval for the operator.

**Recovery:** Restart authorization from the bot card, wait for confirmation, reconnect and adjust only required event permissions in the console. Test plain text before media. Inspect delivery records before resending uncertain attachments.

**Sanitized evidence:** QQ, authorization stage, time range, codes, event type and Harness/plugin versions.

**Exclude:** Tokens, cookies, openid, group numbers, message content, signed URLs and complete responses.

## 4. WeChat iLink login, polling or media limits

**Symptom:** Expired QR, polling stuck pending, disconnect or media rejection.

**Safe checks:** Confirm phone authorization, network access to iLink and current WeChat attachment limits. Do not upload QR/ticket/CDN screenshots.

**Possible causes:** Expired ticket/context, platform session/format restrictions, limits or external failures.

**Recovery:** Cancel the old login and authorize again. After confirmation, test text, then a small playable audio/file. Reregister failed attachments as instructed; never copy upload signatures into another request. WeChat file limits differ from QQ multipart limits.

**Sanitized evidence:** Scan/poll/confirm/send stage, error category, media type/size range, versions and time range.

**Exclude:** QR codes, tickets, WeChat IDs, CDN signed URLs, cookies, real messages/attachments.

## 5. Python worker fails to start

**Symptom:** Worker start failure, unsupported protocol or Python exit.

**Safe checks:** `python --version` must be 3.12/3.13; base requirements must be installed in the interpreter selected by `BOT_PYTHON`. Do not share its local path.

**Possible causes:** Unsupported Python, missing packages, unwritable job directory, nonexistent interpreter, child-environment dependencies or protocol mismatch.

**Recovery:** Stop Harness and run `python -m pip install -r requirements.txt` using the actual interpreter. Standalone: rerun `node scripts/install.mjs .` to rebuild/check media environment. Confirm workspace permissions and restart. Never put keys in worker arguments.

**Sanitized evidence:** Python major/minor, missing package names, worker code, `npm run check:python-dependencies` and installation mode.

**Exclude:** Absolute paths, complete environment dumps, credentials, model files and full worker logs.

## 6. Missing FFmpeg/ffprobe

**Symptom:** Transcoding, probing or QQ audio preparation cannot find `ffmpeg`/`ffprobe`.

**Safe checks:** Run `Get-Command ffmpeg`, `Get-Command ffprobe` and their `-version` commands. Confirm operator-approved installation provenance.

**Possible causes:** Missing installation/PATH, mismatched versions/architecture or unchanged PATH in an already running process.

**Recovery:** Install a Windows ffmpeg distribution, ensure both commands work in the PowerShell used to launch Harness, then restart. Do not commit binaries, signed downloads or machine paths.

**Sanitized evidence:** Discoverability, first version lines, platform and failed operation.

**Exclude:** Complete PATH, install paths, signed URLs and full runtime logs.

## 7. Image service configuration fails

**Symptom:** Unconfigured status, missing provider key, invalid endpoint or failed generation.

**Safe checks:** OpenAI-compatible addresses must be HTTPS without credentials/query/fragment; confirm the backend process securely received the key variable selected in Services, defaulting to `OPENAI_API_KEY`. For ComfyUI, check its address and workflow file. Do not test keys in the panel, prompts or Issues.

The ComfyUI start button searches upward from the workflow directory for a project containing both `scripts/start_comfyui.ps1` and `ComfyUI/main.py`, including workflows nested under `workflows/api`. Check the local deployment layout if neither is found. Panel starts use `--disable-dynamic-vram --disable-pinned-memory --cache-none` to reduce pressure from dynamic host buffers, pinned memory and node caches; an already running instance is kept. After a Windows blue screen, preserve the BugCheck event and Minidump, then inspect memory exhaustion records and drivers. These arguments cannot guarantee a fix for driver or hardware faults; avoid repeatedly submitting the crashing workflow.

**Possible causes:** A misspelled key variable, the backend missing the selected variable or not restarted, incorrect protocol/endpoint/model/workflow saved in the Services panel, unsupported model or unavailable provider.

**Recovery:** Check the endpoint, model and key variable under **OpenAI image generation**, and the endpoint and workflow under **ComfyUI** in Services. Both configurations can be saved together; each bot selects its image protocol during creation or later under **Media → Image**. Saved changes apply next turn. Inject the key securely into the selected variable and restart after changing its value. Legacy environment settings for endpoint, model, protocol and workflow no longer apply. Verify provider model support, then test one image. Defaults `https://api.openai.com/v1` / `gpt-image-2` do not imply third-party-provider support.

**Sanitized evidence:** Field presence, model name, HTTPS status, error category and HTTP status class; no query parameters.

**Exclude:** Keys, Authorization, full requests/responses, signed URLs, user prompts and output paths.

## 8. voice-generation is not installed

**Symptom:** Missing dependency or Edge TTS worker failure after enabling voice.

**Safe checks:** Separate base/optional dependencies; voice-generation is not GPT-SoVITS or RVC.

**Possible causes:** Missing optional requirements/layer, wrong interpreter or unavailable external network service.

**Recovery:** Stop, install `requirements-voice-generation.txt` using the actual `BOT_PYTHON` interpreter, or run `node scripts/install.mjs . --layers=core,basic-media,voice-generation`, then restart. Edge TTS needs no operator API key; GPT-SoVITS uses another external Profile path.

**Sanitized evidence:** Python version, edge-tts presence, layers, selected voice protocol and error codes.

**Exclude:** Credentials, reference audio, weights, authorization query parameters and full audio.

## 9. RVC, Music or GPT-SoVITS is missing or blocked

**Symptom:** Catalog `missing`/`blocked`, no usable Profile, or successful health with failed actual output.

**Safe checks:** This is an optional external capability, not necessarily base-install failure. Check separate operator deployment and V4 persona `profileRef`/preferences without private endpoints/paths/weights.

**Possible causes:** Unregistered Profile, incomplete root/project, unavailable dependencies/service, ambiguous metadata, missing weights/reference audio or absent real acceptance.

**Recovery:** Register the external environment in Services/model library, refresh and read safe diagnostics. Complete resources, rescan, and verify current persona/Profile revisions. Do not put paths in personas or silently switch models. Missing/blocked is expected fail-closed behavior when unavailable.

**Sanitized evidence:** Capability state, presence of Profile revision/hash, diagnostic categories, model version, separate health/acceptance results.

**Exclude:** Weights, absolute paths, keys, Music/QQ/WeChat cookies and full inference logs.

## 10. Delivery remains pending, failed or unknown

**Symptom:** Text/attachments stay queued, fail, or become unknown after submission.

**Safe checks:** Confirm connection, unchanged session identity, current permissions and attachment ownership. Do not blindly resend.

**Possible causes:** Local queue (`pending`), confirmed preparation/upload failure (`failed`), interrupted post-submission network with unconfirmed acceptance (`unknown`), or platform receipts/limits/formats.

**Recovery:** Inspect delivery state, sanitized cause and platform status. For unknown, prefer existing-record recovery without rerunning TTS/RVC/Music; create resend intent only on an explicit user request. During pause/stop, wait for draining and retry within channel limits.

**Sanitized evidence:** State, prepare/upload/commit stage, cause code, HTTP class, media type/size range and receipt presence.

**Exclude:** Upload signatures, file_info, identity-bearing traces, attachment contents, credentials and full responses.

## 11. Upgrade or rollback fails after installation

**Symptom:** No healthy start, stuck restarting/rolling-back, or rejected rollback.

**Safe checks:** Use lifecycle only in standalone mode. Confirm unchanged `BOT_HOME` and existing previous main/coordinator archives with matching SHA-256. Do not “clean” installation records, paired records/journals, evolution journals or old archives.

**Possible causes:** Archive/hash rejection, incompatible protocol/API/package/capabilities, identity/version mismatch, health timeout, changed previous artifact or lack of a coordinator in existing-Harness mode.

**Recovery:** Distinguish paths. Compatible main upgrades restore one still-matching previous main at most once after failed healthy startup and never replay unknown delivery. A new coordinator or missing paired record requires staying stopped and `stop → install.mjs <package-directory-or-tgz> → start`. Offline installation preflights/journals both bundles and tries previous-main → previous-coordinator recovery once. On previous hash/identity mismatch, do not launch or mix bundles manually; rerun with trusted matching archives. After forced termination and `LIFECYCLE_OPERATION_STALE`, verify through the OS that the recorded PID is gone, then **move/archive** `BOT_HOME/lifecycle-operation.lock` (never overwrite/delete it while the process lives), rerun installer to converge the journal, then start. A completed compatible main upgrade can be rolled back by a trusted administrator with `/evolve rollback <task-id>`. Preserve current data/journals; do not replace live `node_modules` directly.

**Sanitized evidence:** Redacted/truncated task ID, phase, partial archive SHA-256, Harness version, health stage and code.

**Exclude:** Signed archive URLs, full journals, product paths, databases, credentials and full logs.

## 12. Collect sanitized diagnostics

**Symptom:** Preparing an Issue/Discussion or requested diagnostics.

**Safe checks:** Copy to a temporary sanitized file, removing tokens, keys, cookies, passwords, authorization, IDs, QR codes, URL queries, paths, database contents and weight details.

**Possible causes:** Raw logs often combine paths, platform status, message excerpts and remote responses; uploading them increases exposure.

**Recovery:** Supply only plugin version/commit, first Node/Python/FFmpeg version lines, Harness version, installation mode, command names, failing stage, safe codes, capability state (`missing`/`blocked`/`ready`) and whether `npm run verify:release` ran. Platform reports need only platform/event types. Use [Support](../../SUPPORT.en.md) / [Security](../../SECURITY.en.md) to choose public or private reporting.

**Sanitized evidence:** A short category/context excerpt with `<path>`, `<id>` and `<redacted>` replacements, stating raw attachments/databases were not uploaded.

**Exclude:** Full logs/environment dumps, QQ/WeChat authorization material, credentials, keys/cookies/IDs, messages, signed URLs, databases, weights and full audio/video.
