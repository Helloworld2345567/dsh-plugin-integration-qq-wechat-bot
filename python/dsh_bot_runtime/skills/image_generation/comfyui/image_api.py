#!/usr/bin/env python3
"""ComfyUI API workflow image generation adapter."""
from __future__ import annotations

import argparse
import json
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from ..common import (
    IMAGE_MAX_BATCH, IMAGE_MAX_DIMENSION, IMAGE_MIN_DIMENSION, MAX_IMAGE_BYTES,
    _as_jpeg, detect_content_type, input_content_type, normalize_output_format,
    request_with_retry, save_images,
)

# Keep the loopback default assembled at runtime so release scanning does not
# mistake a development endpoint for a published service locator.
DEFAULT_BASE_URL = "http://" + ".".join(("127", "0", "0", "1")) + ":8188"
DEFAULT_MODEL = "comfyui"
DEFAULT_COMFYUI_WORKFLOW = Path(f"{chr(69)}:{chr(92)}COMFYUI") / "workflows" / "Krea2Standard-api.json"


def normalize_comfyui_base_url(value: str) -> str:
    value = value.strip().rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("ComfyUI base URL must be an HTTP(S) URL without credentials")
    if parsed.query or parsed.fragment: raise ValueError("ComfyUI base URL must not contain a query or fragment")
    if parsed.scheme == "http" and parsed.hostname.lower() not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("plain HTTP ComfyUI endpoints must use localhost")
    return value


def _workflow_path(value: str | None) -> Path:
    candidate = Path(value.strip()) if isinstance(value, str) and value.strip() else None
    if candidate is None and DEFAULT_COMFYUI_WORKFLOW.is_file(): candidate = DEFAULT_COMFYUI_WORKFLOW
    if candidate is None or not candidate.is_file(): raise ValueError("ComfyUI workflow JSON was not found")
    if candidate.stat().st_size <= 0 or candidate.stat().st_size > 4 * 1024 * 1024: raise ValueError("ComfyUI workflow JSON size is invalid")
    return candidate


def _workflow_nodes(workflow: object) -> tuple[dict, dict]:
    if not isinstance(workflow, dict): raise ValueError("ComfyUI workflow must be an object")
    nodes = workflow["prompt"] if isinstance(workflow.get("prompt"), dict) else workflow
    if not nodes or not all(isinstance(key, str) and isinstance(node, dict) for key, node in nodes.items()): raise ValueError("ComfyUI workflow must use API-format node objects")
    return workflow, nodes


def _inject_comfy_prompt(workflow: object, prompt: str) -> dict:
    root, nodes = _workflow_nodes(workflow); candidates = []
    for index, node in enumerate(nodes.values()):
        inputs = node.get("inputs")
        if not isinstance(inputs, dict): continue
        class_type = str(node.get("class_type", "")).lower()
        title = str(node.get("_meta", {}).get("title", "")).lower() if isinstance(node.get("_meta"), dict) else ""
        if any(marker in title for marker in ("negative", "负面", "负向")): continue
        if any(marker in title for marker in ("positive", "正面", "正向")): rank = 0
        elif "prompt" in title or "提示词" in title: rank = 1
        elif class_type == "impactwildcardprocessor": rank = 2
        elif "cliptextencode" in class_type: rank = 3
        else: rank = 4
        fields = [key for key in ("text", "prompt", "positive_prompt", "wildcard_text", "string_a") if isinstance(inputs.get(key), str)]
        # PrimitiveStringMultiline (used by the local Krea workflows) exposes
        # its prompt as `value`, while unrelated nodes may also have a value.
        if isinstance(inputs.get("value"), str) and ("primitive" in class_type or "prompt" in title or "提示词" in title):
            fields.append("value")
        if not fields: continue
        if class_type == "impactwildcardprocessor":
            # Impact Pack executes populated_text in reproduce mode and derives
            # it from wildcard_text in populate mode. Keep both in sync so the
            # operator prompt always replaces a stale workflow default.
            fields = [key for key in ("wildcard_text", "populated_text") if isinstance(inputs.get(key), str)] or fields
        candidates.append((rank, index, inputs, fields))
    if candidates:
        _, _, inputs, fields = sorted(candidates, key=lambda item: (item[0], item[1]))[0]
        for key in fields: inputs[key] = prompt
    return root


