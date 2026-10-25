"""OpenAI-compatible speech synthesis worker.

The worker receives the provider key through the managed process environment and
never places it in a job, request record, result, or exception.  It accepts the
binary response returned by ``/audio/speech`` and registers one audio asset.
"""
from __future__ import annotations

import contextlib
import io
import json
import math
import os
from pathlib import Path
import struct
import sys
import time
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "python" / "vendor"))
sys.path.insert(0, str(ROOT / "python"))
from model_usage import journal

MAX_TEXT_BYTES = 32 * 1024
MAX_STYLE_BYTES = 8 * 1024
MAX_VOICE_BYTES = 128
MAX_AUDIO_BYTES = 20 * 1024 * 1024
FORMATS = {
    "mp3": ("audio/mpeg", ".mp3"),
    "wav": ("audio/wav", ".wav"),
}


class VoiceError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def remaining(job: dict, maximum: float | None = 120) -> float | None:
    """Return a bounded request timeout, preserving the unlimited-job contract."""
    if job.get("timeoutMs") == 0:
        return None
    deadline = (job.get("deadline", 0) - time.time() * 1000) / 1000
    if not math.isfinite(deadline) or deadline <= 0:
        raise VoiceError("JOB_EXPIRED")
    return min(deadline, maximum) if maximum is not None else deadline


def _endpoint(job: dict) -> dict:
    endpoint = job.get("endpoint")
    if not isinstance(endpoint, dict):
        raise VoiceError("MEDIA_PROVIDER_SETTINGS_UNAVAILABLE")
    if endpoint.get("protocol") not in (None, "speech"):
        raise VoiceError("VOICE_PROTOCOL_UNSUPPORTED")
    base = endpoint.get("baseUrl")
    parsed = urlparse(str(base or ""))
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise VoiceError("MEDIA_PROVIDER_ENDPOINT_INVALID")
    if parsed.port not in (None, 443):
        raise VoiceError("MEDIA_PROVIDER_ENDPOINT_INVALID")
    if not isinstance(endpoint.get("model"), str) or not endpoint["model"].strip():
        raise VoiceError("MEDIA_PROVIDER_ENDPOINT_INVALID")
    key_env = endpoint.get("keyEnv")
    if not isinstance(key_env, str) or not key_env or not key_env.isupper() or not key_env.replace("_", "").isalnum():
        raise VoiceError("MEDIA_PROVIDER_ENDPOINT_INVALID")
    headers = endpoint.get("headers")
    if headers is not None and not isinstance(headers, dict):
        raise VoiceError("MEDIA_PROVIDER_ENDPOINT_INVALID")
    return endpoint


def _headers(endpoint: dict, key: str) -> dict[str, str]:
    headers = {
        str(name): str(value)
        for name, value in (endpoint.get("headers") or {}).items()
        if str(name).lower() in ("openai-organization", "openai-project")
    }
    headers.update({"Authorization": f"Bearer {key}", "Accept": "audio/mpeg, audio/wav, audio/pcm, application/octet-stream"})
    return headers


def _request_audio(job: dict, body: dict) -> tuple[bytes, str]:
    """Perform one non-replayed paid request and return bytes plus content type."""
    import requests

    endpoint = _endpoint(job)
    key = os.environ.get(endpoint["keyEnv"], "").strip()
    if not key:
        raise VoiceError("MEDIA_PROVIDER_KEY_NOT_CONFIGURED")
    timeout = remaining(job)
    call = journal(job)
    try:
        with requests.Session() as session:
            session.trust_env = False
            with session.post(
                endpoint["baseUrl"].rstrip("/") + "/audio/speech",
                headers={**_headers(endpoint, key), "Content-Type": "application/json"},
                json=body,
                timeout=timeout,
                allow_redirects=False,
                stream=True,
            ) as response:
                if response.status_code != 200:
                    raise VoiceError(f"VOICE_PROVIDER_HTTP_{response.status_code}")
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_content(64 * 1024):
                    remaining(job)
                    if not isinstance(chunk, (bytes, bytearray)):
                        raise VoiceError("VOICE_PROVIDER_OUTPUT_INVALID")
                    total += len(chunk)
                    if total > MAX_AUDIO_BYTES:
                        raise VoiceError("VOICE_OUTPUT_TOO_LARGE")
                    chunks.append(bytes(chunk))
                data = b"".join(chunks)
                if not data:
                    raise VoiceError("EMPTY_VOICE_OUTPUT")
                return data, (response.headers.get("content-type") or "").split(";", 1)[0].lower()
    except VoiceError:
        raise
    except requests.Timeout:
        raise VoiceError("MODEL_TIMEOUT_MAY_BE_BILLED") from None
    except requests.RequestException:
        raise VoiceError("PROVIDER_CONNECTION_FAILED_MAY_BE_BILLED") from None


