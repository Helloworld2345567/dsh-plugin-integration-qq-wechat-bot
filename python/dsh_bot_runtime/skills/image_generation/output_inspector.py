"""Deterministic, path-free image output facts for host postflight checks."""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from .common import detect_content_type


class ImageOutputInspectionError(ValueError):
    """Raised when output bytes are not a readable supported image."""


def inspect_image(data: bytes) -> dict[str, Any]:
    if not data:
        raise ImageOutputInspectionError("IMAGE_OUTPUT_INVALID")
    try:
        content_type = detect_content_type(data)
    except ValueError as exc:
        raise ImageOutputInspectionError("IMAGE_OUTPUT_INVALID") from exc
    result: dict[str, Any] = {
        "status": "PASS",
        "mime": content_type,
        "bytes": len(data),
        "width": None,
        "height": None,
        "alpha": None,
        "animated": False,
        "frames": 1,
    }
    if content_type == "image/svg+xml":
        return result
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as image:
            image.load()
            frames = int(getattr(image, "n_frames", 1))
            result.update(
                width=image.width,
                height=image.height,
                alpha="A" in image.getbands() or "transparency" in image.info,
                animated=frames > 1,
                frames=frames,
            )
    except Exception as exc:  # Pillow uses several format-specific exceptions.
        raise ImageOutputInspectionError("IMAGE_OUTPUT_INVALID") from exc
    return result


def inspect_image_file(path: str | Path) -> dict[str, Any]:
    try:
        return inspect_image(Path(path).read_bytes())
    except ImageOutputInspectionError:
        raise
    except (OSError, ValueError) as exc:
        raise ImageOutputInspectionError("IMAGE_OUTPUT_INVALID") from exc


__all__ = ["ImageOutputInspectionError", "inspect_image", "inspect_image_file"]
