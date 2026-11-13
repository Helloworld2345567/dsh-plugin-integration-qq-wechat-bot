#!/usr/bin/env python3
"""Compatibility dispatcher for configured image service adapters."""
from __future__ import annotations

import sys

from .common import *  # noqa: F401,F403 - compatibility exports
from .comfyui.image_api import _comfy_image_records, _inject_comfy_prompt, normalize_comfyui_base_url
# Keep the historical OpenAI client symbols importable from the canonical
# module. The worker now selects an adapter explicitly, while integrations
# importing the canonical module continue to see the legacy helpers.
from .openai.image_api import (  # noqa: F401
    DEFAULT_BASE_URL,
    DEFAULT_MODEL,
    common_parser,
    decode_item,
    normalize_base_url,
    read_api_key,
    response_items,
)

# Retained for callers that imported the legacy retry policy constant.
TRANSIENT_STATUSES = {502, 503}


def _protocol(argv: list[str]) -> str:
    for index, item in enumerate(argv):
        if item == "--protocol" and index + 1 < len(argv): return argv[index + 1]
        if item.startswith("--protocol="): return item.split("=", 1)[1]
    return "openai"


def _without_protocol(argv: list[str]) -> list[str]:
    result = []; index = 0
    while index < len(argv):
        item = argv[index]
        if item == "--protocol": index += 2; continue
        if item.startswith("--protocol="): index += 1; continue
        result.append(item); index += 1
    return result


def _adapter(protocol: str):
    if protocol == "openai":
        if __package__:
            from .openai import image_api as module
        else:
            from dsh_bot_runtime.skills.image_generation.openai import image_api as module
        return module
    if protocol == "comfyui":
        if __package__:
            from .comfyui import image_api as module
        else:
            from dsh_bot_runtime.skills.image_generation.comfyui import image_api as module
        return module
    raise ValueError(f"unsupported image protocol: {protocol}")


def parse_args(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    return _adapter(_protocol(args)).parse_args(_without_protocol(args))


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        module = _adapter(_protocol(args))
    except ValueError:
        return 2
    return module.main(_without_protocol(args))


if __name__ == "__main__":
    raise SystemExit(main())
