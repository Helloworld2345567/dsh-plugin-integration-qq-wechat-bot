"""One fixed media job over stdin/stdout. No script, import-name or shell API."""
from __future__ import annotations
import asyncio
import contextlib
import io
import json
import math
from pathlib import Path
import subprocess
import sys
import time
import zipfile

RELEASE_ROOT = Path(__file__).resolve().parents[2]
PROTOCOL = "dsh.media-worker"
PROTOCOL_VERSION = 1


class JobError(Exception):
    pass


def checked_number(value, minimum, maximum):
    if type(value) not in (int, float) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise JobError("INVALID_MEDIA_RANGE")
    return value


def _validate_json_shape(value, *, depth=0):
    """Bound the shape before a handler can hand parameters to a provider."""
    if depth > 6:
        raise JobError("MEDIA_WORKER_PARAMETERS_INVALID")
    if isinstance(value, str):
        if len(value) > 100_000:
            raise JobError("MEDIA_WORKER_PARAMETERS_INVALID")
    elif isinstance(value, list):
        if len(value) > 64:
            raise JobError("MEDIA_WORKER_PARAMETERS_INVALID")
        for item in value:
            _validate_json_shape(item, depth=depth + 1)
    elif isinstance(value, dict):
        if len(value) > 64:
            raise JobError("MEDIA_WORKER_PARAMETERS_INVALID")
        for key, item in value.items():
            if not isinstance(key, str) or not 1 <= len(key) <= 128:
                raise JobError("MEDIA_WORKER_PARAMETERS_INVALID")
            _validate_json_shape(item, depth=depth + 1)
    elif value is not None and not isinstance(value, (bool, int, float)):
        raise JobError("MEDIA_WORKER_PARAMETERS_INVALID")


def image(job):
    params = job["parameters"]
    operation = "edit" if job["operation"] == "image_edit" else "generate"
    if operation == "edit" and not job["inputs"]:
        raise JobError("REFERENCE_IMAGE_REQUIRED")
    endpoint = job["endpoint"]
    record = Path(job["output"]) / "image-result.json"
    command = [sys.executable, "-B", str(RELEASE_ROOT / "python" / "image_api.py"), operation,
               "--prompt", str(params.get("prompt", "")), "--model", endpoint["model"],
               "--base-url", endpoint["baseUrl"], "--api-key-env", endpoint["keyEnv"],
               "--output-dir", job["output"], "--output-format", "jpeg", "--n", "1",
               "--timeout", str(job.get("timeoutMs", 0) / 1000), "--record", str(record)]
    if job.get('usagePath'):
        command.extend(['--usage-record', job['usagePath']])
    if operation == "edit":
        for source in job["inputs"]:
            if source["kind"] != "image":
                raise JobError("REFERENCE_MUST_BE_IMAGE")
            command.extend(["--image", source["path"]])
    result = subprocess.run(command, capture_output=True, timeout=(job.get("timeoutMs", 0) / 1000 or None), check=False)
    if result.returncode:
        raise JobError("IMAGE_PROVIDER_FAILED")
    value = json.loads(record.read_text(encoding="utf-8"))
    # The canonical client records paths; never take a path from a model response.
    if "outputs" not in value:
        raise JobError("IMAGE_OUTPUT_RECORD_MISSING")
    files = value["outputs"]
    if not isinstance(files, list) or not files:
        raise JobError("IMAGE_OUTPUT_RECORD_INVALID")
    if not all(isinstance(p, str) and p.strip() for p in files):
        raise JobError("IMAGE_OUTPUT_RECORD_INVALID")
    if len(files) != 1:
        raise JobError("IMAGE_OUTPUT_COUNT_INVALID")
    output_root = Path(job["output"]).resolve()
    asset = (output_root / files[0]).resolve()
    if not asset.is_relative_to(output_root) or not asset.is_file():
        raise JobError("IMAGE_OUTPUT_RECORD_INVALID")
    return {"assets": [{"path": str(asset), "name": "image.jpg", "mime": "image/jpeg", "kind": "image"}]}


