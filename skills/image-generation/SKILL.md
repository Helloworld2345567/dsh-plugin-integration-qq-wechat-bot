---
name: image-generation
description: Dispatch image generation to the image service selected by operator configuration.
---

# Image service dispatch

This skill is a dispatcher only. Resolve the effective image service from the operator and persona configuration, then load exactly one service skill:

- `openai` loads `openai/SKILL.md`.
- `comfyui` loads `comfyui/SKILL.md`.

An omitted protocol inherits the operator default. An unknown or invalid protocol fails closed and must not fall back to another service. Service-specific configuration, capabilities and failure semantics belong in the selected service skill.
