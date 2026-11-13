# Tool boundary fix plan

[简体中文](../tool-boundary-fix-plan.md) | English

Implementation checklist. A media share URL must be downloaded into a real session attachment before analysis or processing.

| Tool | Change |
|---|---|
| `media_download` (new) | Accept `url` and optional `deliver` (default `false`). Detect supported image, gallery or video links, download the real media into the current session, and return `assetId/kind/mime/name`. Do not analyze the content. |
| `media_analysis` | Read image, document, audio and video attachments. Accept required `inputs` and optional `question`; the host dispatches by attachment kind. Remove URL, kind, action, delivery and download routing. |
| `media_transform` | Process existing attachments only. Include `convert_mp4` alongside image conversion, compression, resizing and video-to-GIF conversion. Reject URLs. |
| `bot_media` | Remove the public tool entry. Fold image and document reading into `media_analysis` and MP4 conversion into `media_transform`. Keep internal handlers and the existing `bot_media` permission key. |
| `image_generation` | Do not promise a fixed GPT Image 2.6 format contract. Describe the selected OpenAI-compatible service accurately; ComfyUI follows the selected workflow. |
| `skill` | When reading image-generation instructions, the host supplies the selected service description so the model does not guess capabilities or read local resource paths. |
| `bot_tools` | Distinguish downloading, analysis and conversion; remove the obsolete `image_download` and public `bot_media` entries. |
| `web_fetch`, `bot_read_social` | Answer only from retrieved page or post text. Shared media must use the download flow; page text must not stand in for video or gallery understanding. |
| `bot_session` | Remove the `stop` action; immediate stopping remains a host command. Explain that `new` starts a new context while retaining history, and clarify `/reset` without implying history deletion. |
| `bot_skills` | State in the catalog, tool description and result that enabling or disabling a skill changes the shared persona and affects sessions using it. |
| `bot_model`, `bot_voice_control` | State that changes are current-session overrides applied on the next turn; do not describe them as queued execution. |

Shared constraints: downloading does not depend on ASR or video-analysis switches; image and document reading retain the base media permission; audio/video analysis checks the skill, model and execution-time permission. Intermediate downloads are not sent automatically; register delivery only when explicitly requested.
