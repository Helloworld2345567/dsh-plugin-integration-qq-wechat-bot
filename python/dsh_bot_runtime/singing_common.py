"""Shared, dependency-light contracts for the RVC adapter and media worker."""
from __future__ import annotations

import math
from pathlib import Path
import re
import subprocess
import wave

MAX_SOURCE_BYTES = 100 * 1024**2
MAX_OUTPUT_BYTES = 200 * 1024**2
MAX_INTERMEDIATE_BYTES = 256 * 1024**2
PARAMETER_KEYS = ("jobId", "modelVersion", "singingModelId", "singingWeightsPath",
                  "singingIndexPath", "speakerId", "pitchShift", "indexRate")
ERROR_CODES = {
    "SINGING_CONFIG_INVALID", "SINGING_MODEL_INCOMPATIBLE", "SINGING_INDEX_INVALID",
    "SINGING_SOURCE_UNAVAILABLE", "SINGING_DOWNLOAD_FAILED", "SINGING_AUDIO_INVALID",
    "SINGING_SOURCE_TOO_LARGE", "SINGING_SOURCE_TYPE_REQUIRED", "SINGING_SEPARATION_UNCONFIGURED",
    "SINGING_INFERENCE_FAILED", "SINGING_OUTPUT_INVALID", "SINGING_OUTPUT_TOO_LARGE",
    "SINGING_SEPARATION_FAILED", "SINGING_MIX_FAILED",
    "SINGING_CANCELLED", "SINGING_SERVICE_STATE_UNKNOWN", "SINGING_SERVICE_UNAVAILABLE",
    "SINGING_JOB_NOT_FOUND", "SINGING_RESULT_NOT_READY", "SINGING_QUEUE_FULL",
    "SINGING_JOB_CONFLICT", "SINGING_TIMEOUT", "SINGING_FORMAT_INVALID",
}


class SingingError(Exception):
    def __init__(self, code):
        self.code = code if code in ERROR_CODES else "SINGING_INFERENCE_FAILED"
        super().__init__(self.code)


def validate_separation(value):
    """Validate operator-owned vocal separation settings.

    ``modelId`` is a catalog identity; clients never submit a model path. The
    path is carried only inside the frozen persona endpoint and must match the
    catalog filename before the RVC process loads it.
    """
    if value is None:
        return None
    if not isinstance(value, dict):
        raise SingingError("SINGING_CONFIG_INVALID")
    if value.get("status") not in ("configured", "unconfigured"):
        raise SingingError("SINGING_CONFIG_INVALID")
    enabled = value.get("enabled", value.get("status") == "configured")
    if type(enabled) is not bool:
        raise SingingError("SINGING_CONFIG_INVALID")
    if not enabled:
        return {"enabled": False, "status": "unconfigured"}
    if value.get("status") != "configured":
        raise SingingError("SINGING_CONFIG_INVALID")
    model_id = value.get("modelId")
    model_path = value.get("modelPath")
    if model_id not in ("vocals", "vocals-aggressive"):
        raise SingingError("SINGING_CONFIG_INVALID")
    if not isinstance(model_path, str) or not model_path.strip() or len(model_path) > 4096 or any(ord(c) < 32 for c in model_path):
        raise SingingError("SINGING_CONFIG_INVALID")
    instrumental_mix = value.get("instrumentalMix", True)
    if type(instrumental_mix) is not bool:
        raise SingingError("SINGING_CONFIG_INVALID")
    volume = value.get("volume", 1.0)
    if type(volume) not in (int, float) or not math.isfinite(volume) or not 0 <= volume <= 2:
        raise SingingError("SINGING_CONFIG_INVALID")
    return {"enabled": True, "status": "configured", "modelId": model_id,
            "modelPath": model_path, "instrumentalMix": instrumental_mix, "volume": float(volume)}


