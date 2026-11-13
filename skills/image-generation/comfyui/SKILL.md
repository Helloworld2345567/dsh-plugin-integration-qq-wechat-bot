---
name: image-generation-comfyui
description: Service contract for the local ComfyUI image generation adapter.
---

# ComfyUI image service

This service is selected when the effective image protocol is `comfyui`.

- The endpoint is a local HTTP(S) ComfyUI API and the workflow is an operator-selected API-format JSON document. Formats, editing and optional inputs are limited to nodes in that workflow; do not infer capabilities from another workflow or provider.
- The Services panel owns the endpoint and workflow; the host passes them as explicit script arguments. ComfyUI settings do not read environment variables.
- The adapter submits a workflow, waits for the matching history record and materializes image outputs through the ComfyUI view endpoint.
- Prompt injection targets supported text inputs in the configured workflow; workflows without a text input remain valid for deterministic image jobs.
- Reference edits upload the selected image to ComfyUI and connect it to the workflow's image input.
- The host validates output files, bounds their size and keeps all workflow paths and service details operator-owned.

The shared image dispatcher owns service selection and host permissions. This file defines only the ComfyUI service boundary.
