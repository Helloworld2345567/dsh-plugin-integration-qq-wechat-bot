#!/usr/bin/env python3
"""OpenAI-compatible image generation adapter."""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path

from ..common import (
    MAX_IMAGE_BYTES, MAX_MULTIPART_BYTES, OUTPUT_MIME_TYPES, SUPPORTED_INPUT_TYPES,
    SUPPORTED_OUTPUT_TYPES, _as_jpeg, detect_content_type, input_content_type,
    public_image_url, request_with_retry, save_images,
)

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-image-2"


def normalize_base_url(value: str) -> str:
    from urllib.parse import urlparse
    value = value.strip().rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("base URL must be an HTTPS URL without credentials")
    if parsed.query or parsed.fragment:
        raise ValueError("base URL must not contain a query or fragment")
    return value if parsed.path.rstrip("/").endswith("/v1") else f"{value}/v1"


def read_api_key(env_name: str = "OPENAI_API_KEY") -> str:
    key = os.environ.get(env_name, "").strip()
    if not key:
        raise ValueError(f"{env_name} is required")
    return key


def decode_item(item: object, session) -> tuple[bytes, str]:
    if not isinstance(item, dict):
        raise ValueError("image item is not an object")
    encoded = item.get("b64_json")
    if isinstance(encoded, str) and encoded:
        try:
            data = base64.b64decode(encoded, validate=True)
        except (ValueError, TypeError) as exc:
            raise ValueError("invalid b64_json image") from exc
    else:
        image_url = item.get("url")
        if not isinstance(image_url, str) or not image_url:
            raise ValueError("image item has neither b64_json nor url")
        public_image_url(image_url)
        response = session.get(image_url, timeout=60, allow_redirects=False, stream=True)
        if response.status_code in (301, 302, 303, 307, 308):
            raise ValueError("returned image URL redirect is not allowed")
        if response.status_code != 200:
            raise ValueError(f"image download returned HTTP {response.status_code}")
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(64 * 1024):
            total += len(chunk)
            if total > MAX_IMAGE_BYTES:
                raise ValueError("downloaded image exceeds the 24 MiB limit")
            chunks.append(chunk)
        data = b"".join(chunks)
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("image size is invalid")
    return data, detect_content_type(data)


def response_items(response, session) -> list[tuple[bytes, str]]:
    content_type = (response.headers.get("content-type") or "").split(";", 1)[0].lower()
    if content_type in SUPPORTED_OUTPUT_TYPES or response.content[:12].startswith((b"\x89PNG", b"\xff\xd8\xff", b"RIFF", b"GIF87a", b"GIF89a")):
        data = response.content
        if len(data) > MAX_IMAGE_BYTES:
            raise ValueError("response image exceeds the 24 MiB limit")
        return [(data, detect_content_type(data))]
    try:
        payload = response.json()
    except ValueError as exc:
        raise ValueError("successful response is not JSON or an image") from exc
    items = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(items, list) or not items:
        raise ValueError("response contains no image data")
    return [decode_item(item, session) for item in items]


def common_parser(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--prompt", required=True, help="English image prompt")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--api-key-env", default="OPENAI_API_KEY")
    parser.add_argument("--output-dir", type=Path, default=Path("assets"))
    parser.add_argument("--output-format", choices=("png", "jpeg", "webp", "gif", "svg"), default="jpeg")
    parser.add_argument("--output-compression", type=int)
    parser.add_argument("--background", choices=("auto", "opaque", "transparent"))
    parser.add_argument("--complexity", choices=("low", "medium", "high"))
    parser.add_argument("--frame-count", type=int)
    parser.add_argument("--frame-duration-ms", type=int)
    parser.add_argument("--n", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=300.0)
    parser.add_argument("--record", type=Path)
    parser.add_argument("--usage-record", type=Path)
    parser.add_argument("--dry-run", action="store_true")


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="OpenAI-compatible image generation and editing")
    subparsers = parser.add_subparsers(dest="operation", required=True)
    generate = subparsers.add_parser("generate"); common_parser(generate)
    edit = subparsers.add_parser("edit"); common_parser(edit)
    edit.add_argument("--image", action="append", required=True, type=Path)
    edit.add_argument("--mask", type=Path)
    return parser.parse_args(argv)


def _emit(value: dict, record: Path | None = None) -> None:
    if record:
        record.parent.mkdir(parents=True, exist_ok=True)
        record.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(value, ensure_ascii=False))


def _failure(code: str, record: Path | None = None, exit_code: int = 1) -> int:
    _emit({"verdict": "FAIL", "error": {"code": code}}, record)
    return exit_code


