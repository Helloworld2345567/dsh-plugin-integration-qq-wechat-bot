# Platform-link parsing

This is a host implementation note. Give supported share URLs to `media_download`; it resolves the platform page, downloads real bytes and registers an attachment only after validation. Do not use page text, covers or guessed CDN URLs as media input. Platform failures are returned as tool errors; the model does not need to reproduce the parser.
