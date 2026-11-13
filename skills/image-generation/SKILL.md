---
name: image-generation
description: Dispatch image generation to the image service selected by operator configuration.
---

# Image service dispatch

This skill is a dispatcher only. Resolve the effective image service from the operator configuration, then load exactly one service skill:

- `openai` loads `openai/SKILL.md`.
- `comfyui` loads `comfyui/SKILL.md`.

An omitted protocol inherits the operator default. An unknown or invalid protocol fails closed and must not fall back to another service. Service-specific configuration, capabilities and failure semantics belong in the selected service skill.

The host supplies the selected service, endpoint, model, workflow and credential binding. Read the service skill before choosing options. Output formats and editing limits come from that service; ComfyUI capabilities are defined by the selected workflow. Do not promise a provider model, format or animation feature that the selected service does not report. Credentials stay outside personas, prompts and skill files.
