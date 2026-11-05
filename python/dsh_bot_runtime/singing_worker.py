"""Bot media operation for host-selected sources and frozen RVC configuration."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import tempfile
import time
from urllib.parse import urlsplit

from dsh_bot_runtime.singing_common import (ERROR_CODES, MAX_INTERMEDIATE_BYTES, MAX_OUTPUT_BYTES, MAX_SOURCE_BYTES,
                                            SingingError, decode_audio, validate_parameters, validate_wav)
from dsh_bot_runtime.model_usage import journal
from dsh_bot_runtime.audio_output import AudioOutputError, encode_delivery_mp3


def remaining(job, maximum=None):
    if job.get("timeoutMs") == 0:
        return maximum
    seconds = min((job.get("deadline", 0) - time.time() * 1000) / 1000, job.get("timeoutMs", 0) / 1000)
    if seconds <= 0:
        raise SingingError("SINGING_TIMEOUT")
    return min(seconds, maximum) if maximum else seconds


def endpoint_for(job):
    endpoint = job.get("endpoint")
    if not isinstance(endpoint, dict) or endpoint.get("protocol") != "rvc_http_v1":
        raise SingingError("SINGING_CONFIG_INVALID")
    base = endpoint.get("baseUrl") or endpoint.get("serviceUrl")
    try:
        parsed = urlsplit(base)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError()
        parsed.port
    except (TypeError, ValueError):
        raise SingingError("SINGING_CONFIG_INVALID") from None
    return base.rstrip("/"), validate_parameters(endpoint)


async def _download_source(job, directory):
    from dsh_bot_runtime.skills.media_analysis.platform_links import PLATFORM_HOSTS, PublicLinkResolver
    from dsh_bot_runtime.video_understanding.media import MediaProcessor
    from dsh_bot_runtime.video_understanding.models import CallerContext, Limits
    from dsh_bot_runtime.video_understanding.network import download, validate_url

    url = job["parameters"].get("url")
    try:
        parsed = validate_url(url)
        if parsed.hostname in PLATFORM_HOSTS:
            limits = Limits(max_download_bytes=500 * 1024**2, download_timeout=remaining(job),
                            resolve_timeout=remaining(job), process_timeout=remaining(job))
            resolver = PublicLinkResolver(directory / "sources", limits)
            caller = CallerContext(job["scope"], job["scope"], job["scope"])
            source = resolver.describe(url, caller)
            resolved = await resolver.resolve(source, caller)
            return await resolver.fetch(resolved, directory, MediaProcessor(limits))
        target = directory / "download.audio"
        metadata = await download(url, target, MAX_SOURCE_BYTES, remaining(job), metadata=True)
        if metadata["content_type"].split(";", 1)[0].lower() in ("text/html", "application/json", "text/plain"):
            raise SingingError("SINGING_AUDIO_INVALID")
        return target
    except SingingError:
        raise
    except Exception:
        raise SingingError("SINGING_DOWNLOAD_FAILED") from None


def _status(response, job_id):
    try:
        # Status responses are small and never contain internal paths or traces.
        raw = response.content
        if len(raw) > 16384:
            raise ValueError()
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError()
        if response.status_code not in (200, 202):
            error = value.get("error")
            code = error.get("code") if isinstance(error, dict) else None
            if code in ERROR_CODES:
                raise SingingError(code)
            raise ValueError()
        if value.get("jobId") != job_id or value.get("status") not in ("queued", "running", "succeeded", "failed", "cancelled"):
            raise ValueError()
        if value["status"] == "failed" and (not isinstance(value.get("error"), dict) or value["error"].get("code") not in ERROR_CODES):
            raise ValueError()
        return value
    except SingingError:
        raise
    except (TypeError, ValueError):
        raise SingingError("SINGING_SERVICE_STATE_UNKNOWN") from None


def request_conversion(job, source, target):
    """One submission only; a lost submission response is reconciled by job ID."""
    import requests

    base, parameters = endpoint_for(job)
    submission = {**parameters, "sourceType": job.get("parameters", {}).get("sourceType", "vocals"),
                  "format": job.get("parameters", {}).get("format", "wav")}
    job_url = base + "/v1/jobs/" + parameters["jobId"]
    with requests.Session() as session:
        session.trust_env = False
        try:
            with Path(source).open("rb") as audio:
                journal(job)
                try:
                    response = session.post(base + "/v1/jobs", files={"audio": ("source.wav", audio, "audio/wav")},
                                            data={"parameters": json.dumps(submission)},
                                            timeout=remaining(job, 60), allow_redirects=False)
                    with response:
                        state = _status(response, parameters["jobId"])
                except requests.RequestException:
                    # POST may have reached the server. Query, never resubmit.
                    with session.get(job_url, timeout=remaining(job, 15), allow_redirects=False) as response:
                        if response.status_code == 404:
                            raise SingingError("SINGING_SERVICE_STATE_UNKNOWN")
                        state = _status(response, parameters["jobId"])
            while state["status"] in ("queued", "running"):
                remaining(job)
                time.sleep(0.25)
                with session.get(job_url, timeout=remaining(job, 15), allow_redirects=False) as response:
                    if response.status_code == 404:
                        raise SingingError("SINGING_SERVICE_STATE_UNKNOWN")
                    state = _status(response, parameters["jobId"])
            if state["status"] == "cancelled":
                raise SingingError("SINGING_CANCELLED")
            if state["status"] != "succeeded":
                raise SingingError(state.get("error", {}).get("code", "SINGING_INFERENCE_FAILED"))
            with session.get(job_url + "/result", timeout=remaining(job, 60), allow_redirects=False, stream=True) as response:
                if response.status_code != 200 or response.headers.get("Content-Type", "").split(";", 1)[0] != "audio/wav":
                    raise SingingError("SINGING_OUTPUT_INVALID")
                total = 0
                with Path(target).open("wb") as output:
                    for block in response.iter_content(64 * 1024):
                        remaining(job)
                        total += len(block)
                        if total > MAX_INTERMEDIATE_BYTES:
                            raise SingingError("SINGING_OUTPUT_TOO_LARGE")
                        output.write(block)
        except requests.RequestException:
            raise SingingError("SINGING_SERVICE_STATE_UNKNOWN") from None


def execute(job):
    if job.get("operation") != "singing_convert":
        raise SingingError("SINGING_CONFIG_INVALID")
    base, endpoint = endpoint_for(job)
    params = job.get("parameters", {})
    source_type = params.get("sourceType")
    if source_type == "mixed":
        separation = endpoint.get("separation")
        if not separation or not separation.get("enabled"):
            raise SingingError("SINGING_SEPARATION_UNCONFIGURED")
    elif source_type != "vocals":
        raise SingingError("SINGING_SOURCE_TYPE_REQUIRED")
    selected_format = params.get("format") or job["endpoint"].get("defaultOutput", "mp3")
    if selected_format not in ("mp3", "wav"):
        raise SingingError("SINGING_FORMAT_INVALID")
    inputs = job.get("inputs", [])
    if len(inputs) > 1 or (inputs and params.get("url")) or (not inputs and not params.get("url")):
        raise SingingError("SINGING_SOURCE_UNAVAILABLE")
    directory = Path(job["output"])
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / ("singing." + selected_format)
    try:
        with tempfile.TemporaryDirectory(prefix="singing-", dir=directory) as temporary:
            temporary = Path(temporary)
            if inputs:
                source = Path(inputs[0]["path"])
                if inputs[0].get("kind") not in ("audio", "file") or not source.is_file():
                    raise SingingError("SINGING_SOURCE_UNAVAILABLE")
                if source.stat().st_size > MAX_SOURCE_BYTES:
                    raise SingingError("SINGING_SOURCE_TOO_LARGE")
            else:
                source = asyncio.run(_download_source(job, temporary))
            decoded = temporary / "source.wav"
            duration = decode_audio(source, decoded, timeout=remaining(job),
                                    sample_rate=44100, mono=False) if source_type == "mixed" else decode_audio(source, decoded, timeout=remaining(job))
            converted = temporary / "converted.wav"
            request_conversion(job, decoded, converted)
            validate_wav(converted, expected_duration=duration)
            if selected_format == "wav":
                if converted.stat().st_size > MAX_OUTPUT_BYTES:
                    raise SingingError("SINGING_OUTPUT_TOO_LARGE")
                converted.replace(target)
            else:
                try:
                    encode_delivery_mp3(converted, target, timeout=remaining(job), expected_duration=duration)
                except AudioOutputError as error:
                    code = {"AUDIO_OUTPUT_TIMEOUT": "SINGING_TIMEOUT",
                            "AUDIO_OUTPUT_TOO_LARGE": "SINGING_OUTPUT_TOO_LARGE"}.get(error.code, "SINGING_OUTPUT_INVALID")
                    raise SingingError(code) from None
        return {"text": "音色转换已完成。", "assets": [{"path": str(target), "name": target.name,
                    "mime": "audio/wav" if selected_format == "wav" else "audio/mpeg", "kind": "audio"}],
                "coverage": "SINGING_CONVERSION", "incomplete": False}
    except BaseException:
        target.unlink(missing_ok=True)
        raise
