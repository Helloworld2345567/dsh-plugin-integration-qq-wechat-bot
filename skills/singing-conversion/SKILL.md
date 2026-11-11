---
name: singing-conversion
description: Acquire a real song from the music catalog, or use a current-session audio attachment or explicit public source, then apply separation and RVC to produce the current persona's AI voice.
---

# Song and speech voice conversion

Use `bot_sing` only when the user explicitly requests a cover, voice conversion, STS or a change to the voice in existing audio. Continue using `bot_voice` for ordinary text narration. Operators configure RVC weights and services; tool arguments cannot specify or override them. Never return service addresses, paths, internal asset IDs or tracebacks to the user.

1. Current-session attachment: pass one audio or ordinary-file attachment ID in `prepare.inputs`. The host validates session ownership and the worker probes the actual audio stream. An arbitrary local path is not an attachment.
2. Song title: call `sing` directly with `song` and, when known, `artist`. The host selects the highest matching item in enabled catalogs and reuses the downloaded source. Catalog mixes require configured separation. Success sends only the persona-converted MP3, preserving full duration and staying strictly below 20,000,000 bytes; it does not send the original. Do not first call `bot_music.download` and then convert again by song title, or replace the catalog with general web search. Use `bot_music` when the user only wants the original song.
   For one explicit HTTPS address, call `prepare` with `url` and a readable `title`. Keep supported direct audio links and Bilibili/Douyin post URLs. When the user explicitly wants to compare public sources, use currently permitted `web_search`/`web_fetch` to verify and register at most five `candidates`, preserving public source and license information where possible. `convert` can use only fixed candidates; it cannot override download URLs or accept local paths. A search hit does not guarantee a download. Ask the user to upload audio when network access is not permitted.
3. Without a source, an empty `prepare` registers a request waiting for the next uploaded audio. `prepare` does not download or start inference. `list` shows the current candidate set and numbers; old candidate sets cannot be reused with a new list.
4. After selection, call `convert` with the returned `candidateSet` and `candidate`. Do not ask the user to select again when they already specified one source. `sourceType` is `vocals`, `mixed` or `unknown`; use `vocals` only when the user explicitly supplies vocals alone. For unknown sources, first ask whether accompaniment is present; do not guess from extensions. Known mixes may use `mixed` only when an RVC separation model is configured. The service extracts vocals, converts their voice and mixes back the original accompaniment. Without separation, `SINGING_SEPARATION_UNCONFIGURED` blocks before download or inference; request vocals alone.
5. Attachment/public-link `convert` supports `mp3` or `wav`, inheriting configuration when omitted. MP3 selects 192/160/128/96/64 kbps based on full duration to stay strictly below 20,000,000 bytes; explicit WAV requests stay WAV. Song-title `sing` always sends MP3. Fail explicitly if no supported bitrate can contain the complete song; do not truncate it.

Success automatically registers one audio attachment in the existing delivery queue. Tell the user it is AI voice conversion. Do not call `bot_send_file` again, reconvert or read the result path. On failure, cancellation or unknown service state, explain the stable error and required user action. Do not prepare and retry again in the same turn or automatically switch candidates. A new attempt requires a new explicit user request. Conversion explanations are not automatically read aloud by TTS. Follow the persona and user's reply language.

`registeredForDelivery=true` or `deliveryState=registered` only means the result is registered; the platform attempts delivery after the turn ends. With `platformSent=false`, do not claim it was sent or guarantee delivery. Distinguish delivery failure for an existing result from conversion failure, and reuse the existing attachment for an explicit resend request.

Examples:

Cover a song by title:

```json
{"action":"sing","song":"Bubble","artist":"G.E.M."}
```

Use a current-session attachment:

```json
{"action":"prepare","inputs":["current-session-attachment-id"]}
```

After obtaining the candidate set:

```json
{"action":"convert","candidateSet":"set-returned-by-prepare","candidate":1,"sourceType":"vocals","format":"mp3"}
```

A mixed song, only with configured separation:

```json
{"action":"convert","candidateSet":"set-returned-by-prepare","candidate":1,"sourceType":"mixed","format":"mp3"}
```
