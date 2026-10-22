---
name: image-generation
description: Generate images or edit user-selected reference images through a configured OpenAI-compatible image API. Use for explicit image creation or editing requests; do not use for ordinary chat, slash commands, bracketed control instructions, or requests explicitly excluding images.
---

# Image generation and reference editing

In this Harness plugin, call `image_generation` with an English `prompt`, `operation=generate` or `edit`, and `inputs` containing current-session reference attachment IDs. The tool directly runs this skill's bundled [Python client](scripts/image_api.py) in the managed worker and automatically registers the resulting image for delivery. No separate image-provider setup is required. Do not run scripts or supply local paths from a chat. `bot_media(image_generate/image_edit)` remains an equivalent compatibility entry point.

## Decide whether to run

- Run for an explicit request to create or edit an image. A request without reference images can still create a new image; a reference-edit request must have the specified inputs.
- Do not generate for `/stop`, other slash commands, messages containing `[]` control instructions, or an explicit request not to generate an image.
- A failed attempt does not consume the turn's image allowance; another tool call can retry after correcting the cause. Do not call generation in parallel or produce a second successful image. Do not automatically retry a timeout or an unknown provider result.
- Follow the current tool permissions. This skill does not grant administrator access or bypass confirmation for host operations.
- If the user requests a reference edit, use their actual selected image(s), including their selected ordinal. If a specified image is missing, ask them to resend it; never substitute a text-only generation.

## Configure

Credentials come from `IMAGE_ACCESS_KEY` by default; existing `SAKURA_IMAGE_API_KEY` is supported as a fallback. Operators can set `BOT_IMAGE_KEY_ENV` to another variable's name, `BOT_IMAGE_BASE_URL` for the provider and `BOT_IMAGE_MODEL` for the model. Existing `SAKURA_IMAGE_BASE_URL`, `SAKURA_IMAGE_MODEL` and `OPENAI_BASE_URL` aliases are also supported. Never put the secret itself in a prompt, command argument, example, log or committed file. Generic defaults remain `https://api.openai.com/v1` and `gpt-image-2`; HTTPS is required.

The plugin and standalone client use the same environment contract. Optional per-persona overrides take precedence over the environment; absent values inherit, rather than disable, the skill. The UI has an explicit disable switch. Custom provider defaults belong in the operator's runtime environment, never in this portable source. Only the selected image key is forwarded to the media worker.

Locate this skill using the `SKILL.md` path supplied by the host, then resolve `scripts/image_api.py` relative to that directory. Do not assume the host's installation path, operating system or working directory. Commands below run from this skill directory, in the Python environment that has `requests` installed.

## Generate one image

```sh
python scripts/image_api.py generate --prompt "An adult silver-haired catgirl maid greeting the viewer, expressive emerald eyes, soft light, simple background, anime illustration, 3:2 framing" --model gpt-image-2 --n 1 --output-format jpeg --output-compression 96 --output-dir assets
```

## Edit the selected reference image

```sh
python scripts/image_api.py edit --prompt "Use the attached pose reference. Replace the main subject with adult Sakura, a silver-haired catgirl maid with emerald eyes. Preserve the action and camera framing; change only the character identity." --image reference.png --model gpt-image-2 --n 1 --output-format jpeg --output-dir assets
```

Repeat `--image` for additional user-selected references. State the role of each input in the prompt. `n` is the output count, not the number of inputs. Use `--mask mask.png` for an optional PNG mask. Paths in examples are placeholders for user-provided files.

Use `--dry-run` to validate options without sending a request or requiring a key. Input files must still exist for edit validation. `--record assets/request.json` optionally saves a key-redacted request/result record; it can contain private prompts and local paths, so keep it out of shared repositories.

## Validate and deliver

Translate descriptive prompts into clear English, preserving exact requested lettering verbatim. Keep the requested subject, pose, style and edit invariants; do not add unrelated changes. The client uses only the options described in its contract, and makes no guarantee that a provider supports a particular model or parameter.

Inspect the saved output, verify the requested edit and actual image format, and report the returned count. JPEG is the default and the client normalizes provider PNG/WebP responses to JPEG when `--output-format jpeg` is selected. An HTTP success is not visual validation. Deliver the actual file using the host's image-send capability; do not expose a host-local path as if a remote chat user could open it. On failure, report the stage and available evidence without exposing secrets or claiming an image was generated or sent. Do not silently retry the whole batch or fall back from editing to generation.
