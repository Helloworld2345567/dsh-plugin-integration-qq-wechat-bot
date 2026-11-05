"""Local final delivery encoding; catalog access belongs to the host adapter."""
from pathlib import Path
import time

from dsh_bot_runtime.audio_output import AudioOutputError, encode_delivery_mp3


class MusicError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def execute(job):
    if job.get("operation") in ("music_search", "music_acquire"):
        raise MusicError("MUSIC_HOST_ADAPTER_REQUIRED")
    if job.get("operation") != "music_delivery":
        raise MusicError("MUSIC_OPERATION_UNSUPPORTED")
    inputs = job.get("inputs", [])
    if len(inputs) != 1 or inputs[0].get("kind") != "audio":
        raise MusicError("MUSIC_AUDIO_REQUIRED")
    timeout = None if job.get("timeoutMs") == 0 else min(job.get("timeoutMs", 0), job.get("deadline", 0) - time.time() * 1000) / 1000
    if timeout is not None and timeout <= 0:
        raise MusicError("MUSIC_TIMEOUT")
    target = Path(job["output"]) / "music.mp3"
    try:
        encode_delivery_mp3(inputs[0]["path"], target, timeout=timeout)
    except AudioOutputError as error:
        raise MusicError({"AUDIO_OUTPUT_TIMEOUT": "MUSIC_TIMEOUT", "AUDIO_OUTPUT_TOO_LARGE": "MUSIC_OUTPUT_TOO_LARGE",
                          "FFMPEG_OR_FFPROBE_REQUIRED": "MUSIC_FFMPEG_REQUIRED"}.get(error.code, "MUSIC_AUDIO_INVALID")) from None
    name = Path(inputs[0]["name"]).stem[:160] + ".mp3"
    return {"assets": [{"path": str(target), "name": name, "mime": "audio/mpeg", "kind": "audio"}],
            "coverage": "MUSIC_DELIVERY_AUDIO", "incomplete": False}