def request(job: dict, route: str = "/audio/speech", *, body: dict | None = None) -> bytes | tuple[bytes, str]:
    """Compatibility helper used by tests and local callers.

    The route is fixed to ``/audio/speech``; accepting it as an argument keeps
    this function shaped like the analysis worker while preventing arbitrary
    provider paths from crossing the worker boundary.
    """
    if route != "/audio/speech":
        raise VoiceError("VOICE_ROUTE_UNSUPPORTED")
    return _request_audio(job, body or {})


def _wav_wrap(pcm: bytes, *, rate: int = 24000, channels: int = 1, width: int = 2) -> bytes:
    if not pcm or len(pcm) % (channels * width):
        raise VoiceError("VOICE_PCM_INVALID")
    block = channels * width
    byte_rate = rate * block
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", 36 + len(pcm), b"WAVE", b"fmt ", 16, 1, channels,
        rate, byte_rate, block, width * 8, b"data", len(pcm),
    )
    return header + pcm


def _audio_kind(data: bytes, content_type: str, requested: str) -> str:
    if data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WAVE":
        return "wav"
    # ID3 and MPEG frame sync are the two common MP3 response forms.
    if (data.startswith(b"ID3") and len(data) >= 10) or len(data) >= 4 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0:
        return "mp3"
    if "wav" in content_type:
        return "wav"
    if "mpeg" in content_type or "mp3" in content_type:
        return "mp3"
    if "pcm" in content_type or content_type in ("application/octet-stream", ""):
        return "pcm"
    # A successful HTTP status with JSON/HTML is still an invalid audio result;
    # never save an error document under an audio extension.
    return "invalid"


def _parameter(job: dict) -> tuple[str, str, str, str | None, float | None, str]:
    params = job.get("parameters")
    if not isinstance(params, dict):
        raise VoiceError("VOICE_PARAMETERS_INVALID")
    operation = str(job.get("operation") or "")
    expected_mode = "chant" if operation == "voice_chant" else "speak"
    mode = params.get("mode") or expected_mode
    if params.get("mode") is not None and mode != expected_mode:
        raise VoiceError("VOICE_MODE_OPERATION_MISMATCH")
    if mode not in ("speak", "chant"):
        raise VoiceError("VOICE_MODE_INVALID")
    text = params.get("text")
    if not isinstance(text, str) or not text.strip() or len(text.encode("utf-8")) > MAX_TEXT_BYTES:
        raise VoiceError("VOICE_TEXT_INVALID")
    voice = params.get("voice") or "alloy"
    if not isinstance(voice, str) or not voice.strip() or len(voice.encode("utf-8")) > MAX_VOICE_BYTES:
        raise VoiceError("VOICE_NAME_INVALID")
    style = params.get("style")
    if style is not None and (not isinstance(style, str) or len(style.encode("utf-8")) > MAX_STYLE_BYTES):
        raise VoiceError("VOICE_STYLE_INVALID")
    speed = params.get("speed")
    if speed is not None and (isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 0.25 <= speed <= 4):
        raise VoiceError("VOICE_SPEED_INVALID")
    output_format = params.get("format") or "mp3"
    if output_format not in FORMATS:
        raise VoiceError("VOICE_FORMAT_INVALID")
    return mode, text.strip(), voice.strip(), style, float(speed) if speed is not None else None, output_format


