#!/usr/bin/env python3
"""Native Google Gemini image generation adapter."""
from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
from pathlib import Path
from urllib.parse import quote, urlparse

from ..common import (
    MAX_IMAGE_BYTES,
    MAX_MULTIPART_BYTES,
    detect_content_type,
    input_content_type,
    normalize_output_format,
    request_with_retry,
    save_images,
)

DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-2.5-flash-image"
DEFAULT_KEY_ENV = "GEMINI_API_KEY"


def normalize_base_url(value: str) -> str:
    value = value.strip().rstrip("/")
    parsed = urlparse(value)
    if (parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password
            or (parsed.port not in (None, 443)) or parsed.query or parsed.fragment):
        raise ValueError("base URL must be an HTTPS URL without credentials, query or fragment")
    return value


def read_api_key(env_name: str = DEFAULT_KEY_ENV) -> str:
    key = os.environ.get(env_name, "").strip()
    if not key:
        raise ValueError(f"{env_name} is required")
    return key


def _model_path(model: str) -> str:
    model = model.strip()
    if model.startswith("models/"):
        model = model[7:]
    if not model or "/" in model or "\\" in model:
        raise ValueError("Google model name is invalid")
    return quote(model, safe="")


def _inline_image(path: Path) -> dict[str, object]:
    mime = input_content_type(path)
    return {
        "inlineData": {
            "mimeType": mime,
            "data": base64.b64encode(path.read_bytes()).decode("ascii"),
        }
    }


def _decode_inline(value: object) -> tuple[bytes, str]:
    if not isinstance(value, dict):
        raise ValueError("Google image part is invalid")
    encoded = value.get("data")
    if not isinstance(encoded, str) or not encoded:
        raise ValueError("Google image part has no data")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError, binascii.Error) as exc:
        raise ValueError("Google image data is invalid") from exc
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("Google image size is invalid")
    return data, detect_content_type(data)


def response_items(payload: object) -> list[tuple[bytes, str]]:
    if not isinstance(payload, dict):
        raise ValueError("Google response is not an object")
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("Google response contains no candidates")
    images: list[tuple[bytes, str]] = []
    seen: set[tuple[str, bytes]] = set()
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        content = candidate.get("content")
        parts = content.get("parts") if isinstance(content, dict) else None
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            inline = part.get("inlineData")
            if inline is None:
                continue
            image = _decode_inline(inline)
            # A few compatible Vertex/Gemini gateways repeat an identical
            # inline part. Preserve distinct variants while suppressing exact
            # (mime, data) duplicates from the same response.
            key = (image[1], image[0])
            if key not in seen:
                seen.add(key)
                images.append(image)
    if not images:
        raise ValueError("Google response contains no image data")
    # Gemini image models may return more than one inline image even when the
    # request asks for a single output. Preserve every validated image; the
    # shared saver and service result contract support multiple output assets.
    return images


def common_parser(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--prompt", required=True, help="Image prompt")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--api-key-env", default=DEFAULT_KEY_ENV)
    parser.add_argument("--output-dir", type=Path, default=Path("assets"))
    parser.add_argument("--output-format", choices=("png", "jpg", "jpeg", "webp", "gif", "svg"), default="jpeg")
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
    parser = argparse.ArgumentParser(description="Google Gemini image generation and editing")
    subparsers = parser.add_subparsers(dest="operation", required=True)
    generate = subparsers.add_parser("generate")
    common_parser(generate)
    edit = subparsers.add_parser("edit")
    common_parser(edit)
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


def _body(args: argparse.Namespace) -> dict[str, object]:
    parts: list[dict[str, object]] = [{"text": args.prompt}]
    for path in getattr(args, "image", []) or []:
        parts.append(_inline_image(path))
    return {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"], "candidateCount": 1},
    }


def main(argv=None) -> int:
    args = parse_args(argv)
    args.output_format = normalize_output_format(args.output_format)
    try:
        if args.n != 1:
            raise ValueError("Google image generation supports one output")
        if args.output_format not in ("jpeg", "png"):
            raise ValueError("Google image output format is unsupported")
        if args.output_compression is not None and not 0 <= args.output_compression <= 100:
            raise ValueError("Google image compression is invalid")
        if args.background is not None or args.complexity is not None or args.frame_count is not None or args.frame_duration_ms is not None:
            raise ValueError("Google image option is unsupported")
        base_url = normalize_base_url(args.base_url)
        _model_path(args.model)
        if args.operation == "edit":
            if args.mask is not None:
                raise ValueError("Google image masks are unsupported")
            for path in args.image:
                input_content_type(path)
            if sum(path.stat().st_size for path in args.image) > MAX_MULTIPART_BYTES:
                raise ValueError("reference images exceed the multipart limit")
    except (OSError, ValueError):
        return _failure("IMAGE_CONFIGURATION_INVALID", args.record, 2)
    dry_record = {"verdict": "PASS", "dry_run": True, "requested_count": 1}
    if args.operation == "edit":
        dry_record["inline_image_parts"] = len(args.image)
    if args.dry_run:
        _emit(dry_record, args.record)
        return 0
    global requests
    try:
        import requests
    except ModuleNotFoundError:
        return _failure("MEDIA_DEPENDENCY_MISSING", args.record)
    try:
        api_key = read_api_key(args.api_key_env)
        body = _body(args)
        endpoint = f"{base_url}/models/{_model_path(args.model)}:generateContent"
        headers = {"x-goog-api-key": api_key, "Accept": "application/json", "Content-Type": "application/json"}
    except (OSError, ValueError):
        return _failure("IMAGE_CONFIGURATION_INVALID", args.record, 2)
    usage_call = None
    usage_job = None
    if args.usage_record:
        from dsh_bot_runtime.model_usage import journal
        usage_job = {"usagePath": str(args.usage_record), "output": str(args.output_dir), "endpoint": {"model": args.model}}
    record: dict[str, object] = {"verdict": "FAIL", "error": {"code": "IMAGE_PROVIDER_FAILED"}}
    try:
        session = requests.Session()
        if usage_job:
            usage_call = journal(usage_job)
        response = request_with_retry(session, "POST", endpoint, headers=headers, timeout=args.timeout or None, json=body)
        if response.status_code != 200:
            return _failure("IMAGE_PROVIDER_FAILED", args.record)
        payload = response.json()
        if usage_job:
            accounting = {"model": payload.get("model", args.model), "usageMetadata": payload.get("usageMetadata")} if isinstance(payload, dict) else {"model": args.model}
            journal(usage_job, usage_call, accounting)
        paths = save_images(response_items(payload), args.output_dir, args.model, output_format=args.output_format, output_compression=args.output_compression)
        record = {"verdict": "PASS", "outputs": [path.name for path in paths], "returned_count": len(paths)}
        _emit({"verdict": "PASS", "returned_count": len(paths)})
        return 0
    except (OSError, ValueError, KeyError, TypeError, requests.RequestException):
        return _failure("IMAGE_PROVIDER_FAILED", args.record)
    finally:
        if args.record and record.get("verdict") == "PASS":
            args.record.parent.mkdir(parents=True, exist_ok=True)
            args.record.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
