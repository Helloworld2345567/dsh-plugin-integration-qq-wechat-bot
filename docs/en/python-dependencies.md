# Python dependencies and runtime

[简体中文](../cn/python-dependencies.md) | English

Python **3.12 and 3.13** are supported. User requirement files use compatible ranges; `*-ci.txt` files pin CI snapshots. These snapshots do not guarantee wheels on every platform or compatibility with external model services.

## Install

```powershell
python -m pip install -r requirements.txt
python -m pip check
# Add when using Edge TTS:
python -m pip install -r requirements-voice-generation.txt
```

Base dependencies support HTTP, images, PDF, Office and media downloads. Install FFmpeg/ffprobe separately. The network module imports `yarl` directly, so it is explicitly declared instead of relying on `aiohttp` to install it transitively.

| File | Purpose |
| --- | --- |
| `requirements.txt` | Base media and document dependencies |
| `requirements-voice-generation.txt` | Optional Edge TTS |
| `requirements-ci.txt`, `requirements-voice-generation-ci.txt` | Corresponding pinned CI versions |
| `requirements-audit-ci.txt` | Temporary audit tools, excluded from runtime packages |

Operators separately manage CUDA, RVC, GPT-SoVITS, Breeze, Music, model weights and third-party services. They do not belong in the main requirements. If a Python/platform combination lacks a wheel, record the exact version and error before adjusting that environment; do not add the entire external project to base dependencies.

## Package and loading boundaries

Production implementation lives exclusively in `python/dsh_bot_runtime/`. The host trusts only the installed package's `python/` root and starts `-B -P -u -m dsh_bot_runtime.worker`, without inheriting the caller's `PYTHONPATH` or inferring a repository root from the working directory.

`skills/catalog.json` defines skill entries and dispatchers and generates TypeScript/Python registries. Per-skill `operations.json` files describe operations. Ordinary worker imports do not scan skills; first execution reads manifests and loads approved entries by full package name. See [development](development.md) for adding operations and generation checks.

Module imports do not read credentials, user configuration or models, or create files, databases, threads, network connections or subprocesses. Document libraries, Pillow, Edge TTS, yt-dlp, Faiss and RVC load on the relevant execution path. A missing optional dependency fails that capability without blocking unrelated document or image operations. FFmpeg/ffprobe are also invoked at execution time.

## Release layout

`python/dsh_bot_runtime/**/*.py` is the only implementation tree. Root-level `worker.py`, `image_api.py`, `rvc_service.py`, `rvc_runner.py`, `rvc_output.py` and `extract_worker.py` are thin CLI entry points. Skill directories ship Markdown, operation declarations and the catalog, without another Python implementation copy.

Release gates exclude `pyc`, `__pycache__`, tests, runtime data and unapproved root Python files. Installation smoke runs an offline document job from an actual installed archive. See [testing](testing.md) for validation entry points and [dependency audit](dependency-audit.md) for licenses and known dependency risks.
