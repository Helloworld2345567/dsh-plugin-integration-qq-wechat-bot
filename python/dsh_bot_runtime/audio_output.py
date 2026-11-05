"""Complete MP3 delivery files below the shared decimal 20 MB limit."""
from __future__ import annotations

import json
import math
from pathlib import Path
import shutil
import subprocess
import time

MAX_DELIVERY_BYTES = 20_000_000
MP3_BITRATES = (192, 160, 128, 96, 64)
ENCODING_OVERHEAD_BYTES = 16_384


class AudioOutputError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _remaining(deadline):
    if deadline is None:
        return None
    value = deadline - time.monotonic()
    if value <= 0:
        raise AudioOutputError("AUDIO_OUTPUT_TIMEOUT")
    return value


def _run(command, deadline):
    try:
        result = subprocess.run(command, capture_output=True, timeout=_remaining(deadline), check=False)
    except subprocess.TimeoutExpired:
        raise AudioOutputError("AUDIO_OUTPUT_TIMEOUT") from None
    except FileNotFoundError:
        raise AudioOutputError("FFMPEG_OR_FFPROBE_REQUIRED") from None
    if result.returncode:
        raise AudioOutputError("AUDIO_OUTPUT_INVALID")
    return result.stdout


def _inspect(source, deadline, expected_duration=None):
    """Probe the real codec and decode the entire first audio stream to null."""
    raw = _run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                "stream=codec_name,channels,duration:format=format_name,duration", "-of", "json", str(source)], deadline)
    try:
        info = json.loads(raw)
        stream = info["streams"][0]
        codec = stream["codec_name"]
        container = info["format"]["format_name"]
        declared = float(stream.get("duration") or info["format"]["duration"])
        channels = int(stream["channels"])
        if not math.isfinite(declared) or declared <= 0 or channels < 1:
            raise ValueError()
    except (ValueError, TypeError, KeyError, IndexError):
        raise AudioOutputError("AUDIO_OUTPUT_INVALID") from None
    progress = _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror", "-err_detect", "explode",
                     "-nostdin", "-i", str(source), "-map", "0:a:0", "-vn", "-progress", "pipe:1",
                     "-nostats", "-f", "null", "-"], deadline)
    try:
        values = [line.partition(b"=")[2] for line in progress.splitlines() if line.startswith(b"out_time_us=")]
        duration = int(values[-1]) / 1_000_000
        if duration <= 0 or abs(duration - declared) > max(0.35, declared * 0.02):
            raise ValueError()
        if expected_duration is not None and abs(duration - expected_duration) > max(0.35, expected_duration * 0.02):
            raise ValueError()
    except (ValueError, IndexError):
        raise AudioOutputError("AUDIO_OUTPUT_INVALID") from None
    return {"codec": codec, "container": container, "channels": channels, "duration": duration}


def encode_delivery_mp3(source, target, *, timeout=None, expected_duration=None):
    """Preserve a valid small MP3; otherwise encode once without cutting audio.

    The target always belongs to the caller's job directory. Hosts that already
    own a compliant source Asset can deliver it directly without calling here.
    """
    source, target = Path(source), Path(target)
    if source.resolve() == target.resolve():
        raise AudioOutputError("AUDIO_OUTPUT_PATH_INVALID")
    deadline = None if timeout is None else time.monotonic() + timeout
    try:
        info = _inspect(source, deadline, expected_duration)
        target.parent.mkdir(parents=True, exist_ok=True)
        if info["codec"] == "mp3" and info["container"] == "mp3" and source.stat().st_size < MAX_DELIVERY_BYTES:
            shutil.copyfile(source, target)
            return target
        bitrate = next((rate for rate in MP3_BITRATES
                        if info["duration"] * rate * 125 + ENCODING_OVERHEAD_BYTES < MAX_DELIVERY_BYTES), None)
        if bitrate is None:
            raise AudioOutputError("AUDIO_OUTPUT_TOO_LARGE")
        _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror", "-err_detect", "explode",
              "-nostdin", "-y", "-i", str(source), "-map", "0:a:0", "-vn", "-map_metadata", "-1",
              "-ac", str(min(info["channels"], 2)), "-ar", "44100", "-c:a", "libmp3lame",
              "-b:a", f"{bitrate}k", str(target)], deadline)
        if target.stat().st_size >= MAX_DELIVERY_BYTES:
            raise AudioOutputError("AUDIO_OUTPUT_TOO_LARGE")
        _inspect(target, deadline, info["duration"])
        return target
    except OSError:
        target.unlink(missing_ok=True)
        raise AudioOutputError("AUDIO_OUTPUT_INVALID") from None
    except BaseException:
        target.unlink(missing_ok=True)
        raise
