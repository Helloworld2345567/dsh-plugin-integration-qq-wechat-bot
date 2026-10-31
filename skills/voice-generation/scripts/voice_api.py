"""Speech synthesis through OpenAI-compatible or GPT-SoVITS services.

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
import wave
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
GPT_SOVITS_VERSIONS = {"v1", "v2", "v2Pro", "v2ProPlus", "v3", "v4", "v5dev", "v5turbo"}
GPT_SOVITS_LANGUAGES = {"auto", "en", "zh", "ja", "all_zh", "all_ja", "auto_yue", "yue", "ko", "all_yue", "all_ko"}


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
    if endpoint.get("protocol") == "gpt_sovits":
        return _gpt_endpoint(endpoint)
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


def _gpt_endpoint(endpoint: dict) -> dict:
    """Only trusted endpoint configuration selects files on the TTS server."""
    try:
        parsed = urlparse(endpoint.get("baseUrl", ""))
        valid_url = (parsed.scheme in ("http", "https") and parsed.hostname
                     and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment)
        parsed.port  # Validate an explicitly supplied port.
    except (TypeError, ValueError):
        valid_url = False
    if not valid_url:
        raise VoiceError("MEDIA_PROVIDER_ENDPOINT_INVALID")
    for key, limit in (("baseUrl", 2048), ("gptWeightsPath", 4096), ("sovitsWeightsPath", 4096),
                       ("refAudioPath", 4096), ("voice", 100)):
        value = endpoint.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(char) < 32 for char in value):
            raise VoiceError("MEDIA_PROVIDER_ENDPOINT_INVALID")
    prompt = endpoint.get("promptText")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt.encode("utf-8")) > MAX_TEXT_BYTES:
        raise VoiceError("GPT_SOVITS_REFERENCE_TEXT_INVALID")
    if endpoint.get("modelVersion") not in GPT_SOVITS_VERSIONS:
        raise VoiceError("GPT_SOVITS_VERSION_INVALID")
    languages = {"auto", "en", "zh", "ja", "all_zh", "all_ja"} if endpoint["modelVersion"] == "v1" else GPT_SOVITS_LANGUAGES
    if endpoint.get("promptLang") not in languages or endpoint.get("textLang") not in languages:
        raise VoiceError("GPT_SOVITS_LANGUAGE_INVALID")
    return endpoint


def _request_gpt_audio(job: dict, endpoint: dict, body: dict) -> bytes:
    """Reload both weights and reference on every call; the host serializes jobs."""
    import requests

    base = endpoint["baseUrl"].rstrip("/")
    try:
        with requests.Session() as session:
            session.trust_env = False
            for route, key, value in (
                ("set_sovits_weights", "weights_path", endpoint["sovitsWeightsPath"]),
                ("set_gpt_weights", "weights_path", endpoint["gptWeightsPath"]),
                ("set_refer_audio", "refer_audio_path", endpoint["refAudioPath"]),
            ):
                with session.get(base + "/" + route, params={key: value},
                                 timeout=remaining(job, None), allow_redirects=False) as response:
                    if response.status_code != 200:
                        raise VoiceError(f"GPT_SOVITS_{route.upper()}_HTTP_{response.status_code}")
                    try:
                        result = response.json()
                    except ValueError:
                        raise VoiceError("GPT_SOVITS_CONTROL_RESPONSE_INVALID") from None
                    if not isinstance(result, dict) or result.get("message") != "success":
                        raise VoiceError("GPT_SOVITS_CONTROL_RESPONSE_INVALID")
            timeout = remaining(job, None)
            journal(job)
            with session.post(base + "/tts", json=body,
                              headers={"Content-Type": "application/json", "Accept": "audio/wav"},
                              timeout=timeout, allow_redirects=False, stream=True) as response:
                if response.status_code != 200:
                    raise VoiceError(f"GPT_SOVITS_TTS_HTTP_{response.status_code}")
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_content(64 * 1024):
                    remaining(job, None)
                    if not isinstance(chunk, (bytes, bytearray)):
                        raise VoiceError("VOICE_PROVIDER_OUTPUT_INVALID")
                    total += len(chunk)
                    if total > MAX_AUDIO_BYTES:
                        raise VoiceError("VOICE_OUTPUT_TOO_LARGE")
                    chunks.append(bytes(chunk))
                return b"".join(chunks)
    except VoiceError:
        raise
    except requests.Timeout:
        raise VoiceError("GPT_SOVITS_TIMEOUT") from None
    except requests.RequestException:
        raise VoiceError("GPT_SOVITS_CONNECTION_FAILED") from None


def _validate_gpt_wav(data: bytes) -> None:
    if len(data) > MAX_AUDIO_BYTES:
        raise VoiceError("VOICE_OUTPUT_TOO_LARGE")
    if not data:
        raise VoiceError("EMPTY_VOICE_OUTPUT")
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise VoiceError("VOICE_OUTPUT_FORMAT_INVALID")
    # Non-streaming GPT-SoVITS returns a finalized RIFF container, not the
    # placeholder sizes used by its streaming WAV endpoint.
    if int.from_bytes(data[4:8], "little") + 8 != len(data):
        raise VoiceError("VOICE_WAV_INCOMPLETE")
    position = 12
    data_size = None
    while position < len(data):
        if position + 8 > len(data):
            raise VoiceError("VOICE_WAV_INCOMPLETE")
        chunk_size = int.from_bytes(data[position + 4:position + 8], "little")
        if data[position:position + 4] == b"data":
            if data_size is not None:
                raise VoiceError("VOICE_OUTPUT_FORMAT_INVALID")
            data_size = chunk_size
        position += 8 + chunk_size + (chunk_size % 2)
        if position > len(data):
            raise VoiceError("VOICE_WAV_INCOMPLETE")
    try:
        with wave.open(io.BytesIO(data), "rb") as audio:
            frames = audio.getnframes()
            width = audio.getsampwidth()
            channels = audio.getnchannels()
            if frames <= 0 or audio.getframerate() <= 0:
                raise VoiceError("EMPTY_VOICE_OUTPUT")
            pcm = audio.readframes(frames)
            if len(pcm) != frames * channels * width or data_size != len(pcm):
                raise VoiceError("VOICE_WAV_INCOMPLETE")
            silence = 128 if width == 1 else 0
            if all(value == silence for value in pcm):
                raise VoiceError("VOICE_SILENT_OUTPUT")
    except (wave.Error, EOFError, ValueError):
        raise VoiceError("VOICE_OUTPUT_FORMAT_INVALID") from None


def _execute_gpt(job: dict, endpoint: dict, mode: str, text: str, voice: str,
                 style: str | None, speed: float | None, output_format: str) -> dict:
    if mode != "speak":
        raise VoiceError("GPT_SOVITS_CHANT_UNSUPPORTED")
    if output_format != "wav":
        raise VoiceError("GPT_SOVITS_FORMAT_UNSUPPORTED")
    if voice != endpoint["voice"]:
        raise VoiceError("GPT_SOVITS_VOICE_NOT_CONFIGURED")
    body = {"text": text, "text_lang": endpoint["textLang"],
            "ref_audio_path": endpoint["refAudioPath"], "prompt_text": endpoint["promptText"],
            "prompt_lang": endpoint["promptLang"], "aux_ref_audio_paths": [],
            "media_type": "wav", "streaming_mode": False, "batch_size": 1}
    if speed is not None:
        body["speed_factor"] = speed
    data = _request_gpt_audio(job, endpoint, body)
    _validate_gpt_wav(data)
    output = Path(job["output"])
    output.mkdir(parents=True, exist_ok=True)
    target = output / "voice.wav"
    target.write_bytes(data)
    degraded = bool(style and style.strip())
    return {
        "text": "已生成 AI 语音；GPT-SoVITS 不支持 style instructions，已降级为普通语音。" if degraded else "已生成 AI 语音。",
        "assets": [{"path": str(target), "name": target.name, "mime": "audio/wav", "kind": "audio"}],
        "coverage": "VOICE_SYNTHESIS_DEGRADED" if degraded else "VOICE_SYNTHESIS", "incomplete": False,
    }


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
    endpoint = job.get("endpoint") if isinstance(job.get("endpoint"), dict) else {}
    gpt_sovits = endpoint.get("protocol") == "gpt_sovits"
    voice = params.get("voice") or (endpoint.get("voice") if gpt_sovits else "alloy")
    if not isinstance(voice, str) or not voice.strip() or len(voice.encode("utf-8")) > MAX_VOICE_BYTES:
        raise VoiceError("VOICE_NAME_INVALID")
    style = params.get("style")
    if style is not None and (not isinstance(style, str) or len(style.encode("utf-8")) > MAX_STYLE_BYTES):
        raise VoiceError("VOICE_STYLE_INVALID")
    speed = params.get("speed")
    if speed is not None and (isinstance(speed, bool) or not isinstance(speed, (int, float)) or not math.isfinite(speed) or not 0.25 <= speed <= 4):
        raise VoiceError("VOICE_SPEED_INVALID")
    output_format = params.get("format") or ("wav" if gpt_sovits else "mp3")
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
    endpoint = _endpoint(job)
    if endpoint.get("protocol") == "gpt_sovits":
        return _execute_gpt(job, endpoint, mode, text, voice, style, speed, output_format)
    instructions = style.strip() if isinstance(style, str) and style.strip() else None
    if mode == "chant":
        base = "Use a light, expressive, melodic speaking style with a gentle humming feel. This is short expressive TTS, not a full song, accompaniment, or cover."
        instructions = f"{base} Style: {instructions}" if instructions else base
    body = {"model": endpoint["model"], "input": text, "voice": voice, "response_format": output_format}
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
