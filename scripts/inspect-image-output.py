#!/usr/bin/env python3
"""Print path-free MIME, size, dimensions, alpha and animation facts."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from dsh_bot_runtime.skills.image_generation.output_inspector import (
        ImageOutputInspectionError,
        inspect_image_file,
    )
except ModuleNotFoundError:
    # Source checkout convenience; installed packages import normally.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
    from dsh_bot_runtime.skills.image_generation.output_inspector import (
        ImageOutputInspectionError,
        inspect_image_file,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Inspect image output facts")
    parser.add_argument("image", type=Path)
    args = parser.parse_args(argv)
    try:
        result = inspect_image_file(args.image)
    except ImageOutputInspectionError as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
