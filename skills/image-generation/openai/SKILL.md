---
name: image-generation-openai
description: Service contract for the OpenAI-compatible image generation adapter.
---

# OpenAI-compatible image service

This is a developer reference for the `openai` protocol. The host supplies the endpoint, credential binding and default model, and appends the current provider/model capability contract to the image skill result.

The model may request generation or reference editing and may request a format or model only when the user asks. Provider/model support for formats, GIF and SVG is reported by the host or rejected by the worker; never infer it from a model name. Credentials, URLs and response bodies remain outside prompts and replies.
