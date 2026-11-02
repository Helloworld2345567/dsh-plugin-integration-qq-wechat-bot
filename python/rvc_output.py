"""Fixed post-processing entry for one host-owned RVC job output."""
from __future__ import annotations

import argparse
from pathlib import Path
import time

from audio_output import AudioOutputError, encode_delivery_mp3


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--deadline-ms", required=True, type=int)
    args = parser.parse_args()
    timeout = (args.deadline_ms - int(time.time() * 1000)) / 1000
    if timeout <= 0:
        return 2
    try:
        encode_delivery_mp3(Path(args.input), Path(args.output), timeout=timeout)
        return 0
    except AudioOutputError:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
