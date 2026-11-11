# Python Dependency Support Matrix

[简体中文](../python-dependencies.md) | English

Python 3.12 and 3.13 are supported. User `requirements.txt` uses compatible ranges; CI uses exact `*-ci.txt` snapshots to reduce resolution drift within a run. `requirements-audit-ci.txt` contains temporary audit tools only. Exact snapshots are not long-term guarantees for all platform wheels, services or models.

## Base environment

```powershell
python -m pip install -r requirements.txt
python -m pip check
```

Base packages provide HTTP, URL validation, images, PDF, Office, PDFium and downloads. `dsh_bot_runtime.video_understanding.network` directly imports `yarl`, declared directly rather than relying on aiohttp's transitive install. FFmpeg/ffprobe are separate system prerequisites, not pip packages.

All production modules live in `python/dsh_bot_runtime/`; the host trusts only its parent `python/` as package root. HTTP/Pillow, document parsers, Edge TTS, yt-dlp, Faiss and RVC dependencies are needed only on the relevant first operation or leaf import. Importing the core worker does not probe networks, models, SQLite or services. Missing base namespace fails closed. A broken optional skill entry/dependency yields a stable skill/capability error without blocking document, image or other skills.

## Optional voice generation

```powershell
python -m pip install -r requirements-voice-generation.txt
```

Edge TTS enables only optional voice-generation. Base installation does not depend on it. It includes no local models, CUDA or service credentials.

## Explicit exclusions

Operators separately manage CUDA, RVC, GPT-SoVITS, Music, weights, platform login data and third-party services; these are neither main requirements nor CI installs. If a wheel is unavailable for a Python/platform combination, record that exact combination rather than adding an external project to bypass the problem.
