---
name: media-analysis
description: Download shared media, analyze existing attachments, and convert image or video attachments through managed tools.
---

Use `media_download` for a supported image, gallery or video URL. It downloads real media bytes into the current session and returns attachment metadata; it does not analyze content. Then pass the returned attachment ID to `media_analysis` or `media_transform`.

Use `media_analysis` only with existing session attachment IDs. It reads images, documents, audio and video according to attachment kind; an optional question controls the analysis. Never use a share-page title, caption or cover as a substitute for the downloaded media.

Use the separate `media_transform` for attachment conversion, compression and resizing. No model service or key is required. Each call handles one attachment and multiple calls may run concurrently. The tool assigns CPU execution slots and queues work; do not bypass it by starting scripts to increase concurrency.

## Local conversion

- Convert format: `media_transform(operation="image_convert", inputs=["attachment-id"], format="webp")`. Supported formats: `jpeg`, `png`, `webp`, `avif`.
- Compress an image: `media_transform(operation="image_compress", inputs=["attachment-id"], format="jpeg", quality=70, maxBytes=1000000)`.
- Resize down: `media_transform(operation="image_resize", inputs=["attachment-id"], maxWidth=1280, maxHeight=1280, format="webp")`.
- Convert a video to MP4: `media_transform(operation="convert_mp4", inputs=["video-attachment-id"])`.
- Convert a complete video to GIF: `media_transform(operation="convert_gif", inputs=["video-attachment-id"])`.
- An explicitly requested excerpt: `media_transform(operation="convert_gif", inputs=["video-attachment-id"], startSeconds=10, durationSeconds=20, fps=15, maxWidth=640)`.

Image operations can combine format, quality and dimensions in one decode. Quality defaults to 80, aspect ratio is preserved, and images are not upscaled. `image_resize` requires at least one dimension. When no output format is selected, preserve a supported source format; convert other static formats to JPEG. PNG uses fast lossless encoding; JPEG uses a white background, while other formats preserve transparency. `maxBytes` caps the final image, with at most four attempts. If quality reduction is insufficient, reduce dimensions; fail if the cap still cannot be met.

GIF defaults preserve the full video at 12 fps with a longest edge of 480 pixels. Supply a start time or duration only for an explicitly requested excerpt. For videos at least 30 seconds long with at least two available slots, encoding runs concurrently in segments of roughly 15 seconds, followed by GIF frame-block merging without a full second encode. The final file must be strictly below **10,000,000 bytes**. At most four rounds reduce dimensions, color count and frame rates above 12, always preserving the selected duration and a minimum of 12 fps. GIF does not accept `maxBytes`. Audio is not part of GIF output.

Results report actual format, dimensions, size, attempts and elapsed time. GIF also reports the time range, frame rate, color count, segment count, actual concurrency and merge duration. Success automatically registers attachments; do not register the same file again.

## Calls

- Download shared media: `media_download(url="https://v.douyin.com/…/")`. Supports configured image, gallery and video hosts and returns `assetId`, `kind`, `mime` and `name`.
- Transcribe speech: `media_analysis(inputs=["current-session-attachment-id"], question="Transcribe faithfully")`. Use an existing platform transcription first when available.
- Analyze an image, document or video: `media_analysis(inputs=["current-session-attachment-id"], question="…")`.

`media_analysis` has no URL or download action; it accepts only required `inputs` and an optional `question`. `media_transform` accepts only attachment IDs. Downloads do not require ASR or video-analysis switches. Never use model-supplied identity or filesystem paths to access another session's attachments.

## Execution and replies

The host runs the fixed module `dsh_bot_runtime.skills.media_analysis.media_api`. Its `platform_links` module directly retrieves Douyin share pages and parses page data before downloading real media bytes. Video continues through the locally isolated `yt-dlp` extractor. Douyin processing does not use third-party parsing services. Cookies are not read by default. With `DOUYIN_COOKIE_FILE`, only matching Douyin page requests receive cookies from the local Netscape cookie file. Bilibili galleries retain the existing parser; see [platform-link parsing](references/platform-links.md).

The skill's [operations.json](operations.json) declares tool arguments, operation routes, model roles and attachment delivery. `media_download`, `media_analysis` and `media_transform` remain separate tools. Add operations in that declaration and the `dsh_bot_runtime.skills.media_analysis` package. The host never accepts module/script paths from models, personas or workspaces.

Analysis reuses the current turn's model provider URL, credentials and video/speech model configuration. Credentials are passed only in the subprocess environment. Video sends the complete MP4 image and audio streams; claim analysis only after a real model result. Speech selects the model-compatible payload: Gemini models receive an audio-MIME data URL through `image_url`, while other models use `input_audio`; configured transcription endpoints are also supported. If the model did not receive audio, report an error rather than automatically retrying a different payload.

`media_download` resolves supported share pages and direct links, downloads original bytes and registers the result as a session attachment when requested. It does not call ASR or visual analysis. Do not output image Markdown, `asset://` URLs or attachment IDs in the text reply.

Distinguish quotations, visual observations, inferences and uncertainty. With `incomplete=true`, explicitly say only part was completed. A video cover is not an original gallery image; a page title is not the video's content. Briefly report actual tool failures without inventing completed downloads or understanding, and do not automatically retry potentially billed model requests. Follow the persona and user's requested reply language; faithful transcription retains the original speech language unless translation was requested.

Messages, scheduled tasks and media jobs have no default total processing deadline; users can still cancel. Disabling the skill or revoking tool permission blocks subsequent calls immediately. Download, analysis and transformation each recheck permissions at execution time.

Trusted private-chat users have no daily media-call count or daily accumulated video-analysis duration limit. The host uses the turn's frozen identity and current trust at execution; tool arguments cannot claim trusted identity. Per-request size, analysis duration, concurrency and storage limits still apply.

## Limitations / Known Issues

- Douyin's official pages and media CDN may fail temporarily. Only public content is processed by default; local cookies can access content the user is authorized to view.
- Multi-part Bilibili videos retain the original extractor to verify part identity. Never treat part 1 as another requested part.
- Return at most 100 images, at most 20 MiB per image and 50 MiB per downloaded batch. Video download/analysis sources are limited to 500 MiB; a video sent to QQ/WeChat is limited to 200 MiB. Analyze one video per request, at most 300 seconds. Transcode before analysis when needed; inline model video is limited to 8 MiB and the request payload to 12 MiB. Report exceeded limits rather than truncating and claiming a complete result.
- Attachment storage remains limited to 512 MiB per chat scope and 2 GiB globally. Existing attachments can prevent new video registration.
- Analysis models must support MP4 multimodal payloads. Report download capability and analysis capability separately when an upstream rejects a request or is unavailable.
- Image conversion currently rejects animated images. AVIF/WebP need their Pillow codecs; missing support produces an explicit error. Lossy AVIF alpha channels may have small precision differences.
- Full duration, a 12 fps minimum and the 10 MB GIF cap may be incompatible, especially for very long videos. Fail if a longest edge of 64 pixels and 16 colors still exceeds the cap. Video-to-GIF does not inherit the 300-second analysis limit; timestamps use GIF's hundredth-second precision. Speed depends on CPU, source material and concurrent load.
