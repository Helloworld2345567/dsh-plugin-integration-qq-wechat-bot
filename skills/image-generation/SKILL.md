---
name: image-generation
description: Dispatch image generation to the image service selected by operator configuration.
---

# Image generation

Use `image_generation` for an explicit request to create or edit an image. The host appends the selected service contract to the tool result; use those reported capabilities and do not inspect local service paths or guess provider support.

- Use `operation="edit"` when the user selected reference images; otherwise use generation.
- Pass `model`, `width`/`height`, `n` or `output_format` only when the user explicitly asks for them. Keep the configured service defaults otherwise.
- Make one image call per turn. Retry only after a returned configuration error has been corrected; do not replay an unknown or timed-out request.
- Describe the requested subject, composition, style and exact lettering in the prompt. Keep selected references as uploaded inputs and state what must change or remain.
- The host validates and registers returned images. Report the actual count, format and delivery state; do not include image Markdown, paths or asset IDs.

Credentials, endpoints and workflows are operator-owned. An invalid service or unsupported option fails closed.
