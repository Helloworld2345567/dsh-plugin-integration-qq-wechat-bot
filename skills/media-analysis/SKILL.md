---
name: media-analysis
description: Analyze and download audio, video and images; concurrently convert, compress and resize images, and convert complete videos into GIFs below 10 MB through managed attachment tools.
---

Use this skill to understand audio/video or download original images, galleries and videos from links. Call `media_analysis`; send existing images and scanned pages directly to the chat model for visual understanding.

Use the separate `media_transform` for attachment conversion, compression and resizing. No model service or key is required. Each call handles one attachment and multiple calls may run concurrently. The tool assigns CPU execution slots and queues work; do not bypass it by starting scripts to increase concurrency.

## Local conversion

- Convert format: `media_transform(operation="image_convert", inputs=["attachment-id"], format="webp")`. Supported formats: `jpeg`, `png`, `webp`, `avif`.
- Compress an image: `media_transform(operation="image_compress", inputs=["attachment-id"], format="jpeg", quality=70, maxBytes=1000000)`.
- Resize down: `media_transform(operation="image_resize", inputs=["attachment-id"], maxWidth=1280, maxHeight=1280, format="webp")`.
- Convert a complete video to GIF: `media_transform(operation="convert_gif", inputs=["video-attachment-id"])`.
- An explicitly requested excerpt: `media_transform(operation="convert_gif", inputs=["video-attachment-id"], startSeconds=10, durationSeconds=20, fps=15, maxWidth=640)`.

Image operations can combine format, quality and dimensions in one decode. Quality defaults to 80, aspect ratio is preserved, and images are not upscaled. `image_resize` requires at least one dimension. When no output format is selected, preserve a supported source format; convert other static formats to JPEG. PNG uses fast lossless encoding; JPEG uses a white background, while other formats preserve transparency. `maxBytes` caps the final image, with at most four attempts. If quality reduction is insufficient, reduce dimensions; fail if the cap still cannot be met.

GIF defaults preserve the full video at 12 fps with a longest edge of 480 pixels. Supply a start time or duration only for an explicitly requested excerpt. For videos at least 30 seconds long with at least two available slots, encoding runs concurrently in segments of roughly 15 seconds, followed by GIF frame-block merging without a full second encode. The final file must be strictly below **10,000,000 bytes**. At most four rounds reduce dimensions, color count and frame rates above 12, always preserving the selected duration and a minimum of 12 fps. GIF does not accept `maxBytes`. Audio is not part of GIF output.

Results report actual format, dimensions, size, attempts and elapsed time. GIF also reports the time range, frame rate, color count, segment count, actual concurrency and merge duration. Success automatically registers attachments; do not register the same file again. The compatibility entry `bot_media(operation="convert_gif", ...)` has the same limits and full-duration default.

## Calls

- Transcribe speech: `media_analysis(kind="audio", inputs=["current-session-attachment-id"], question="Transcribe faithfully")`. Use an existing platform transcription first when available.
- Analyze a video link: `media_analysis(kind="video", url="https://v.douyin.com/…/", question="What happens in this video?")`. Supports Douyin/Bilibili post URLs and share links on `v.douyin.com`/`b23.tv`. Extract the HTTPS URL from shared text. Do not substitute a web-page summary for video analysis. Douyin `note`/`slides` gallery links require `kind="image"`.
- Analyze a video attachment: `media_analysis(kind="video", inputs=["current-session-attachment-id"], question="…")`. With no source, audio/video requests select the latest same-kind attachment in this session.
- Download original images: `media_analysis(kind="image", url="https://…")`. Supports Douyin galleries, Bilibili image posts, direct image links and public web-page images.
- Download video only: `media_analysis(kind="video", action="download", url="https://…")`. Returns a video attachment without calling an analysis model.

`url` and `inputs` are mutually exclusive. Ordinary media processing does not require per-call approval or permission to execute local commands. Never use model-supplied identity or filesystem paths to access another session's attachments.