PUBLISHED_SKILL_ENTRIES = {
    "media-analysis": "dsh_bot_runtime.skills.media_analysis.media_api",
    "music-download": "dsh_bot_runtime.skills.music_download.entry",
    "singing-conversion": "dsh_bot_runtime.skills.singing_conversion.entry",
    "voice-generation": "dsh_bot_runtime.skills.voice_generation.voice_api",
}


def _read_skill_manifest(manifest_path):
    import re
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    skill_name = manifest_path.parent.name
    if not isinstance(manifest, dict):
        raise JobError("SKILL_OPERATION_MANIFEST_INVALID")
    entry = manifest.get("entry")
    operations = manifest.get("operations")
    if (manifest.get("skill") != skill_name or "worker" in manifest or not re.fullmatch(r"[a-z][a-z0-9-]*", skill_name)
            or entry != PUBLISHED_SKILL_ENTRIES.get(skill_name)
            or not isinstance(operations, list) or not operations):
        raise JobError("SKILL_OPERATION_MANIFEST_INVALID")
    result = {}
    for operation in operations:
        operation_id = operation.get("id") if isinstance(operation, dict) else None
        if not isinstance(operation_id, str) or not re.fullmatch(r"[a-z][a-z0-9_]{1,80}", operation_id) or operation_id in result:
            raise JobError("SKILL_OPERATION_MANIFEST_INVALID")
        result[operation_id] = (skill_name, entry, operation)
    return result


def load_skill_operations(root, *, tolerate_invalid=False, validate_entries=False):
    """Load package-owned descriptors without importing any skill implementation."""
    import re
    valid, invalid, valid_conflicts = {}, {}, set()
    for manifest_path in sorted(Path(root).glob("*/operations.json")):
        raw = None
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
            declarations = _read_skill_manifest(manifest_path)
            if validate_entries:
                module_name = next(iter(declarations.values()))[1]
                module_file = RELEASE_ROOT / "python" / Path(*module_name.split("."))
                candidate = module_file.with_suffix(".py").resolve()
                package_entry = (module_file / "__init__.py").resolve()
                python_root = (RELEASE_ROOT / "python").resolve()
                if not ((candidate.is_relative_to(python_root) and candidate.is_file())
                        or (package_entry.is_relative_to(python_root) and package_entry.is_file())):
                    raise JobError("SKILL_OPERATION_ENTRY_MISSING")
            for operation_id, declaration in declarations.items():
                if operation_id in valid:
                    valid_conflicts.add(operation_id)
                else:
                    valid[operation_id] = declaration
        except (JobError, OSError, TypeError, ValueError, AttributeError, UnicodeError, json.JSONDecodeError) as error:
            if not tolerate_invalid:
                raise JobError("SKILL_OPERATION_MANIFEST_INVALID") from None
            code = str(error) if isinstance(error, JobError) and str(error) == "SKILL_OPERATION_ENTRY_MISSING" else "SKILL_OPERATION_MANIFEST_INVALID"
            operations = raw.get("operations", []) if isinstance(raw, dict) and isinstance(raw.get("operations"), list) else []
            for item in operations:
                if (isinstance(item, dict) and isinstance(item.get("id"), str)
                        and re.fullmatch(r"[a-z][a-z0-9_]{1,80}", item["id"])):
                    invalid.setdefault(item["id"], (manifest_path.parent.name, None, {**item, "_loadError": code}))
    if valid_conflicts and not tolerate_invalid:
        raise JobError("SKILL_OPERATION_MANIFEST_INVALID")
    for operation_id in valid_conflicts:
        valid[operation_id] = ("conflict", None, {"id": operation_id})
    for operation_id, declaration in invalid.items():
        valid.setdefault(operation_id, declaration)
    return valid


BASE_DEPENDENCIES = frozenset({"PIL", "aiohttp", "docx", "openpyxl", "pypdf", "pypdfium2", "requests", "yarl"})
OPTIONAL_DEPENDENCIES = frozenset({"edge_tts", "faiss", "rvc", "yt_dlp"})


