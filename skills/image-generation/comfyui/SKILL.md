---
name: image-generation-comfyui
description: Service contract for the local ComfyUI image generation adapter.
---

# ComfyUI image service

This is a developer reference for the `comfyui` protocol. The host supplies the local endpoint and operator-selected API workflow, then reports which prompt, reference, size, batch and output-format controls that workflow exposes.

Use only capabilities reported for the current workflow. A missing workflow control is a normal configuration error; do not substitute another workflow or expose its path. The host submits the workflow, validates returned images and registers them for delivery.
