"""Deterministic capability summary for an API-format ComfyUI workflow.

The image host owns the workflow path and should expose only this small,
path-free summary to a model.  This module deliberately shares the same
heuristics as the ComfyUI adapter for prompt, reference, size and batch
inputs; it never executes a workflow or contacts the ComfyUI service.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any


_PROMPT_FIELDS = ("text", "prompt", "positive_prompt", "wildcard_text", "populated_text", "string_a")
REFERENCE_SLOT_UNAVAILABLE = "COMFYUI_REFERENCE_SLOT_UNAVAILABLE"


class WorkflowInspectionError(ValueError):
    """Raised when a workflow is not a supported API-format JSON object."""


def _nodes(workflow: object) -> dict[str, dict[str, Any]]:
    if not isinstance(workflow, dict):
        raise WorkflowInspectionError("COMFY_WORKFLOW_INVALID")
    candidate = workflow.get("prompt") if isinstance(workflow.get("prompt"), dict) else workflow
    if not candidate or not all(isinstance(key, str) and isinstance(node, dict) for key, node in candidate.items()):
        raise WorkflowInspectionError("COMFY_WORKFLOW_INVALID")
    return candidate


def _title(node: dict[str, Any]) -> str:
    meta = node.get("_meta")
    return str(meta.get("title", "")).lower() if isinstance(meta, dict) else ""


def _is_batch_title(title: str) -> bool:
    return (("batch" in title and "size" in title)
            or ("批量" in title and "大小" in title)
            or ("批次" in title and "大小" in title)
            or title.strip() in {"batch", "batch_size", "批量", "批量大小", "批次", "批次大小"})


def _image_output(node: dict) -> bool:
    name = "".join(char for char in str(node.get("class_type", "")).lower() if char.isalnum())
    inputs = node.get("inputs")
    if not isinstance(inputs, dict):
        return False
    if name.startswith("save") or name == "previewimage":
        return True
    # Image Saver Simple and ConditionalSaveImage have real pixel inputs;
    # Image Saver Metadata from the same extension has none.
    return ("image" in inputs or "images" in inputs) and (
        name.startswith(("imagesaver", "previewimage")) or "saveimage" in name or name.endswith("imagesave")
    )


def reference_slot(nodes: dict[str, dict[str, Any]]) -> dict | None:
    """Find the unique LoadImage upstream of a saved or previewed pixel input."""
    def linked(value):
        return (isinstance(value, list) and len(value) == 2 and type(value[1]) is int
                and value[1] >= 0 and isinstance(value[0], (str, int)) and str(value[0]) in nodes)

    pending = [str(value[0]) for node in nodes.values() if _image_output(node)
               for field, value in node["inputs"].items() if field in ("image", "images") and linked(value)]
    visited = set()
    slot = None
    while pending:
        key = pending.pop()
        if key in visited:
            continue
        visited.add(key)
        node = nodes[key]
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        if str(node.get("class_type", "")).lower() == "loadimage" and isinstance(inputs.get("image"), str):
            if slot is not None:
                return None
            slot = inputs
        output = _image_output(node)
        for field, value in inputs.items():
            if linked(value) and (not output or field in ("image", "images")):
                pending.append(str(value[0]))
    return slot


def inspect_workflow(workflow: object) -> dict[str, Any]:
    """Return a stable, path-free capability summary for *workflow*."""
    nodes = _nodes(workflow)
    prompt_fields: set[str] = set()
    width = height = batch = False
    output_nodes = 0

    for node in nodes.values():
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        class_type = str(node.get("class_type", "")).lower()
        title = _title(node)
        negative = any(marker in title or marker in class_type for marker in ("negative", "负面", "负向"))
        if not negative:
            for field in _PROMPT_FIELDS:
                if isinstance(inputs.get(field), str):
                    prompt_fields.add(field)
            if isinstance(inputs.get("value"), str) and ("primitive" in class_type or "prompt" in title or "提示词" in title):
                prompt_fields.add("value")

        if class_type == "sizepicker":
            width = width or "width_override" in inputs
            height = height or "height_override" in inputs
            batch = batch or "batch_size" in inputs
        if class_type == "resolutionpreset":
            raw_resolution = inputs.get("resolution_json")
            try: resolution = json.loads(raw_resolution) if isinstance(raw_resolution, str) else None
            except json.JSONDecodeError: resolution = None
            if isinstance(resolution, dict) and resolution.get("version") == 1:
                width = width or "width" in resolution
                height = height or "height" in resolution

        value_key = "value" if "value" in inputs else "size" if "size" in inputs else None
        scalar_value = value_key is not None and not isinstance(inputs.get(value_key), (list, tuple, dict))
        if scalar_value:
            width = width or "width" in title
            height = height or "height" in title
            batch = batch or _is_batch_title(title)

        if class_type.startswith("empty") and "latent" in class_type:
            width = width or isinstance(inputs.get("width"), (int, float)) and not isinstance(inputs.get("width"), bool)
            height = height or isinstance(inputs.get("height"), (int, float)) and not isinstance(inputs.get("height"), bool)
            batch = batch or isinstance(inputs.get("batch_size"), (int, float)) and not isinstance(inputs.get("batch_size"), bool)

        if "batch_size" in inputs:
            batch = True
        if _image_output(node):
            output_nodes += 1

    return {
        "status": "PASS",
        "nodeCount": len(nodes),
        "outputNodeCount": output_nodes,
        "capabilities": {
            "prompt": bool(prompt_fields),
            "promptFields": sorted(prompt_fields),
            "referenceEdit": reference_slot(nodes) is not None,
            "resolution": {"width": width, "height": height, "paired": width and height},
            "batch": batch,
            # ComfyUI output is materialized by the host; these are the final
            # attachment formats supported by the adapter, not workflow hints.
            "outputFormats": ["png", "jpeg"],
        },
    }


def inspect_workflow_file(path: str | Path) -> dict[str, Any]:
    """Read and inspect one local workflow without returning its path."""
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise WorkflowInspectionError("COMFY_WORKFLOW_INVALID") from exc
    return inspect_workflow(value)


__all__ = ["WorkflowInspectionError", "inspect_workflow", "inspect_workflow_file"]
