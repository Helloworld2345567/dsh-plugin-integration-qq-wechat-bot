---
name: image-generation-comfyui
description: Compose Anima and Krea 2 prompts for the configured ComfyUI image workflow.
---

# ComfyUI image generation

Use the host service contract's `workflowModel.family`, `variant` and `checkpoints` to select the guidance below. The host derives this frozen, path-free summary from model-loading nodes connected to workflow outputs; `checkpoints` contains weight filenames only. The service label `comfyui` is not a model identity. If the family or variant is `unknown`, use only confirmed guidance and omit variant-specific tags; for an unknown family use a faithful natural-language scene description. Do not guess from the requested art style or switch workflows.

The `image_generation` tool accepts a positive `prompt` only. Negative prompts and sampling settings belong to the configured workflow; never paste a negative list, sampler settings or instructions to the assistant into the positive prompt. Use only reported workflow capabilities. Keep endpoints and workflow paths operator-owned.

## Anima

Anima supports Danbooru-style tags, natural-language captions, or a mixture. It is designed for anime, illustration and art; photorealism and long rendered text are weak points.

- Write tags in lowercase with spaces between words; only `score_*` tags retain underscores. Prefer Gelbooru names where they differ from Danbooru. Use the order: quality/meta/year/safety tags, subject count (`1girl`, `1boy`, etc.), character, series, artist, general tags. Order within each group is flexible. Avoid exhaustive tag lists.
- Prefix artist tags with `@`, such as `@artist name`, when an artist is requested.
- For pure natural language, write at least two descriptive sentences covering the subject, appearance and scene. Use normal capitalization for character and series names. For known characters, name the character and series, then describe basic appearance; in multi-character scenes, bind each character's appearance and actions to that character.
- Tags can precede or mix with prose. Optional emphasis such as `(chibi:2)` is supported; Anima may need stronger weights than SDXL, but do not weight every detail automatically.
- For non-photographic art, optional dataset tags `ye-pop` or `deviantart` can occupy the first line, followed by a natural-language description. They are not universal prefixes.

Checkpoint-specific quality guidance:

- **Base:** the official recommended starting prefix is `masterpiece, best quality, score_7, safe, `. Quality and score tags are optional, not mandatory. Match the safety tag to the requested content instead of blindly adding `safe`.
- **Aesthetic:** quality tags are unnecessary, though `masterpiece, best quality` remain acceptable. Omit `score_*` from both positive and workflow negative prompts; the official card warns that they overemphasize formulaic aesthetics.
- **Turbo:** the official card gives no separate prompt template. Do not invent Turbo-specific trigger words or infer its checkpoint rules from speed alone.

The official Base negative starting point is `worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration`. This is workflow configuration guidance, not text for this tool's positive `prompt`; do not apply its score tags to Aesthetic.

Example Base positive prompt for a requested anime girl reading in a sunlit library:

```text
masterpiece, best quality, score_7, safe, 1girl, reading, library, sunlight. A girl reads an open book at a table beside a library window. Sunlight falls across the pages, with bookshelves behind her.
```

## Krea 2

Use natural language. Longer, detailed descriptions generally work best, but short prompts can also produce high-quality images; no fixed length or elaborate prompt syntax is required.

- Expand faithfully: preserve the subject, action, colors and spatial relationships. Do not introduce extra objects, props, people or animals unless implied by the request, or invent overly specific clothing, materials and scenery.
- Keep each subject's attributes and actions together. Describe poses, interactions and spatial layout concretely. Add useful composition, framing, lighting and atmosphere consistent with the request.
- Preserve the requested medium: photograph, illustration, painting, sketch or 3D render. Lightly polish an already detailed prompt instead of changing its creative direction.
- Put exact visible lettering in quotation marks, preserving the user's text verbatim.
- Submit one coherent paragraph, without bullets, JSON, Markdown, planning labels or explanations. Natural-language phrases separated by commas are also valid.
- Do not import Anima quality/score tags or a generic negative-word list. The official Krea 2 guide supplies no negative-prompt recipe. Keep Raw/Turbo sampling differences in the workflow, outside the prompt.

## Official sources

- [Anima model card and prompting guide](https://huggingface.co/circlestone-labs/Anima/blob/main/README.md#prompting)
- [Krea 2 prompting guide](https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md)
- [Krea 2 official prompt-expansion instructions](https://github.com/krea-ai/krea-2/blob/main/docs/expansion.txt)
