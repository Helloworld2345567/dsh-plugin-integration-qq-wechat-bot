---
name: voice-generation
description: Generate AI speech replies on the user's explicit request, using the configured Edge TTS or GPT-SoVITS voice.
---

# Voice generation

Use `bot_voice` to generate and register a playable audio attachment only when the user explicitly requests speech, reading aloud or narration. When automatic voice replies are enabled, the runtime appends speech to the final text without a separate model tool call; it does not synthesize again if a voice tool was already attempted in this turn. Successful audio is automatically added to this turn's delivery. Do not expose internal asset IDs, working-directory paths or `asset://` URLs.

`registeredForDelivery=true`, `deliveryState=registered` and `platformSent=false` mean the audio was generated and registered, but no platform receipt has been obtained. Say that the audio is generated and queued for sending, not that it was delivered or guaranteed to arrive. Only `platformSent=true` means the platform confirmed acceptance; a historical `sent` marker alone does not confirm a receipt. When the user explicitly asks to resend, reuse the existing audio through `bot_send_file(assetId=original_attachment_id, resend=true)` instead of synthesizing it again. A `pending` result only means queued; failure or `unknown` must not be described as sent.

`mode="speak"` is ordinary narration and is also the default. Use `bot_music` for song downloads and `bot_sing` when the user explicitly requests a cover in the current persona's voice. Clearly state in the natural-language reply that the voice is AI generated. Follow the persona and user's requested reply language.

```json
{
  "mode": "speak",
  "text": "The text to read aloud",
  "speed": 1.0
}
```

Omitted `voice` and `format` inherit the current turn's configuration, then the protocol default. Explicit tool arguments take precedence. Connection information comes from configuration; skill calls do not accept API keys, URLs, model weights or reference-audio paths.

- `edge_tts` uses Edge TTS without an API key. The voice comes from configuration; operators can select or enter a locally stored Edge voice name in the panel. Output is MP3.
- `gpt_sovits` uses the configured model and reference audio and supports ordinary narration and WAV only. `voice` must be the configured voice identifier; omission inherits it. Do not supply another provider's voice such as `alloy`. An explicit MP3 request is unsupported. `style` explicitly degrades to ordinary narration and does not promise a style change.

The audio output budget and QQ hard audio limit are both 200 MiB. QQ uploads larger than 5,000,000 bytes are automatically chunked by the host, without reducing quality or truncating content. Audio above the soft voice limit may appear as a file. WeChat attachments remain limited to 20 MiB. Describe completion only from real tool results and do not present narration as a song.
