---
name: music-download
description: Search, select and download complete songs from host-configured music catalogs, automatically registering chat-compatible audio and optionally lyrics.
---

# Music search and download

Use `bot_music` when the user requests a song, the original recording or a music download. If they explicitly ask the current persona to sing, cover a song or convert its voice, use `bot_sing(action="sing", song="song title", artist="optional artist")`. The host acquires the original and invokes STS, delivering only the converted result by default.

- Direct download: use `action="download"` with `song`, adding `artist` when known. The host selects the highest match without another confirmation. Use the real title, artist and version returned by the tool in the reply.
- Candidate search: use `action="search"` when the user wants search results, a version comparison or a list. For download, copy the returned `candidateSet` and pass the chosen `candidates[].candidate` value as `candidate`. Old candidates cannot be used in another session or with new search results.
- Lyrics: set `includeLyrics=true` only when requested. Report unavailable lyrics honestly; never invent them.
- The host uses configured, verified sources, preferring Migu by default. The tool accepts no download URL, service address, path or credentials. Do not guess audio sources through web scraping.
- The original is first saved as a session-scoped source. Small native files suitable for direct delivery keep their format. If transcoding is required, preserve the complete duration and produce MP3 strictly below 20,000,000 bytes. The tool reports actual format and quality; do not call transcoded output lossless.

Success automatically registers the attachment for delivery. Do not call `bot_send_file` again, redownload it or show internal asset IDs and paths. On failure, cancellation or a session switch, report only the real tool result. Never automatically substitute another song/version or truncate the song. Once the original is acquired, a subsequent delivery or conversion failure does not justify downloading it again.

`registeredForDelivery=true` or `deliveryState=registered` means registered without a platform receipt. With `platformSent=false`, say the download completed and is pending delivery; do not claim it was sent or guarantee arrival. An explicit resend request reuses the original attachment; a retry returning `pending` still does not confirm delivery. Reply in the language requested by the user or persona.

```json
{"action":"download","song":"Bubble","artist":"G.E.M.","includeLyrics":false}
```