def _dependency_code(error):
    if not isinstance(error, ModuleNotFoundError) or not isinstance(error.name, str):
        return None
    root = error.name.split(".", 1)[0]
    if root in BASE_DEPENDENCIES:
        return "MEDIA_DEPENDENCY_MISSING"
    if root in OPTIONAL_DEPENDENCIES:
        return "SKILL_OPTIONAL_DEPENDENCY_MISSING"
    return None


def skill(job):
    import importlib
    declaration = skill_operations().get(job["operation"])
    if declaration is None:
        raise JobError("UNKNOWN_MEDIA_OPERATION")
    _, module_name, operation = declaration
    if module_name is None:
        raise JobError(operation.get("_loadError", "SKILL_OPERATION_MANIFEST_INVALID"))
    try:
        module = importlib.import_module(module_name)
    except Exception as error:
        raise JobError(_dependency_code(error) or "SKILL_OPERATION_IMPORT_FAILED") from None
    execute_entry = getattr(module, "execute", None)
    if not callable(execute_entry):
        raise JobError("SKILL_OPERATION_ENTRY_MISSING")
    try:
        return execute_entry(job)
    except JobError:
        raise
    except Exception as error:
        from dsh_bot_runtime.errors import public_error_code
        raise JobError(_dependency_code(error) or public_error_code(error, "SKILL_OPERATION_FAILED")) from None


SKILL_OPERATIONS = None


def skill_operations():
    """Scan package manifests only when the first skill operation is requested."""
    global SKILL_OPERATIONS
    if SKILL_OPERATIONS is None:
        SKILL_OPERATIONS = load_skill_operations(RELEASE_ROOT / "skills", tolerate_invalid=True, validate_entries=True)
    return SKILL_OPERATIONS


def document(job):
    if len(job["inputs"]) != 1:
        raise JobError("ONE_DOCUMENT_REQUIRED")
    source = job["inputs"][0]
    file = Path(source["path"])
    suffix = Path(source["name"]).suffix.lower()
    incomplete = False
    context_assets = []
    if suffix in (".docx", ".xlsx"):
        with zipfile.ZipFile(file) as archive:
            if sum(i.file_size for i in archive.infolist()) > 100 * 1024**2:
                raise JobError("DOCUMENT_EXPANSION_LIMIT")
    if suffix == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(file)
        count = min(len(reader.pages), 100)
        texts = [page.extract_text() or "" for page in reader.pages[:count]]
        text = "\n".join(texts)
        missing = [i for i, value in enumerate(texts) if not value.strip()]
        if missing:
            import pypdfium2
            pdf = pypdfium2.PdfDocument(file)
            for i in missing[:10]:
                page = pdf[i]
                width, height = page.get_size()
                bitmap = page.render(scale=min(1.5, 1800 / max(width, height)))
                output = Path(job["output"]) / f"page-{i+1}.jpg"
                bitmap.to_pil().convert("RGB").save(output, "JPEG")
                texts[i] = f"[第{i+1}页：无可提取文字，已附真实页面图像，请由当前聊天模型读取。]"
                context_assets.append(dict(path=str(output), name=f"page-{i+1}.jpg", mime="image/jpeg", kind="image"))
                bitmap.close(); page.close()
            pdf.close(); text = "\n".join(texts)
        incomplete = len(reader.pages) > count or any(not text.strip() for text in texts)
    elif suffix == ".docx":
        from docx import Document
        doc = Document(file)
        text = "\n".join([p.text for p in doc.paragraphs] + ["\t".join(c.text for c in row.cells) for table in doc.tables for row in table.rows])
    elif suffix == ".xlsx":
        from openpyxl import load_workbook
        book = load_workbook(file, read_only=True, data_only=True)
        rows, cells = [], 0
        for sheet in book:
            rows.append(f"[{sheet.title}]")
            for row in sheet.iter_rows(values_only=True):
                cells += len(row)
                if cells > 10000:
                    incomplete = True; break
                rows.append("\t".join("" if value is None else str(value) for value in row))
            if incomplete: break
        book.close(); text = "\n".join(rows)
    elif suffix in (".txt", ".csv", ".tsv", ".md", ".json"):
        try: text = file.read_text(encoding="utf-8-sig")
        except UnicodeError: text = file.read_text(encoding="gb18030")
    else:
        raise JobError("UNSUPPORTED_DOCUMENT_FORMAT")
    if len(text) > 100000:
        text = text[:100000]; incomplete = True
    return {"text": text, "coverage": "DOCUMENT_TEXT_AND_PAGE_PIXELS" if context_assets else "DOCUMENT_EXTRACTION", "incomplete": incomplete, "contextAssets": context_assets}


