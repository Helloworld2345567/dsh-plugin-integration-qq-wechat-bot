---
name: image-generation-openai
description: Service contract for the OpenAI-compatible image generation adapter.
---

# OpenAI-compatible image service

This service is selected when the effective image protocol is `openai`.

- The endpoint must be HTTPS, without embedded credentials, query parameters or fragments.
- The endpoint and default model come from the Services panel and are passed as explicit script arguments. When the user specifies a model, pass it through the image_generation tool's `model` parameter for that request; do not silently substitute the default. The endpoint and credential binding remain operator-owned. Image settings do not read environment variables.
- The Services panel selects the credential variable through `openAiKeyEnv`, defaulting to `OPENAI_API_KEY`. The host passes the name through `--api-key-env` and injects the corresponding credential; the adapter reads that variable directly.
- The adapter exposes only the generation and reference-edit capabilities reported by the configured provider through the fixed image worker contract; confirm the selected model's supported formats before promising one.
- GIF output can use reference images through the edit operation when the selected provider and model support it. Upload the actual selected images and send `output_format=gif`; optional animation settings are `frame_count` (2–16) and `frame_duration_ms` (20–2000). SVG remains generation-only.
- Provider responses are decoded, size-limited and normalized before the host registers an image asset.
- Provider credentials remain outside personas, prompts, logs and generated skill files.

The shared image dispatcher owns service selection and host permissions. This file defines only the OpenAI-compatible service boundary.
