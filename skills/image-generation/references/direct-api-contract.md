# Bundled image client contract

This document describes the bundled `dsh_bot_runtime.skills.image_generation.image_api` client. It does not promise identical capabilities from every compatible provider. The plugin and standalone operator checks use the same client.

## Connection and credentials

- Set the service through `--protocol`, the endpoint through `--base-url`, and the OpenAI-compatible model through `--model`. ComfyUI uses `--workflow` for an API-format workflow file. These settings do not read environment variables; the bot passes values saved in the Services panel.
- Script defaults are protocol `openai`, OpenAI-compatible endpoint `https://api.openai.com/v1` and model `gpt-image-2`; use explicit arguments for the selected service.
- The OpenAI-compatible adapter reads the credential variable named by `--api-key-env`, defaulting to `OPENAI_API_KEY`. The bot passes the Services panel's `openAiKeyEnv` setting and injects the corresponding credential into the worker. There are no legacy credential aliases.
- Credentials are read from the environment and sent as a Bearer header. Only HTTPS API URLs without embedded credentials, query or fragment are accepted. Redirects are disabled.
- A missing selected credential produces a configuration error. The plugin checks the selected variable before starting the client. Direct CLI calls use `--api-key-env` or its `OPENAI_API_KEY` default without an interactive prompt; an empty selected variable does not fall back to another key.

## Generation

`POST {base_url}/images/generations` with a JSON body containing `model`, `prompt`, `n`, and supported output options.

## Reference editing

`POST {base_url}/images/edits` with multipart form data. The text fields include `model`, `prompt`, `n`, and output options. Every selected input is uploaded as a repeated `image` field. An optional PNG mask uses `mask`.

```python
files = [
    ("image", (target.name, target_handle, target_mime)),
    ("image", (reference.name, reference_handle, reference_mime)),
]
```

Do not collapse these fields into a dictionary. Input count is independent of `n`. Preserve the actual selected source bytes, rather than replacing the reference with a text description.

## Parameters and limits

- `n`: 1–10; omit it unless the user explicitly requests a batch count. Sakura automatic illustration requests exactly 1 output.
- `output_format`: `png`, `jpg`/`jpeg`, `webp`, `svg`, or `gif`. JPEG is the default; `jpg` is normalized to JPEG. SVG and GIF are generation-only formats; SVG requires `n=1`.
- `width` and `height`: optional paired dimensions for ComfyUI workflows, 64–4096 pixels in multiples of 8. Omit them unless the user explicitly requests a resolution; the selected workflow must expose supported size inputs.
- `output_compression`: 0–100 for JPEG/WebP; default 96. Do not send it for PNG, SVG, or GIF.
- `background`: optional `auto`, `opaque`, or `transparent`; transparency is only sent with PNG/WebP.
- `complexity`: optional `low`, `medium`, or `high` only when the selected provider reports support.
- `frame_count`: 2–64 and `frame_duration_ms`: 20–2000 for GIF generation only.
- The client omits `quality` and `size`; describe composition and framing in the prompt.
- Each input must be a non-empty PNG/JPEG/WebP file no larger than 10 MiB. Masks must be PNG. Combined input bytes must not exceed 22 MiB.
- Combined outputs are capped at 24 MiB. When `output_format=jpeg`, the script decodes and re-encodes every successful output as JPEG, even if a compatible provider returns PNG or WebP. Other formats retain their requested format; SVG/GIF fail closed if the provider returns a different signature.

Providers must support the parameters being sent. Use an actual provider-supported model; do not infer availability from its name or from another service's documentation.

## Results and failures

The client accepts an image body or JSON `data` items containing `b64_json` or an HTTPS image URL. It validates file signatures and caps downloads. It reports `requested_count` and `returned_count`, and preserves completed outputs.

Billed requests and requests with uncertain outcomes are not automatically replayed. Authentication, rate-limit and network failures are not silently retried. CLI failures print stable error codes only; records do not save endpoints, credentials, prompts, input paths or provider bodies. Model invocation, output checks and platform delivery remain separately reported.
