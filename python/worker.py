"""One fixed media job over stdin/stdout. No script, import-name or shell API."""
from __future__ import annotations
import asyncio
import contextlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
import zipfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent / "vendor"))


class JobError(Exception):
    pass


def checked_number(value, minimum, maximum):
    if type(value) not in (int, float) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise JobError("INVALID_MEDIA_RANGE")
    return value


def image(job):
    params = job["parameters"]
    operation = "edit" if job["operation"] == "image_edit" else "generate"
    if operation == "edit" and not job["inputs"]:
        raise JobError("REFERENCE_IMAGE_REQUIRED")
    endpoint = job["endpoint"]
    record = Path(job["output"]) / "image-result.json"
    command = [sys.executable, str(ROOT / "skills/image-generation/scripts/image_api.py"), operation,
               "--prompt", str(params.get("prompt", "")), "--model", endpoint["model"],
               "--base-url", endpoint["baseUrl"], "--api-key-env", endpoint["keyEnv"],
               "--output-dir", job["output"], "--output-format", "jpeg", "--n", "1",
               "--timeout", "120", "--record", str(record)]
    if operation == "edit":
        for source in job["inputs"]:
            if source["kind"] != "image":
                raise JobError("REFERENCE_MUST_BE_IMAGE")
            command.extend(["--image", source["path"]])
    result = subprocess.run(command, capture_output=True, timeout=145, check=False)
    if result.returncode:
        raise JobError("IMAGE_PROVIDER_FAILED")
    value = json.loads(record.read_text(encoding="utf-8"))
    # The canonical client records paths; never take a path from a model response.
    files = value.get("outputs") or []
    if not files or not all(isinstance(p, str) for p in files):
        files = [str(p) for p in Path(job["output"]).glob("*.jpg")]
    if len(files) != 1:
        raise JobError("IMAGE_OUTPUT_COUNT_INVALID")
    return {"assets": [{"path": files[0], "name": "image.jpg", "mime": "image/jpeg", "kind": "image"}]}


def analyze_media(job):
    import importlib.util
    spec = importlib.util.spec_from_file_location('bot_media_analysis', ROOT / 'skills/media-analysis/scripts/media_api.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        return module.execute(job)
    except module.AnalysisError as error:
        raise JobError(str(error)) from None


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
    gif = job["operation"] == "convert_gif"
    output = Path(job["output"]) / ("result.gif" if gif else "result.mp4")
    command = ["ffmpeg", "-v", "error", "-nostdin", "-ss", str(start), "-i", job["inputs"][0]["path"], "-t", str(duration)]
    command += ["-vf", "fps=12,scale=480:-2:flags=lanczos", "-loop", "0"] if gif else ["-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart"]
    result = subprocess.run([*command, str(output)], capture_output=True, timeout=90)
    if result.returncode or not output.exists():
        raise JobError("FFMPEG_FAILED")
    return {"assets": [{"path": str(output), "name": output.name, "mime": "image/gif" if gif else "video/mp4", "kind": "image" if gif else "video"}]}


def execute(job):
    if not isinstance(job, dict) or job.get("deadline", 0) < time.time() * 1000:
        raise JobError("JOB_EXPIRED")
    if not isinstance(job.get("inputs"), list) or len(job["inputs"]) > 8:
        raise JobError("INVALID_INPUTS")
    operation = job.get("operation")
    if operation in ("image_generate", "image_edit"): return image(job)
    if operation in ("transcribe", "video_analyze"): return analyze_media(job)
    if operation == "document_read": return document(job)
    if operation in ("convert_gif", "convert_mp4"): return convert(job)
    if operation == "social_read":
        from social_posts import read_post
        return {"text": json.dumps(asyncio.run(read_post(str(job["parameters"].get("url", "")))), ensure_ascii=False), "coverage": "PAGE_TEXT_ONLY"}
    raise JobError("UNKNOWN_MEDIA_OPERATION")


if __name__ == "__main__":
    try:
        job = json.loads(sys.stdin.buffer.read(1024 * 1024))
        with contextlib.redirect_stdout(io.StringIO()):
            result = execute(job)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        code = str(error) if isinstance(error, JobError) else getattr(error, "code", type(error).__name__)
        print(json.dumps({"error": {"code": code}}))
        sys.exit(1)