def convert(job):
    if len(job["inputs"]) != 1:
        raise JobError("ONE_VIDEO_REQUIRED")
    params = job["parameters"]
    start = checked_number(params.get("startSeconds", 0), 0, 36000)
    duration = checked_number(params.get("durationSeconds", 6), 0.1, 30)
    output = Path(job["output"]) / "result.mp4"
    command = ["ffmpeg", "-v", "error", "-nostdin", "-ss", str(start), "-i", job["inputs"][0]["path"], "-t", str(duration)]
    command += ["-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart"]
    result = subprocess.run([*command, str(output)], capture_output=True, timeout=(job.get("timeoutMs", 0) / 1000 or None))
    if result.returncode or not output.exists():
        raise JobError("FFMPEG_FAILED")
    return {"assets": [{"path": str(output), "name": output.name, "mime": "video/mp4", "kind": "video"}]}


class OperationRegistry:
    """Versioned worker dispatch. Adding an operation is one registration, not a switch edit."""
    def __init__(self):
        self._handlers = {}

    def register(self, name, handler):
        if not isinstance(name, str) or not name or name in self._handlers:
            raise JobError("MEDIA_OPERATION_REGISTRATION_INVALID")
        self._handlers[name] = handler

    def execute(self, job):
        handler = self._handlers.get(job.get("handler"))
        if handler is None:
            raise JobError("UNKNOWN_MEDIA_OPERATION")
        return handler(job)


def _validate_result(result):
    if not isinstance(result, dict):
        raise JobError("MEDIA_WORKER_RESULT_INVALID")
    for key in ("text", "coverage"):
        if key in result and result[key] is not None and not isinstance(result[key], str):
            raise JobError("MEDIA_WORKER_RESULT_INVALID")
    if "incomplete" in result and not isinstance(result["incomplete"], bool):
        raise JobError("MEDIA_WORKER_RESULT_INVALID")
    for key in ("assets", "contextAssets"):
        files = result.get(key, [])
        if not isinstance(files, list) or len(files) > 100:
            raise JobError("MEDIA_WORKER_RESULT_INVALID")
        for file in files:
            if not isinstance(file, dict) or any(not isinstance(file.get(field), str) or not file[field] for field in ("path", "name", "mime", "kind")):
                raise JobError("MEDIA_WORKER_RESULT_INVALID")
    return result


