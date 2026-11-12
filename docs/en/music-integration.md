# Music Integration

[简体中文](../music-integration.md) | English

The plugin invokes Music search/download through the `musicdl_json_v1` JSON subprocess protocol. Music keeps its own Python environment/CLI; this plugin owns session identity, candidate selection, permissions, jobs, attachments and delivery.

## Configuration

A Music Service Profile's private `home` points to the project root, and `sources` orders `MiguMusicClient`, `KuwoMusicClient`, `QQMusicClient`, `NeteaseMusicClient`. Defaults enable Migu/Kuwo after full-download verification; enable others after complete search/download checks. No chat model, music HTTP port or per-persona interpreter is required.

The Services panel manages source priority only, with a compact horizontal list for adding, removing and moving sources. The Music project directory comes from the deployment default or a legacy backend setting and is not selected again in the panel. The selected order is passed unchanged to the Music JSON interface.

Persona `media.music` holds `profileRef`, `enabled` and `includeLyrics`, with both toggles defaulting to `false`. Enabling in the panel adds `bot_music` and `music-download`. Disabling immediately revokes further permissions for active jobs; grants take effect next turn. The current task keeps its frozen lyrics preference.

Operators/the host determine root directories, interpreters and output paths; model arguments cannot override them. Initial sources pass download acceptance without extra login. Future sources needing cookies/authorization must use Harness credentials, not persona/candidate/tool-result storage.

## Sessions and delivery

Search returns real candidates and a host-generated candidate-set ID. Download selects the best title/artist match or an explicitly selected prior candidate; the model does not construct media URLs. Candidates, original audio, lyrics and download records belong to the current channel session. Expired/cross-session candidates and results arriving after a reset cannot be used.

Songs enter the job directory, are validated and registered as session attachments, then temporary files are cleaned. `bot_sing action=sing` accepts `song/artist` or earlier `candidateSet/candidate`; an already acquired source for the same song/session is reused. Catalog songs are treated as mixed audio. The selected RVC Profile is checked before download, and the adapter validates separation. If only conversion was requested, the original song remains input and is not additionally queued for sending.

Compliant native MP3 is delivered directly. Other sources are encoded once in full from the original, defaulting to 192 kbps, then choosing among 160/128/96/64 kbps according to duration. Downloaded songs and title-based covers must be strictly below 20,000,000 bytes, with actual size, full decode and duration checked. If they cannot fit, fail explicitly rather than truncate. WAV conversion of explicitly uploaded audio retains existing audio limits.

Delivery reuses the attachment queue. Download completion, attachment registration and platform delivery are distinct. Retrying delivery reuses the completed attachment rather than searching/downloading again. Session stop, bot shutdown, permission revocation and deletion follow existing cancellation/ownership cleanup.

## Checks and acceptance

**Check health** calls `service.health` for environment/protocol only. Source availability does not prove a particular song is downloadable. Full downloads have separate `music` acceptance. Health binds the Profile revision; actual acceptance binds both persona and Profile revisions. Stored check times inform operators; opening the panel does not repeatedly run external processes.

Acceptance includes real search, ambiguous candidate selection, complete download/decode, optional lyrics, subsequent conversion, stop, permission revocation, session reset and cross-session rejection. Verify QQ/WeChat attachments separately for format/size, confirming the original song remains complete.

## Limitations / Known Issues

Sources may change APIs, require authorization, return previews or reject songs; only downloading confirms availability. Input has a 100 MiB local-processing budget, generated audio supports 200 MiB, and QQ delivery supports 200 MiB with multipart above the direct threshold. WeChat ordinary attachments retain 20 MiB. Complete MP3 below 20,000,000 bytes is this feature's delivery policy, independent of QQ soft limits. Music does not supply RVC weights, separation models or music generation.
