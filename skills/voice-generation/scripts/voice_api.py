"""Speech synthesis through Edge TTS or GPT-SoVITS services.

Edge TTS has no API key. GPT-SoVITS endpoint settings are trusted persona
configuration and never come from tool parameters.
"""
from __future__ import annotations

import contextlib
import asyncio
import io
import json
import math
from pathlib import Path
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
    if endpoint.get("protocol") != "edge_tts":
        raise VoiceError("VOICE_PROTOCOL_UNSUPPORTED")
    voice = endpoint.get("voice")
    if not isinstance(voice, str) or not voice.strip() or len(voice.encode("utf-8")) > MAX_VOICE_BYTES:
        raise VoiceError("EDGE_TTS_VOICE_INVALID")
    return {"protocol": "edge_tts", "voice": voice.strip()}


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


async def _edge_tts_save(text: str, voice: str, target: Path, rate: str | None) -> None:
    try:
        import edge_tts
    except ImportError:
        raise VoiceError("EDGE_TTS_NOT_INSTALLED") from None
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate or "+0%")
    await communicate.save(str(target))


def _request_edge_audio(job: dict, endpoint: dict, text: str, speed: float | None) -> bytes:
    remaining(job)
    output = Path(job["output"])
    output.mkdir(parents=True, exist_ok=True)
    target = output / "edge-tts.mp3"
    rate = None if speed is None else f"{round((speed - 1) * 100):+d}%"
    try:
        asyncio.run(_edge_tts_save(text, endpoint["voice"], target, rate))
    except VoiceError:
        raise
    except Exception as error:
        name = type(error).__name__.upper()
        if "TIMEOUT" in name:
            raise VoiceError("EDGE_TTS_TIMEOUT") from None
        raise VoiceError("EDGE_TTS_FAILED") from None
    remaining(job)
    try:
        data = target.read_bytes()
    except OSError:
        raise VoiceError("EDGE_TTS_OUTPUT_MISSING") from None
    if not data:
        raise VoiceError("EMPTY_VOICE_OUTPUT")
    if len(data) > MAX_AUDIO_BYTES:
        raise VoiceError("VOICE_OUTPUT_TOO_LARGE")
    # Edge TTS writes a local file; do not trust a nominal MIME type when the
    # bytes are actually an error document.
    if _audio_kind(data, "", "mp3") != "mp3":
        raise VoiceError("VOICE_OUTPUT_FORMAT_INVALID")
    return data


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
    voice = params.get("voice") or endpoint.get("voice")
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
    if endpoint.get("protocol") != "edge_tts":
        raise VoiceError("VOICE_PROTOCOL_UNSUPPORTED")
    if output_format != "mp3":
        raise VoiceError("EDGE_TTS_FORMAT_UNSUPPORTED")
    if voice != endpoint["voice"]:
        raise VoiceError("EDGE_TTS_VOICE_NOT_CONFIGURED")
    data = _request_edge_audio(job, endpoint, text, speed)
    output = Path(job["output"])
    output.mkdir(parents=True, exist_ok=True)
    target = output / "voice.mp3"
    target.write_bytes(data)
    degraded = bool((style and style.strip()) or mode == "chant")
    return {
        "text": "已生成 AI 语音；Edge TTS 不支持 style 或旋律化指令，已降级为普通朗读。" if degraded else "已生成 AI 语音。",
        "assets": [{"path": str(target), "name": target.name, "mime": "audio/mpeg", "kind": "audio"}],
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
