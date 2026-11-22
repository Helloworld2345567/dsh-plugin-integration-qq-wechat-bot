---
name: singing-conversion
description: Acquire a real song from the music catalog, or use a current-session audio attachment or explicit public source, then apply separation and RVC to produce the current persona's AI voice.
---

# Song and speech voice conversion

Use `bot_sing` only for an explicit cover, voice conversion or STS request. Use `bot_voice` for ordinary narration and `bot_music` for an original song. Service weights, URLs and paths are operator-owned.

Choose the action from the current state:

- `sing`: convert a song by title and optional artist from the configured catalog.
- `prepare`: register one current-session audio/file attachment, one explicit public URL, or an empty request waiting for an upload.
- `list`: show the current candidate set.
- `convert`: use the returned `candidateSet` and candidate number. Ask whether accompaniment is present when `sourceType` is unknown; `mixed` requires configured separation and `vocals` means vocals alone.

Choose the requested song or version before calling `sing` or `convert`. For a single cover, stop after the first success. The host has queued the audio for delivery, even when `platformSent=false`. Reuse the registered audio for an explicit resend. If conversion fails, you may retry the requested source.

The reported byte count describes the converted file. QQ prepares its voice encoding separately. If the user requests a smaller file or another format, process the same cover.

Set `append=true` on a subsequent `sing` or `convert` only when the user explicitly requests additional songs or versions in this turn. Run conversions sequentially unless the user requests parallel execution, with at most three concurrent media operations. Keep the complete audio and keep paths and asset IDs private.
