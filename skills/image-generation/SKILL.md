---
name: image-generation
description: Dispatch image generation to the image service selected by operator configuration.
---

# Image generation

Use `image_generation` for an explicit request to create or edit an image. The host appends the selected service contract to the tool result; use those reported capabilities and do not inspect local service paths or guess provider support.

- For editing, use `operation="edit"` and pass the selected attachment IDs in `inputs`. The host can infer one unique image attached to or quoted in the current turn. If several images are available, select the requested references or ask which to edit. If the reference is missing, ask for it before proceeding.
- Pass `model`, `width`/`height`, `n` or `output_format` only when the user explicitly asks for them. Keep the configured service defaults otherwise.
- Generate or edit the requested number of images when the selected service reports batch support. Execute calls and retries sequentially by default. Only when the user explicitly requests parallel execution, use at most three concurrent media operations. Decide whether to retry a failed request, with at most three retries after the initial attempt (four attempts total). Correct known causes; do not change parameters merely to evade the retry limit.
- Apply the selected service's prompting guidance appended by the host. Preserve exact requested lettering. Keep selected references as uploaded inputs, give each a role, and state what must change or remain.
- The host validates and registers returned images. Do not include image Markdown, paths or asset IDs.

Credentials, endpoints and workflows are operator-owned. An invalid service or unsupported option fails closed.