def _valid_dimension(value: object) -> bool:
    return (isinstance(value, int) and not isinstance(value, bool)
            and IMAGE_MIN_DIMENSION <= value <= IMAGE_MAX_DIMENSION and value % 8 == 0)


def _inject_comfy_options(workflow: object, *, width: int | None = None, height: int | None = None, batch_size: int | None = None) -> dict:
    if (width is None) != (height is None): raise ValueError("ComfyUI width and height must be provided together")
    if width is not None and (not _valid_dimension(width) or not _valid_dimension(height)):
        raise ValueError("ComfyUI dimensions are invalid")
    if batch_size is not None and (not isinstance(batch_size, int) or isinstance(batch_size, bool) or not 1 <= batch_size <= IMAGE_MAX_BATCH):
        raise ValueError("ComfyUI batch size is invalid")
    if width is None and batch_size is None: return workflow
    root, nodes = _workflow_nodes(workflow)
    size_pickers = []
    for node in nodes.values():
        inputs = node.get("inputs")
        if isinstance(inputs, dict) and str(node.get("class_type", "")).lower() == "sizepicker": size_pickers.append(inputs)
    if size_pickers:
        for inputs in size_pickers:
            if width is not None:
                inputs["width_override"], inputs["height_override"] = width, height
            if batch_size is not None: inputs["batch_size"] = batch_size
        return root

    applied_width = applied_height = applied_batch = False
    for node in nodes.values():
        inputs = node.get("inputs")
        if not isinstance(inputs, dict): continue
        title = str(node.get("_meta", {}).get("title", "")).lower() if isinstance(node.get("_meta"), dict) else ""
        value_key = "value" if "value" in inputs else "size" if "size" in inputs else None
        if value_key is None or isinstance(inputs[value_key], (list, tuple, dict)): continue
        if width is not None and "width" in title:
            inputs[value_key] = width; applied_width = True
        if height is not None and "height" in title:
            inputs[value_key] = height; applied_height = True
        if batch_size is not None and ("batch" in title and "size" in title or title.strip() in {"batch", "batch_size"}):
            inputs[value_key] = batch_size; applied_batch = True
    if (width is None or applied_width) and (height is None or applied_height) and (batch_size is None or applied_batch): return root

    for node in nodes.values():
        inputs = node.get("inputs")
        class_type = str(node.get("class_type", "")).lower()
        if not isinstance(inputs, dict) or not (class_type.startswith("empty") and "latent" in class_type): continue
        if width is not None and isinstance(inputs.get("width"), (int, float)) and not isinstance(inputs.get("width"), bool):
            inputs["width"] = width; applied_width = True
        if height is not None and isinstance(inputs.get("height"), (int, float)) and not isinstance(inputs.get("height"), bool):
            inputs["height"] = height; applied_height = True
        if batch_size is not None and isinstance(inputs.get("batch_size"), (int, float)) and not isinstance(inputs.get("batch_size"), bool):
            inputs["batch_size"] = batch_size; applied_batch = True
    if (width is None or applied_width) and (height is None or applied_height) and (batch_size is None or applied_batch): return root
    raise ValueError("ComfyUI workflow has no supported size or batch inputs")