## Execution and replies

The host runs the fixed module `dsh_bot_runtime.skills.media_analysis.media_api`. Its `platform_links` module directly retrieves Douyin share pages and parses page data before downloading real media bytes. Video continues through the locally isolated `yt-dlp` extractor. Douyin processing does not use third-party parsing services. Cookies are not read by default. With `DOUYIN_COOKIE_FILE`, only matching Douyin page requests receive cookies from the local Netscape cookie file. Bilibili galleries retain the existing parser; see [platform-link parsing](references/platform-links.md).

The skill's [operations.json](operations.json) declares tool arguments, operation routes, model roles, fixed namespaced entries and attachment delivery. `tools` declares analysis and transformation separately. Add operations in that declaration and the `dsh_bot_runtime.skills.media_analysis` package. The host never accepts module/script paths from models, personas or workspaces.

Analysis reuses the current turn's model provider URL, credentials and video/speech model configuration. Credentials are passed only in the subprocess environment. Video sends the complete MP4 image and audio streams; claim analysis only after a real model result. Speech selects the model-compatible payload: Gemini models receive an audio-MIME data URL through `image_url`, while other models use `input_audio`; configured transcription endpoints are also supported. If the model did not receive audio, report an error rather than automatically retrying a different payload.

The namespaced `image_download` module downloads original images. Douyin galleries use image lists embedded in official share pages. Ordinary pages prefer explicit original-image links and the largest srcset. Downloaded bytes are not re-encoded. Downloaded images/videos are automatically registered as platform reply attachments. Do not output image Markdown, `asset://` URLs or attachment IDs in the text reply.

Distinguish quotations, visual observations, inferences and uncertainty. With `incomplete=true`, explicitly say only part was completed. A video cover is not an original gallery image; a page title is not the video's content. Briefly report actual tool failures without inventing completed downloads or understanding, and do not automatically retry potentially billed model requests. Follow the persona and user's requested reply language; faithful transcription retains the original speech language unless translation was requested.

Messages, scheduled tasks and media jobs have no default total processing deadline; users can still cancel. Disabling the skill or revoking tool permission blocks subsequent calls immediately. The `bot_media` operations `transcribe`, `video_analyze`, `image_download` and `video_download` share these implementations and permissions.

Trusted private-chat users have no daily media-call count or daily accumulated video-analysis duration limit. The host uses the turn's frozen identity and current trust at execution; tool arguments cannot claim trusted identity. Per-request size, analysis duration, concurrency and storage limits still apply.

## Limitations / Known Issues

- Douyin's official pages and media CDN may fail temporarily. Only public content is processed by default; local cookies can access content the user is authorized to view.
- Multi-part Bilibili videos retain the original extractor to verify part identity. Never treat part 1 as another requested part.
- Return at most 100 images, at most 20 MiB per image and 50 MiB per downloaded batch. Video download/analysis sources are limited to 500 MiB; a video sent to QQ/WeChat is limited to 200 MiB. Analyze one video per request, at most 300 seconds. Transcode before analysis when needed; inline model video is limited to 8 MiB and the request payload to 12 MiB. Report exceeded limits rather than truncating and claiming a complete result.
- Attachment storage remains limited to 512 MiB per chat scope and 2 GiB globally. Existing attachments can prevent new video registration.
- Analysis models must support MP4 multimodal payloads. Report download capability and analysis capability separately when an upstream rejects a request or is unavailable.
- Image conversion currently rejects animated images. AVIF/WebP need their Pillow codecs; missing support produces an explicit error. Lossy AVIF alpha channels may have small precision differences.
- Full duration, a 12 fps minimum and the 10 MB GIF cap may be incompatible, especially for very long videos. Fail if a longest edge of 64 pixels and 16 colors still exceeds the cap. Video-to-GIF does not inherit the 300-second analysis limit; timestamps use GIF's hundredth-second precision. Speed depends on CPU, source material and concurrent load.
