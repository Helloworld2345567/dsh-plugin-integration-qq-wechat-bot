---
name: media-analysis
description: Download shared media, analyze audio, documents or video, and convert image or video attachments through managed tools.
---

Use `media_download` for a supported HTTPS image, gallery or video URL. It downloads real bytes into the current session and returns an attachment ID; it does not analyze content. Pass that ID to `media_analysis` or `media_transform`.

Use `media_analysis` only with current-session attachment IDs when the current chat model cannot inspect the media natively. User-uploaded and quoted images, along with images returned by `image_generation`, are already passed to the vision-capable chat model as image input, so inspect those pixels directly and never call `media_analysis` or load this skill just to understand one of these images. Use the tool for audio transcription, document reading or video analysis when the request needs those operations. A page title, caption or cover is never a substitute for the downloaded media.

Use `media_transform` for local image/video conversion. It accepts attachment IDs only and registers successful outputs automatically. Do not start private scripts to bypass host permissions, queues or limits.

## Local conversion

Choose `image_convert`, `image_compress`, `image_resize`, `convert_mp4` or `convert_gif` from the tool schema. Supply only the options needed by the user's request. Preserve complete duration unless an excerpt was explicitly requested; the host reports actual format, dimensions, size and any partial result.

For GIF, pass the user’s byte limit as `maxBytes` (for example, 40000000 for 40 MB); the default is 10000000. The converter uses a shared 32-color palette by default, preserves duration and fps, and searches for dimensions close to the limit. A low-detail source or a dimension ceiling may leave unused budget. Platform delivery limits still apply.

## Calls

- Download shared media: `media_download(url="https://v.douyin.com/…/")`. Supports configured image, gallery and video hosts and returns `assetId`, `kind`, `mime` and `name`.
- Transcribe speech: `media_analysis(inputs=["current-session-attachment-id"], question="Transcribe faithfully")`. Use an existing platform transcription first when available.
- Analyze a document or video when native model input is unavailable: `media_analysis(inputs=["current-session-attachment-id"], question="…")`.

`media_analysis` has no URL or download action; it accepts only required `inputs` and an optional `question`. `media_transform` accepts only attachment IDs. Downloads do not require ASR or video-analysis switches. Never use model-supplied identity or filesystem paths to access another session's attachments.

## Execution and replies

The host owns URL parsing, provider selection, credentials, permissions, concurrency, storage and limits. Use only the actual tool result. Distinguish observations from inferences, state when a result is incomplete, and do not expose paths, URLs, attachment IDs or internal errors. Do not automatically retry a billed or uncertain analysis request.

If the host reports a limit, dependency failure or unavailable provider, report that result and the required user action. Never truncate media and claim the complete request succeeded.
