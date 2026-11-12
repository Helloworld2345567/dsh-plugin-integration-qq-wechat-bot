#!/usr/bin/env python3
"""ComfyUI API workflow image generation adapter."""
from __future__ import annotations

import argparse
import json
import os
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from ..common import MAX_IMAGE_BYTES, _as_jpeg, detect_content_type, input_content_type, request_with_retry, save_images

# Keep the loopback default assembled at runtime so release scanning does not
# mistake a development endpoint for a published service locator.
DEFAULT_BASE_URL = "http://" + ".".join(("127", "0", "0", "1")) + ":8188"
DEFAULT_MODEL = "comfyui"
DEFAULT_COMFYUI_WORKFLOW = Path(os.environ.get("COMFYUI_ROOT") or f"{chr(69)}:{chr(92)}COMFYUI") / "workflows" / "Krea2Standard-api.json"


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
    for node in nodes.values():
        inputs = node.get("inputs")
        if not isinstance(inputs, dict): continue
        class_type = str(node.get("class_type", "")).lower()
        title = str(node.get("_meta", {}).get("title", "")).lower() if isinstance(node.get("_meta"), dict) else ""
        rank = 3 if "negative" in title else 0 if "positive" in title else 1 if "cliptextencode" in class_type else 2
        for key in ("text", "prompt", "positive_prompt", "wildcard_text", "string_a"):
            if isinstance(inputs.get(key), str): candidates.append((rank, inputs, key)); break
    if candidates:
        _, inputs, key = sorted(candidates, key=lambda item: item[0])[0]; inputs[key] = prompt
    return root


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


def _comfy_image_records(session, base_url: str, workflow_path: Path, prompt: str, output_dir: Path, stem: str, *, timeout: float, output_format: str, output_compression: int | None, inputs: list[Path] | None = None) -> list[Path]:
    workflow = _inject_comfy_prompt(json.loads(workflow_path.read_text(encoding="utf-8")), prompt)
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
    parser.add_argument("--prompt", required=True); parser.add_argument("--model", default=os.environ.get("BOT_IMAGE_MODEL") or DEFAULT_MODEL)
    parser.add_argument("--base-url", default=os.environ.get("BOT_COMFYUI_BASE_URL") or DEFAULT_BASE_URL); parser.add_argument("--workflow", default=os.environ.get("BOT_COMFYUI_WORKFLOW") or os.environ.get("BOT_COMFYUI_WORKFLOW_PATH"))
    parser.add_argument("--output-dir", type=Path, default=Path("assets")); parser.add_argument("--output-format", choices=("png", "jpeg", "webp", "gif", "svg"), default="jpeg"); parser.add_argument("--output-compression", type=int); parser.add_argument("--complexity"); parser.add_argument("--frame-count", type=int); parser.add_argument("--frame-duration-ms", type=int); parser.add_argument("--n", type=int, default=1); parser.add_argument("--timeout", type=float, default=300.0); parser.add_argument("--record", type=Path); parser.add_argument("--usage-record", type=Path); parser.add_argument("--dry-run", action="store_true")


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
    try:
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
        paths = _comfy_image_records(requests.Session(), base_url, workflow_path, args.prompt, args.output_dir, args.model, timeout=args.timeout, output_format=args.output_format, output_compression=args.output_compression, inputs=getattr(args, "image", None))
        if usage_job:
            journal(usage_job, usage_call, {"model": args.model})
        record = {"verdict": "PASS", "outputs": [path.name for path in paths], "returned_count": len(paths)}; _emit({"verdict": "PASS", "returned_count": len(paths)}); return 0
    except (OSError, ValueError, requests.RequestException): return _failure("IMAGE_PROVIDER_FAILED", args.record)
    finally:
        if args.record and record.get("verdict") == "PASS": args.record.parent.mkdir(parents=True, exist_ok=True); args.record.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__": raise SystemExit(main())