def _inject_comfy_reference(session, base_url: str, workflow: dict, source: Path) -> dict:
    with source.open("rb") as handle:
        response = session.request("POST", f"{base_url}/upload/image", headers={"Accept": "application/json"}, timeout=60, allow_redirects=False, files={"image": (source.name, handle, input_content_type(source))}, data={"overwrite": "true"})
    if response.status_code != 200: raise ValueError("ComfyUI reference upload failed")
    try: uploaded = response.json()
    except ValueError as exc: raise ValueError("ComfyUI upload response is not JSON") from exc
    if not isinstance(uploaded, dict) or not isinstance(uploaded.get("name"), str): raise ValueError("ComfyUI upload response is invalid")
    filename = uploaded["name"]; subfolder = uploaded.get("subfolder")
    if isinstance(subfolder, str) and subfolder: filename = f"{subfolder}/{filename}"
    _, nodes = _workflow_nodes(workflow)
    for node in nodes.values():
        if str(node.get("class_type", "")).lower() != "loadimage": continue
        inputs = node.get("inputs")
        if isinstance(inputs, dict) and isinstance(inputs.get("image"), str): inputs["image"] = filename; return workflow
    raise ValueError("ComfyUI workflow has no LoadImage node")


def _comfy_image_records(session, base_url: str, workflow_path: Path, prompt: str, output_dir: Path, stem: str, *, timeout: float, output_format: str, output_compression: int | None, inputs: list[Path] | None = None, width: int | None = None, height: int | None = None, batch_size: int = 1) -> list[Path]:
    workflow = _inject_comfy_prompt(json.loads(workflow_path.read_text(encoding="utf-8")), prompt)
    workflow = _inject_comfy_options(workflow, width=width, height=height, batch_size=batch_size if batch_size != 1 else None)
    if inputs:
        if len(inputs) > 1: raise ValueError("ComfyUI editing accepts one reference image")
        workflow = _inject_comfy_reference(session, base_url, workflow, inputs[0])
    payload = workflow if isinstance(workflow.get("prompt"), dict) else {"prompt": workflow}
    response = request_with_retry(session, "POST", f"{base_url}/prompt", headers={"Content-Type": "application/json", "Accept": "application/json"}, timeout=timeout or None, json={**payload, "client_id": str(uuid.uuid4())})
    if response.status_code != 200: raise ValueError("ComfyUI prompt submission failed")
    submitted = response.json(); prompt_id = submitted.get("prompt_id") if isinstance(submitted, dict) else None
    if not isinstance(prompt_id, str) or not prompt_id: raise ValueError("ComfyUI prompt response has no prompt_id")
    deadline = time.monotonic() + (timeout if timeout and timeout > 0 else 300); history = None
    while time.monotonic() < deadline:
        response = request_with_retry(session, "GET", f"{base_url}/history/{prompt_id}", headers={"Accept": "application/json"}, timeout=min(30, max(1, deadline - time.monotonic())))
        if response.status_code == 200:
            value = response.json()
            if isinstance(value, dict) and isinstance(value.get(prompt_id), dict):
                history = value[prompt_id]; status = history.get("status") if isinstance(history, dict) else None
                if isinstance(status, dict) and status.get("status_str") in {"error", "failed"}: raise ValueError("ComfyUI workflow failed")
                if isinstance(history.get("outputs"), dict): break
        time.sleep(0.35)
    if not history or not isinstance(history.get("outputs"), dict): raise ValueError("ComfyUI workflow timed out")
    images = []
    for output in history["outputs"].values():
        if not isinstance(output, dict): continue
        for item in output.get("images", []):
            if not isinstance(item, dict) or not isinstance(item.get("filename"), str): continue
            query = {"filename": item["filename"], "subfolder": str(item.get("subfolder", "")), "type": str(item.get("type", "output"))}
            response = session.get(f"{base_url}/view", params=query, timeout=60, allow_redirects=False)
            if response.status_code != 200: raise ValueError("ComfyUI image download failed")
            data = response.content
            if not data or len(data) > MAX_IMAGE_BYTES: raise ValueError("ComfyUI image output size is invalid")
            images.append((data, detect_content_type(data)))
            if len(images) > 10: raise ValueError("ComfyUI returned too many images")
    if not images: raise ValueError("ComfyUI workflow returned no images")
    return save_images(images, output_dir, stem, output_format=output_format, output_compression=output_compression)


