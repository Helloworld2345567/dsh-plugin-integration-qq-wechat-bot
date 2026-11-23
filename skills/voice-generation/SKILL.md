---
name: voice-generation
description: Generate requested speech with the session’s selected TTS voice.
---

# Voice generation

Use `bot_voice` only for an explicit speech, reading or narration request. Automatic voice mode is handled by the host and must not be duplicated after a voice attempt. Use `bot_music` for an original song and `bot_sing` for a cover or voice conversion.

Omit `voice` and `format` to use the current configuration. Do not pass keys, URLs, model weights or reference paths. Reuse an existing attachment for an explicit resend; do not synthesize again just to check delivery.