def main(argv=None) -> int:
    args = parse_args(argv)
    try:
        if not 1 <= args.n <= 10: raise ValueError()
        if args.output_compression is not None and not 0 <= args.output_compression <= 100: raise ValueError()
        if args.output_format not in ("jpeg", "webp") and args.output_compression is not None: raise ValueError()
        if args.output_format != "gif" and (args.frame_count is not None or args.frame_duration_ms is not None): raise ValueError()
        if args.frame_count is not None and not 2 <= args.frame_count <= 64: raise ValueError()
        if args.frame_duration_ms is not None and not 20 <= args.frame_duration_ms <= 2000: raise ValueError()
        if args.operation == "edit" and args.output_format in ("gif", "svg"): raise ValueError()
        if args.output_format == "svg" and args.n != 1: raise ValueError()
        base_url = normalize_base_url(args.base_url)
        if args.operation == "edit":
            for path in args.image: input_content_type(path)
            if args.mask and input_content_type(args.mask) != "image/png": raise ValueError()
            total_input_bytes = sum(path.stat().st_size for path in args.image) + (args.mask.stat().st_size if args.mask else 0)
            if total_input_bytes > MAX_MULTIPART_BYTES: raise ValueError()
        if args.background == "transparent" and args.output_format not in ("png", "webp"): raise ValueError()
    except (OSError, ValueError):
        return _failure("IMAGE_CONFIGURATION_INVALID", args.record, 2)
    dry_record = {"verdict": "PASS", "dry_run": True, "requested_count": args.n}
    if args.operation == "edit": dry_record["multipart_image_fields"] = len(args.image)
    if args.dry_run:
        _emit(dry_record, args.record); return 0
    global requests
    try:
        import requests
    except ModuleNotFoundError:
        return _failure("MEDIA_DEPENDENCY_MISSING", args.record)
    try:
        api_key = read_api_key(args.api_key_env)
    except (OSError, ValueError):
        return _failure("IMAGE_CONFIGURATION_INVALID", args.record, 2)
    body = {"model": args.model, "prompt": args.prompt, "n": args.n}
    for key in ("output_format", "background", "complexity", "frame_count", "frame_duration_ms"):
        value = getattr(args, key)
        if value is not None: body[key] = value
    if args.output_format in ("jpeg", "webp"): body["output_compression"] = args.output_compression if args.output_compression is not None else 96
    endpoint = f"{base_url}/images/generations" if args.operation == "generate" else f"{base_url}/images/edits"
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    opened, usage_call, usage_job = [], None, None
    if args.usage_record:
        from dsh_bot_runtime.model_usage import journal
        usage_job = {"usagePath": str(args.usage_record), "output": str(args.output_dir), "endpoint": {"model": args.model}}
    record: dict[str, object] = {"verdict": "FAIL", "error": {"code": "IMAGE_PROVIDER_FAILED"}}
    try:
        session = requests.Session()
        if args.operation == "generate":
            if usage_job: usage_call = journal(usage_job)
            response = request_with_retry(session, "POST", endpoint, headers={**headers, "Content-Type": "application/json"}, timeout=args.timeout or None, json=body)
        else:
            data = {key: str(value) for key, value in body.items()}
            opened = [(path.open("rb"), path) for path in args.image]
            multipart = [("image", (path.name, handle, input_content_type(path))) for handle, path in opened]
            if args.mask:
                mask_handle = args.mask.open("rb"); opened.append((mask_handle, args.mask)); multipart.append(("mask", (args.mask.name, mask_handle, "image/png")))
            if usage_job: usage_call = journal(usage_job)
            response = request_with_retry(session, "POST", endpoint, headers=headers, timeout=args.timeout or None, data=data, files=multipart)
        try:
            accounting = response.json()
            if usage_job: journal(usage_job, usage_call, accounting)
        except ValueError: pass
        if response.status_code != 200: return _failure("IMAGE_PROVIDER_FAILED", args.record)
        paths = save_images(response_items(response, session), args.output_dir, args.model, output_format=args.output_format, output_compression=args.output_compression)
        record = {"verdict": "PASS", "outputs": [path.name for path in paths], "returned_count": len(paths)}
        _emit({"verdict": "PASS", "returned_count": len(paths)})
        return 0
    except (OSError, ValueError, requests.RequestException):
        return _failure("IMAGE_PROVIDER_FAILED", args.record)
    finally:
        for handle, _ in opened: handle.close()
        if args.record and record.get("verdict") == "PASS":
            args.record.parent.mkdir(parents=True, exist_ok=True); args.record.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
