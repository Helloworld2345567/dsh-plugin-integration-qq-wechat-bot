---
name: music-download
description: Search, select and download complete songs from host-configured music catalogs, automatically registering chat-compatible audio and optionally lyrics.
---

# Music search and download

Use `bot_music` when the user wants an original song or a download. Use `action="download"` with the song and optional artist for the highest configured match. Use `action="search"` when the user wants candidates or a version comparison; a later download must reuse the returned `candidateSet` and candidate number from the same session.

Lyrics follow the persona's music configuration; they are not a tool-call override. The host owns sources, credentials, complete-duration preservation and transcoding. Never invent download URLs, substitute a different version or expose internal paths and IDs.

Successful audio is registered automatically. Report the actual track and delivery state, and reuse the existing attachment for an explicit resend. If the user wants a cover or voice conversion, use `bot_sing` instead.
