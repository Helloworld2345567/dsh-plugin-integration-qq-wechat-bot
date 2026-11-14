"""Shared image validation, decoding and output helpers for image adapters."""
from __future__ import annotations

import io
import ipaddress
import mimetypes
import re
import socket
from pathlib import Path
from urllib.parse import urlparse

MAX_IMAGE_BYTES = 24 * 1024 * 1024
MAX_MULTIPART_BYTES = 22 * 1024 * 1024
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
IMAGE_MIN_DIMENSION = 64
IMAGE_MAX_DIMENSION = 4096
IMAGE_MAX_BATCH = 10
SUPPORTED_INPUT_TYPES = {"image/png", "image/jpeg", "image/webp"}
SUPPORTED_OUTPUT_TYPES = SUPPORTED_INPUT_TYPES | {"image/gif", "image/svg+xml"}
EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}
OUTPUT_MIME_TYPES = {
    "png": "image/png",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "svg": "image/svg+xml",
}


def normalize_output_format(value: str) -> str:
    """Use one internal spelling for the common JPG alias."""
    return "jpeg" if value == "jpg" else value


def public_image_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.fragment:
        raise ValueError("returned image URL must be a public HTTPS URL on port 443")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError("returned image URL host cannot be resolved") from exc
    if not addresses:
        raise ValueError("returned image URL host cannot be resolved")
    for family, _, _, _, sockaddr in addresses:
        address = ipaddress.ip_address(sockaddr[0])
        if not address.is_global or address.is_multicast or address.is_private or address.is_loopback or address.is_link_local or (address.version == 6 and address.ipv4_mapped):
            raise ValueError("returned image URL resolves to a non-public address")
    return value


def detect_content_type(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    try:
        text = data[:64 * 1024].decode("utf-8-sig")
    except UnicodeDecodeError:
        text = ""
    if re.match(r"\s*(?:<\?xml\b[^>]*>\s*)?(?:<!DOCTYPE\s+svg\b[^>]*>\s*)?<svg(?:\s|>)", text, re.IGNORECASE):
        return "image/svg+xml"
    raise ValueError("response is not PNG, JPEG, WebP, GIF, or SVG")


def input_content_type(path: Path) -> str:
    if path.stat().st_size == 0 or path.stat().st_size > MAX_UPLOAD_BYTES:
        raise ValueError(f"input image must be between 1 byte and {MAX_UPLOAD_BYTES} bytes: {path}")
    content_type = mimetypes.guess_type(path.name)[0] or ""
    if content_type not in SUPPORTED_INPUT_TYPES:
        content_type = detect_content_type(path.read_bytes())
    if content_type not in SUPPORTED_INPUT_TYPES:
        raise ValueError(f"unsupported input image type: {path}")
    detect_content_type(path.read_bytes())
    return content_type


def safe_slug(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._")
    return value or "image"


def request_with_retry(session, method: str, url: str, *, headers: dict[str, str], timeout: float, **kwargs: object):
    # A failed paid request may already have been accepted upstream. Do not replay it.
    return session.request(method, url, headers=headers, timeout=timeout, allow_redirects=False, **kwargs)


def _as_jpeg(data: bytes, quality: int) -> bytes:
    from PIL import Image, ImageOps
    with Image.open(io.BytesIO(data)) as source:
        source.load()
        image = ImageOps.exif_transpose(source)
        if "A" in image.getbands() or "transparency" in image.info:
            rgba = image.convert("RGBA")
            background = Image.new("RGB", rgba.size, (255, 255, 255))
            background.paste(rgba, mask=rgba.getchannel("A"))
            image = background
        else:
            image = image.convert("RGB")
        output = io.BytesIO()
        image.save(output, format="JPEG", quality=quality, optimize=True)
        return output.getvalue()


def _as_png(data: bytes) -> bytes:
    from PIL import Image, ImageOps
    with Image.open(io.BytesIO(data)) as source:
        source.load()
        image = ImageOps.exif_transpose(source)
        if "A" in image.getbands() or "transparency" in image.info:
            image = image.convert("RGBA")
        else:
            image = image.convert("RGB")
        output = io.BytesIO()
        image.save(output, format="PNG", optimize=True)
        return output.getvalue()


def save_images(images: list[tuple[bytes, str]], output_dir: Path, stem: str, *, output_format: str = "jpeg", output_compression: int | None = None) -> list[Path]:
    output_format = normalize_output_format(output_format)
    import time
    if sum(len(data) for data, _ in images) > MAX_IMAGE_BYTES:
        raise ValueError("combined output images exceed the 24 MiB limit")
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    paths: list[Path] = []
    for index, (data, content_type) in enumerate(images, 1):
        expected_type = OUTPUT_MIME_TYPES.get(output_format)
        if output_format in ("gif", "svg") and expected_type and content_type != expected_type:
            raise ValueError(f"provider returned {content_type} for requested {output_format}")
        if output_format == "jpeg":
            data = _as_jpeg(data, output_compression if output_compression is not None else 96)
            content_type = "image/jpeg"
        elif output_format == "png" and content_type != "image/png":
            data = _as_png(data)
            content_type = "image/png"
        suffix = EXTENSIONS[content_type]
        path = output_dir / f"{safe_slug(stem)}-{stamp}-{index}{suffix}"
        path.write_bytes(data)
        paths.append(path)
    return paths
