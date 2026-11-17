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

Multiple conversions and retries are allowed in one turn. Execute sequentially by default; only an explicit user request permits parallel execution, with at most three concurrent media operations. Keep the requested source unless the user requests another. Do not truncate the complete result or expose paths and asset IDs. Successful conversion registers one AI voice audio attachment; reuse it for an explicit resend.