def validate_parameters(value):
    if not isinstance(value, dict):
        raise SingingError("SINGING_CONFIG_INVALID")
    result = {key: value[key] for key in PARAMETER_KEYS if key in value}
    if not isinstance(result.get("jobId"), str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", result["jobId"]):
        raise SingingError("SINGING_CONFIG_INVALID")
    if result.get("modelVersion") not in ("v1", "v2"):
        raise SingingError("SINGING_CONFIG_INVALID")
    for key, limit in (("singingModelId", 256), ("singingWeightsPath", 4096)):
        if not isinstance(result.get(key), str) or not result[key].strip() or len(result[key]) > limit or any(ord(c) < 32 for c in result[key]):
            raise SingingError("SINGING_CONFIG_INVALID")
    index = result.get("singingIndexPath")
    if index is not None and (not isinstance(index, str) or not index.strip() or len(index) > 4096 or any(ord(c) < 32 for c in index)):
        raise SingingError("SINGING_CONFIG_INVALID")
    result.setdefault("speakerId", 0)
    result.setdefault("pitchShift", 0)
    result.setdefault("indexRate", 0.75 if index else 0)
    if type(result["speakerId"]) is not int or not 0 <= result["speakerId"] <= 65535:
        raise SingingError("SINGING_CONFIG_INVALID")
    if type(result["pitchShift"]) is not int or not -24 <= result["pitchShift"] <= 24:
        raise SingingError("SINGING_CONFIG_INVALID")
    if type(result["indexRate"]) not in (int, float) or not math.isfinite(result["indexRate"]) or not 0 <= result["indexRate"] <= 1:
        raise SingingError("SINGING_CONFIG_INVALID")
    if not index and result["indexRate"] != 0:
        raise SingingError("SINGING_CONFIG_INVALID")
    if "separation" in value:
        result["separation"] = validate_separation(value["separation"])
    if "sourceType" in value:
        if value["sourceType"] not in ("vocals", "mixed", "unknown"):
            raise SingingError("SINGING_SOURCE_TYPE_REQUIRED")
        result["sourceType"] = value["sourceType"]
    if "format" in value:
        if value["format"] not in ("wav", "mp3"):
            raise SingingError("SINGING_FORMAT_INVALID")
        result["format"] = value["format"]
    return result


def validate_wav(path, *, maximum=MAX_INTERMEDIATE_BYTES, expected_duration=None, code="SINGING_OUTPUT_INVALID"):
    """Read every PCM frame and check RIFF finalization, silence, and duration."""
    path = Path(path)
    try:
        size = path.stat().st_size
        if size > maximum:
            raise SingingError("SINGING_OUTPUT_TOO_LARGE" if code == "SINGING_OUTPUT_INVALID" else "SINGING_SOURCE_TOO_LARGE")
        with path.open("rb") as raw:
            header = raw.read(12)
            if len(header) != 12 or header[:4] != b"RIFF" or header[8:] != b"WAVE" or int.from_bytes(header[4:8], "little") + 8 != size:
                raise SingingError(code)
        with wave.open(str(path), "rb") as audio:
            frames, rate, width, channels = audio.getnframes(), audio.getframerate(), audio.getsampwidth(), audio.getnchannels()
            if not frames or rate < 8000 or channels < 1 or width not in (1, 2, 3, 4):
                raise SingingError(code)
            read, audible = 0, False
            while block := audio.readframes(65536):
                read += len(block)
                audible = audible or any(value != (128 if width == 1 else 0) for value in block)
            if read != frames * width * channels or not audible:
                raise SingingError(code)
            duration = frames / rate
            if expected_duration is not None and abs(duration - expected_duration) > max(0.35, expected_duration * 0.02):
                raise SingingError(code)
            return duration
    except SingingError:
        raise
    except (OSError, wave.Error, EOFError, ValueError):
        raise SingingError(code) from None


def decode_audio(source, target, *, timeout=None, maximum=MAX_SOURCE_BYTES, expected_duration=None,
                 sample_rate=16000, mono=True, code="SINGING_AUDIO_INVALID"):
    """Full strict decode to a bounded mono PCM file; no extension-based detection."""
    target = Path(target)
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror", "-err_detect", "explode",
               "-nostdin", "-y", "-i", str(source), "-map", "0:a:0", "-vn", "-ac", "1" if mono else "2",
               "-ar", str(sample_rate),
               "-c:a", "pcm_s16le", str(target)]
    try:
        completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=timeout, check=False)
        if completed.returncode:
            raise SingingError(code)
        return validate_wav(target, maximum=maximum, expected_duration=expected_duration, code=code)
    except subprocess.TimeoutExpired:
        raise SingingError("SINGING_TIMEOUT") from None
    except OSError:
        raise SingingError(code) from None
