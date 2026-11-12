---
name: image-generation-openai
description: Service contract for the OpenAI-compatible image generation adapter.
---

# OpenAI-compatible image service

This service is selected when the effective image protocol is `openai`.

- The endpoint must be HTTPS, without embedded credentials, query parameters or fragments.
- The model and credential environment-variable name come from operator configuration, with persona overrides applied by the host.
- The adapter supports the provider's generation and reference-edit endpoints through the fixed image worker contract.
- Provider responses are decoded, size-limited and normalized before the host registers an image asset.
- Provider credentials remain outside personas, prompts, logs and generated skill files.

The shared image dispatcher owns service selection and host permissions. This file defines only the OpenAI-compatible service boundary.
