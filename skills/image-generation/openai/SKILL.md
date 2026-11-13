---
name: image-generation-openai
description: Service contract for the OpenAI-compatible image generation adapter.
---

# OpenAI-compatible image service

This service is selected when the effective image protocol is `openai`.

- The endpoint must be HTTPS, without embedded credentials, query parameters or fragments.
- The endpoint and model come from the Services panel and are passed as explicit script arguments. Image settings do not read environment variables.
- The Services panel selects the credential variable through `openAiKeyEnv`, defaulting to `OPENAI_API_KEY`. The host passes the name through `--api-key-env` and injects the corresponding credential; the adapter reads that variable directly.
- The adapter exposes only the generation and reference-edit capabilities reported by the configured provider through the fixed image worker contract; confirm the selected model's supported formats before promising one.
- Provider responses are decoded, size-limited and normalized before the host registers an image asset.
- Provider credentials remain outside personas, prompts, logs and generated skill files.

The shared image dispatcher owns service selection and host permissions. This file defines only the OpenAI-compatible service boundary.