def _validate_usage_journal(job):
    journal = Path(job["usagePath"])
    if not journal.exists():
        return
    try:
        value = json.loads(journal.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise JobError("MEDIA_USAGE_JOURNAL_INVALID") from None
    if not isinstance(value, list) or len(value) > 256:
        raise JobError("MEDIA_USAGE_JOURNAL_INVALID")
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not 1 <= len(item["id"]) <= 128 or item.get("attempted") is not True or not isinstance(item.get("at"), int):
            raise JobError("MEDIA_USAGE_JOURNAL_INVALID")
        if "model" in item and item["model"] is not None and (not isinstance(item["model"], str) or len(item["model"]) > 256):
            raise JobError("MEDIA_USAGE_JOURNAL_INVALID")
        if "usage" in item and item["usage"] is not None and not isinstance(item["usage"], dict):
            raise JobError("MEDIA_USAGE_JOURNAL_INVALID")


def _social(job):
    from dsh_bot_runtime.social_posts import read_post
    return {"text": json.dumps(asyncio.run(read_post(str(job["parameters"].get("url", "")))), ensure_ascii=False), "coverage": "PAGE_TEXT_ONLY"}


def _validate_protocol(job):
    if not isinstance(job, dict):
        raise JobError("MEDIA_WORKER_PROTOCOL_UNSUPPORTED")
    if 'processingSlots' in job and (type(job['processingSlots']) is not int or not 1 <= job['processingSlots'] <= 2):
        raise JobError('MEDIA_WORKER_SLOTS_INVALID')
    if 'dailyQuotaExempt' in job and type(job['dailyQuotaExempt']) is not bool:
        raise JobError('MEDIA_WORKER_QUOTA_INVALID')
    # Keep the pre-Phase-5 direct Python API usable for existing integrations;
    # jobs crossing the process boundary are emitted with an explicit version.
    if "protocol" not in job and "protocolVersion" not in job:
        job["protocol"] = PROTOCOL
        job["protocolVersion"] = PROTOCOL_VERSION
        job.setdefault("timeoutMs", 180000)
        job.setdefault("quotaUnits", 1)
        job.setdefault("usagePath", str(Path(job.get("output", ".")) / "model-usage.json"))
        job.setdefault("handler", job.get("operation"))
    if "handler" not in job:
        job["handler"] = job.get("operation")
    if job.get("protocol") != PROTOCOL or job.get("protocolVersion") != PROTOCOL_VERSION:
        raise JobError("MEDIA_WORKER_PROTOCOL_UNSUPPORTED")
    if not isinstance(job.get("id"), str) or not 1 <= len(job["id"]) <= 128 or not isinstance(job.get("scope"), str) or not 1 <= len(job["scope"]) <= 256 or not isinstance(job.get("operation"), str) or not 2 <= len(job["operation"]) <= 81 or not isinstance(job.get("handler"), str) or not 2 <= len(job["handler"]) <= 81:
        raise JobError("MEDIA_WORKER_JOB_INVALID")
    if not isinstance(job.get("parameters"), dict):
        raise JobError("MEDIA_WORKER_PARAMETERS_INVALID")
    try:
        if len(json.dumps(job["parameters"], ensure_ascii=False).encode("utf-8")) > 256 * 1024:
            raise JobError("MEDIA_WORKER_PARAMETERS_TOO_LARGE")
        _validate_json_shape(job["parameters"])
    except (TypeError, ValueError):
        raise JobError("MEDIA_WORKER_PARAMETERS_INVALID") from None
    if not isinstance(job.get("output"), str) or not job["output"] or len(job["output"]) > 4096 or not isinstance(job.get("usagePath"), str) or not job["usagePath"] or len(job["usagePath"]) > 4096:
        raise JobError("MEDIA_WORKER_PATH_INVALID")
    if not isinstance(job.get("inputs"), list) or len(job["inputs"]) > 8:
        raise JobError("INVALID_INPUTS")
    for item in job["inputs"]:
        if not isinstance(item, dict) or not all(isinstance(item.get(key), str) and item[key] for key in ("path", "name", "mime", "kind")) or any(len(item[key]) > limit for key, limit in (("path", 4096), ("name", 512), ("mime", 256), ("kind", 32))):
            raise JobError("MEDIA_WORKER_INPUT_INVALID")
    endpoint = job.get("endpoint")
    if endpoint is not None:
        if not isinstance(endpoint, dict) or not isinstance(endpoint.get("baseUrl"), str) or not endpoint["baseUrl"] or len(endpoint["baseUrl"]) > 2048:
            raise JobError("MEDIA_WORKER_ENDPOINT_INVALID")
        if endpoint.get("protocol") == "gpt_sovits":
            required = {"gptWeightsPath": 4096, "sovitsWeightsPath": 4096, "refAudioPath": 4096,
                        "promptText": 32768, "promptLang": 16, "textLang": 16, "voice": 100}
            if job["operation"] != "voice_speak" or any(
                    not isinstance(endpoint.get(key), str) or not endpoint[key].strip() or len(endpoint[key]) > limit
                    for key, limit in required.items()) or endpoint.get("modelVersion") not in (
                        "v1", "v2", "v2Pro", "v2ProPlus", "v3", "v4", "v5dev", "v5turbo"):
                raise JobError("MEDIA_WORKER_ENDPOINT_INVALID")
        elif endpoint.get("protocol") == "rvc_http_v1":
            from dsh_bot_runtime.singing_common import SingingError, validate_parameters
            try:
                if job["operation"] != "singing_convert":
                    raise SingingError("SINGING_CONFIG_INVALID")
                validate_parameters(endpoint)
            except SingingError:
                raise JobError("MEDIA_WORKER_ENDPOINT_INVALID") from None
        elif endpoint.get("protocol") == "edge_tts":
            voice = endpoint.get("voice")
            if job["operation"] != "voice_speak" or not isinstance(voice, str) or not voice.strip() or len(voice.encode("utf-8")) > 128:
                raise JobError("MEDIA_WORKER_ENDPOINT_INVALID")
        elif (not isinstance(endpoint.get("model"), str) or not endpoint["model"] or len(endpoint["model"]) > 256
              or not isinstance(endpoint.get("keyEnv"), str) or not endpoint["keyEnv"]
              or not endpoint["keyEnv"][0].isalpha() or not endpoint["keyEnv"].replace("_", "").isalnum()
              or not endpoint["keyEnv"].isupper()):
            raise JobError("MEDIA_WORKER_ENDPOINT_INVALID")
    if not isinstance(job.get("deadline"), (int, float)) or not math.isfinite(job["deadline"]) or (job.get("timeoutMs") != 0 and job["deadline"] < time.time() * 1000):
        raise JobError("JOB_EXPIRED")
    if not isinstance(job.get("timeoutMs"), int) or (job["timeoutMs"] != 0 and job["timeoutMs"] < 1000) or job["timeoutMs"] > 15 * 60 * 1000:
        raise JobError("MEDIA_WORKER_TIMEOUT_INVALID")
    if not isinstance(job.get("quotaUnits"), int) or job["quotaUnits"] < 1 or job["quotaUnits"] > 10000:
        raise JobError("MEDIA_WORKER_QUOTA_INVALID")


OPERATIONS = OperationRegistry()
OPERATIONS.register("skill", skill)
OPERATIONS.register("image", image)
OPERATIONS.register("document", document)
# Legacy direct callers may omit the descriptor handler; aliases preserve that
# pre-process API while process jobs use the registry-owned handler above.
OPERATIONS.register("image_generate", image)
OPERATIONS.register("image_edit", image)
OPERATIONS.register("document_read", document)
OPERATIONS.register("convert_mp4", convert)
OPERATIONS.register("social_read", _social)


def execute(job):
    _validate_protocol(job)
    try:
        raw = OPERATIONS.execute(job)
    except ModuleNotFoundError as error:
        raise JobError(_dependency_code(error) or "MEDIA_WORKER_FAILED") from None
    except JobError as error:
        if str(error) != "UNKNOWN_MEDIA_OPERATION" or job.get("handler") != job.get("operation"):
            raise
        if job.get("operation") not in skill_operations():
            raise
        raw = skill(job)
    result = _validate_result(raw)
    _validate_usage_journal(job)
    return result


def main() -> int:
    try:
        job = json.loads(sys.stdin.buffer.read(1024 * 1024))
        with contextlib.redirect_stdout(io.StringIO()):
            result = execute(job)
        print(json.dumps({"protocol": PROTOCOL, "protocolVersion": PROTOCOL_VERSION, "result": result}, ensure_ascii=False))
        return 0
    except Exception as error:
        from dsh_bot_runtime.errors import public_error_code, validated_error_code
        code = validated_error_code(str(error), "MEDIA_WORKER_FAILED") if isinstance(error, JobError) else public_error_code(error, "MEDIA_WORKER_FAILED")
        print(json.dumps({"protocol": PROTOCOL, "protocolVersion": PROTOCOL_VERSION, "error": {"code": code}}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