def execute(job: dict) -> dict:
    remaining(job)
    if job.get("operation") not in ("voice_speak", "voice_chant"):
        raise VoiceError("UNKNOWN_VOICE_OPERATION")
    if job.get("inputs"):
        raise VoiceError("VOICE_INPUTS_NOT_ALLOWED")
    mode, text, voice, style, speed, output_format = _parameter(job)
    instructions = style.strip() if isinstance(style, str) and style.strip() else None
    if mode == "chant":
        base = "Use a light, expressive, melodic speaking style with a gentle humming feel. This is short expressive TTS, not a full song, accompaniment, or cover."
        instructions = f"{base} Style: {instructions}" if instructions else base
    body = {"model": _endpoint(job)["model"], "input": text, "voice": voice, "response_format": output_format}
    if speed is not None:
        body["speed"] = speed
    if instructions:
        body["instructions"] = instructions
    # Route through the public helper so callers can exercise the exact
    # OpenAI-compatible request contract without touching transport internals.
    degraded = False
    try:
        response = request(job, "/audio/speech", body=body)
    except VoiceError as error:
        # Some OpenAI-compatible providers reject the optional instructions
        # field before dispatching a model call.  A known 400 validation error
        # is safe to downgrade once; timeouts, 5xx responses, and connection
        # failures remain non-replayed because their billing state is unknown.
        if instructions and error.code == "VOICE_PROVIDER_HTTP_400":
            fallback = {key: value for key, value in body.items() if key != "instructions"}
            response = request(job, "/audio/speech", body=fallback)
            degraded = True
        else:
            raise
    # Keep the private transport easy to stub: callers may return raw bytes,
    # while the built-in transport also supplies the provider content type.
    if isinstance(response, tuple) and len(response) == 2:
        data, content_type = response
    else:
        data, content_type = response, ""
    if not isinstance(data, (bytes, bytearray)) or not isinstance(content_type, str):
        raise VoiceError("VOICE_PROVIDER_OUTPUT_INVALID")
    data = bytes(data)
    kind = _audio_kind(data, content_type, output_format)
    if kind == "pcm":
        if output_format != "wav":
            raise VoiceError("VOICE_PCM_REQUIRES_WAV")
        data = _wav_wrap(data)
        kind = "wav"
    if kind != output_format:
        raise VoiceError("VOICE_OUTPUT_FORMAT_INVALID")
    if len(data) > MAX_AUDIO_BYTES:
        raise VoiceError("VOICE_OUTPUT_TOO_LARGE")
    output = Path(job["output"])
    output.mkdir(parents=True, exist_ok=True)
    target = output / f"voice.{FORMATS[kind][1].lstrip('.')}"
    target.write_bytes(data)
    return {
        "text": (
            "已生成 AI 语音；当前提供商不支持旋律化 instructions，已降级为普通语音。" if mode == "chant" else
            "已生成 AI 语音；当前提供商不支持 style instructions，已降级为普通语音。"
            if degraded else
            "已生成 AI 语音（轻量旋律化表达，不是完整歌曲）。" if mode == "chant" else
            "已生成 AI 语音。"
        ),
        "assets": [{"path": str(target), "name": target.name, "mime": FORMATS[kind][0], "kind": "audio"}],
        "coverage": "VOICE_SYNTHESIS_DEGRADED" if degraded else "VOICE_SYNTHESIS",
        "incomplete": False,
    }


if __name__ == "__main__":
    try:
        job = json.loads(sys.stdin.buffer.read(1024 * 1024))
        with contextlib.redirect_stdout(io.StringIO()):
            result = execute(job)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        code = error.code if isinstance(error, VoiceError) else getattr(error, "code", type(error).__name__)
        print(json.dumps({"error": {"code": code}}, ensure_ascii=False))
        sys.exit(1)
