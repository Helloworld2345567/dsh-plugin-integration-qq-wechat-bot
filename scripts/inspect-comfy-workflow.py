#!/usr/bin/env python3
"""Print a path-free capability summary for an API-format ComfyUI workflow."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from dsh_bot_runtime.skills.image_generation.comfyui.workflow_inspector import (
        WorkflowInspectionError,
        inspect_workflow_file,
    )
except ModuleNotFoundError:
    # Source checkout convenience; installed packages import normally.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
    from dsh_bot_runtime.skills.image_generation.comfyui.workflow_inspector import (
        WorkflowInspectionError,
        inspect_workflow_file,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Inspect ComfyUI workflow capabilities")
    parser.add_argument("workflow", type=Path)
    args = parser.parse_args(argv)
    try:
        result = inspect_workflow_file(args.workflow)
    except (WorkflowInspectionError, ValueError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc) or "COMFY_WORKFLOW_INVALID"}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