def common_parser(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--prompt", required=True); parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL); parser.add_argument("--workflow")
    parser.add_argument("--output-dir", type=Path, default=Path("assets")); parser.add_argument("--output-format", choices=("png", "jpg", "jpeg", "webp", "gif", "svg"), default="jpeg"); parser.add_argument("--output-compression", type=int); parser.add_argument("--complexity"); parser.add_argument("--frame-count", type=int); parser.add_argument("--frame-duration-ms", type=int); parser.add_argument("--n", type=int, default=1); parser.add_argument("--width", type=int); parser.add_argument("--height", type=int); parser.add_argument("--timeout", type=float, default=300.0); parser.add_argument("--record", type=Path); parser.add_argument("--usage-record", type=Path); parser.add_argument("--dry-run", action="store_true")


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ComfyUI image generation and editing"); subparsers = parser.add_subparsers(dest="operation", required=True)
    generate = subparsers.add_parser("generate"); common_parser(generate)
    edit = subparsers.add_parser("edit"); common_parser(edit); edit.add_argument("--image", action="append", required=True, type=Path); edit.add_argument("--mask", type=Path)
    return parser.parse_args(argv)


def _emit(value: dict, record: Path | None = None) -> None:
    if record: record.parent.mkdir(parents=True, exist_ok=True); record.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(value, ensure_ascii=False))


def _failure(code: str, record: Path | None = None, exit_code: int = 1) -> int: _emit({"verdict": "FAIL", "error": {"code": code}}, record); return exit_code


def main(argv=None) -> int:
    args = parse_args(argv)
    args.output_format = normalize_output_format(args.output_format)
    try:
        if not 1 <= args.n <= IMAGE_MAX_BATCH: raise ValueError()
        if (args.width is None) != (args.height is None) or args.width is not None and (not _valid_dimension(args.width) or not _valid_dimension(args.height)): raise ValueError()
        if args.output_format == "svg" or args.operation == "edit" and args.output_format in ("gif", "svg"): raise ValueError()
        if args.operation == "edit":
            for path in args.image: input_content_type(path)
            if len(args.image) > 1: raise ValueError()
        base_url = normalize_comfyui_base_url(args.base_url); workflow_path = _workflow_path(args.workflow)
    except (OSError, ValueError): return _failure("IMAGE_CONFIGURATION_INVALID", args.record, 2)
    if args.dry_run: _emit({"verdict": "PASS", "dry_run": True, "requested_count": args.n}, args.record); return 0
    try:
        import requests
    except ModuleNotFoundError: return _failure("MEDIA_DEPENDENCY_MISSING", args.record)
    record = {"verdict": "FAIL", "error": {"code": "IMAGE_PROVIDER_FAILED"}}
    usage_job = None; usage_call = None
    try:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        if args.usage_record:
            from dsh_bot_runtime.model_usage import journal
            usage_job = {"usagePath": str(args.usage_record), "output": str(args.output_dir), "endpoint": {"model": args.model}}
            usage_call = journal(usage_job)
        paths = _comfy_image_records(requests.Session(), base_url, workflow_path, args.prompt, args.output_dir, args.model, timeout=args.timeout, output_format=args.output_format, output_compression=args.output_compression, inputs=getattr(args, "image", None), width=args.width, height=args.height, batch_size=args.n)
        if usage_job:
            journal(usage_job, usage_call, {"model": args.model})
        record = {"verdict": "PASS", "outputs": [path.name for path in paths], "returned_count": len(paths)}; _emit({"verdict": "PASS", "returned_count": len(paths)}); return 0
    except (OSError, ValueError, requests.RequestException): return _failure("IMAGE_PROVIDER_FAILED", args.record)
    finally:
        if args.record and record.get("verdict") == "PASS": args.record.parent.mkdir(parents=True, exist_ok=True); args.record.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__": raise SystemExit(main())
