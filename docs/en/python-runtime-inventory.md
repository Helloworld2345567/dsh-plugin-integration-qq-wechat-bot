# Python Runtime Audit Inventory

[简体中文](../python-runtime-inventory.md) | English

This records production modules, test imports, entries, side effects, optional dependencies and package layout after the single-namespace refactor. The public namespace is `dsh_bot_runtime`, implemented in `python/dsh_bot_runtime/`.

## Discovery and loading

- The host trusts only the installed package's `python/`, launching `-B -P -u -m dsh_bot_runtime.worker`; it does not inherit caller `PYTHONPATH` or infer roots from cwd.
- `skills/*/operations.json` declares only the four fixed shipped entries. Architecture checks validate content digests, module presence and the build-time Host registry. The same manifest owns tools, routes, quotas and model-visible behavior. Host imports never scan skills.
- Python reads manifests only on first skill execution. Ordinary worker/document/image/social imports do not scan skills.
- Entries use standard `importlib.import_module()`, with full package names as the only `sys.modules` keys. Multiple operations in one skill share one stable module object.
- Personas, chat, workspaces, model arguments and cwd cannot supply modules/packages/scripts. Production forbids `spec_from_file_location()`, `sys.path.insert/append`, `site.addsitedir` and writes to `PYTHONPATH`.
- Invalid manifests yield `SKILL_OPERATION_MANIFEST_INVALID`, import failures `SKILL_OPERATION_IMPORT_FAILED`, missing execute `SKILL_OPERATION_ENTRY_MISSING`, unknown execution failures `SKILL_OPERATION_FAILED`. Only formatted business codes defined by `dsh_bot_runtime` cross layers; other exceptions expose no type/message/path/endpoint/credential/traceback.

## Production imports

All statically visible imports are listed, including lazy imports inside functions. Relative imports retain leading dots.

| Module | Complete import list |
| --- | --- |
| `dsh_bot_runtime` | None |
| `audio_output` | `__future__`, `json`, `math`, `pathlib`, `shutil`, `subprocess`, `time` |
| `errors` | `__future__`, `re` |
| `model_usage` | `json`, `os`, `pathlib`, `time`, `uuid` |
| `rvc_output` | `__future__`, `argparse`, `dsh_bot_runtime.audio_output`, `pathlib`, `time` |
| `rvc_runner` | `__future__`, `argparse`, `dataclasses`, `dsh_bot_runtime.separation_runner`, `dsh_bot_runtime.singing_common`, `faiss`, `json`, `os`, `pathlib`, `rvc.vc.audio`, `rvc.vc.checkpoints`, `rvc.vc.config`, `rvc.vc.engine` |
| `rvc_service` | `__future__`, `argparse`, `collections`, `dataclasses`, `dsh_bot_runtime.singing_common`, `email.parser`, `email.policy`, `http.server`, `json`, `os`, `pathlib`, `re`, `shutil`, `signal`, `subprocess`, `sys`, `tempfile`, `threading`, `time`, `urllib.parse` |
| `separation_runner` | `__future__`, `dsh_bot_runtime.singing_common`, `pathlib`, `rvc.core.devices`, `rvc.separation.audio_io`, `rvc.separation.catalog`, `rvc.separation.separator`, `subprocess` |
| `singing_common` | `__future__`, `math`, `pathlib`, `re`, `subprocess`, `wave` |
| `singing_worker` | `__future__`, `asyncio`, `dsh_bot_runtime.audio_output`, `dsh_bot_runtime.model_usage`, `dsh_bot_runtime.singing_common`, `dsh_bot_runtime.skills.media_analysis.platform_links`, `dsh_bot_runtime.video_understanding.media`, `dsh_bot_runtime.video_understanding.models`, `dsh_bot_runtime.video_understanding.network`, `json`, `pathlib`, `requests`, `tempfile`, `time`, `urllib.parse` |
| `social_posts` | `__future__`, `aiohttp`, `asyncio`, `html.parser`, `json`, `re`, `urllib.parse` |
| `worker` | `__future__`, `asyncio`, `contextlib`, `docx`, `dsh_bot_runtime.errors`, `dsh_bot_runtime.singing_common`, `dsh_bot_runtime.social_posts`, `importlib`, `io`, `json`, `math`, `openpyxl`, `pathlib`, `pypdf`, `pypdfium2`, `re`, `subprocess`, `sys`, `time`, `zipfile` |
| `skills` and the five skill `__init__` modules | None |
| `skills.image_generation.image_api` | `__future__`, `dsh_bot_runtime.skills.image_generation.common`, `dsh_bot_runtime.skills.image_generation.comfyui.image_api`, `dsh_bot_runtime.skills.image_generation.openai.image_api`, `sys` |
| `skills.image_generation.common` | `PIL`, `__future__`, `io`, `ipaddress`, `mimetypes`, `pathlib`, `re`, `socket`, `time`, `urllib.parse` |
| `skills.image_generation.openai.image_api` | `PIL`, `__future__`, `argparse`, `base64`, `dsh_bot_runtime.model_usage`, `dsh_bot_runtime.skills.image_generation.common`, `json`, `os`, `pathlib`, `requests`, `urllib.parse` |
| `skills.image_generation.comfyui.image_api` | `PIL`, `__future__`, `argparse`, `dsh_bot_runtime.model_usage`, `dsh_bot_runtime.skills.image_generation.common`, `json`, `pathlib`, `requests`, `time`, `urllib.parse`, `uuid` |
| `skills.media_analysis.douyin_links` | `aiohttp`, `dsh_bot_runtime.video_understanding.models`, `dsh_bot_runtime.video_understanding.network`, `html`, `json`, `os`, `pathlib`, `re`, `urllib.parse` |
| `skills.media_analysis.image_download` | `PIL`, `aiohttp`, `dsh_bot_runtime.skills.media_analysis.douyin_links`, `dsh_bot_runtime.skills.media_analysis.platform_links`, `dsh_bot_runtime.video_understanding.models`, `dsh_bot_runtime.video_understanding.network`, `html.parser`, `json`, `pathlib`, `re`, `urllib.parse` |
| `skills.media_analysis.image_transform` | `PIL`, `dsh_bot_runtime.skills.media_analysis.transform_common`, `math`, `pathlib`, `time` |
| `skills.media_analysis.media_api` | `__future__`, `asyncio`, `base64`, `contextlib`, `dsh_bot_runtime.errors`, `dsh_bot_runtime.model_usage`, `dsh_bot_runtime.skills.media_analysis.image_download`, `dsh_bot_runtime.skills.media_analysis.image_transform`, `dsh_bot_runtime.skills.media_analysis.platform_links`, `dsh_bot_runtime.skills.media_analysis.video_transform`, `dsh_bot_runtime.video_understanding`, `dsh_bot_runtime.video_understanding.backend`, `io`, `json`, `math`, `os`, `pathlib`, `requests`, `subprocess`, `sys`, `time` |
| `skills.media_analysis.platform_links` | `aiohttp`, `dsh_bot_runtime.skills.media_analysis.douyin_links`, `dsh_bot_runtime.video_understanding.media`, `dsh_bot_runtime.video_understanding.models`, `dsh_bot_runtime.video_understanding.network`, `dsh_bot_runtime.video_understanding.sources`, `json`, `pathlib`, `re`, `urllib.parse` |
| `skills.media_analysis.transform_common` | `json`, `math`, `pathlib`, `subprocess`, `time` |
| `skills.media_analysis.video_transform` | `concurrent.futures`, `contextlib`, `dsh_bot_runtime.skills.media_analysis.transform_common`, `json`, `math`, `pathlib`, `struct`, `tempfile`, `time` |
| `skills.music_download.entry` | `dsh_bot_runtime.audio_output`, `pathlib`, `time` |
| `skills.singing_conversion.entry` | `dsh_bot_runtime.singing_worker` |
| `skills.voice_generation.voice_api` | `__future__`, `asyncio`, `contextlib`, `dsh_bot_runtime.errors`, `dsh_bot_runtime.model_usage`, `edge_tts`, `io`, `json`, `math`, `pathlib`, `requests`, `sys`, `time`, `urllib.parse`, `wave` |
| `video_understanding.__init__` | `.models`, `dsh_bot_runtime.video_understanding.service` (lazy on accessing `VideoService`) |
| `video_understanding.backend` | `.models`, `aiohttp`, `base64`, `dataclasses`, `hashlib`, `json`, `math`, `urllib.parse` |
| `video_understanding.extract_worker` | `dsh_bot_runtime.video_understanding.models`, `dsh_bot_runtime.video_understanding.network`, `dsh_bot_runtime.video_understanding.sources`, `http.client`, `io`, `json`, `os`, `socket`, `ssl`, `sys`, `urllib.error`, `urllib.request`, `yt_dlp`, `yt_dlp.globals`, `yt_dlp.networking`, `yt_dlp.networking.common`, `yt_dlp.networking.exceptions` |
| `video_understanding.media` | `.models`, `.process`, `json`, `math`, `pathlib`, `shutil` |
| `video_understanding.models` | `dataclasses`, `math` |
| `video_understanding.network` | `.models`, `aiohttp`, `aiohttp.abc`, `asyncio`, `ipaddress`, `pathlib`, `socket`, `urllib.parse`, `yarl` |
| `video_understanding.process` | `.models`, `asyncio`, `os` |
| `video_understanding.service` | `.media`, `.models`, `.sources`, `.store`, `asyncio`, `dataclasses`, `hashlib`, `json`, `logging`, `pathlib`, `secrets`, `shutil`, `time` |
| `video_understanding.sources` | `.models`, `.network`, `.process`, `dataclasses`, `hashlib`, `json`, `os`, `pathlib`, `re`, `secrets`, `stat`, `sys`, `time`, `urllib.parse` |
| `video_understanding.store` | `.models`, `json`, `sqlite3`, `time` |
| `python/worker.py` | `dsh_bot_runtime.worker` |
| `python/rvc_service.py` | `dsh_bot_runtime.rvc_service` |
| `python/rvc_runner.py` | `dsh_bot_runtime.rvc_runner` |
| `python/rvc_output.py` | `dsh_bot_runtime.rvc_output` |
| `python/extract_worker.py` | `dsh_bot_runtime.video_understanding.extract_worker` |

Production internal imports use `dsh_bot_runtime...` or package-relative names. External `rvc.*`, `faiss`, `edge_tts`, `yt_dlp` retain standard third-party keys without private aliases. Different project paths never share an internal `sys.modules` key.

## Test imports

| Test | Complete import list |
| --- | --- |
| `benchmark_media_transform.py` | `PIL`, `argparse`, `concurrent.futures`, `dsh_bot_runtime.skills.media_analysis`, `json`, `pathlib`, `statistics`, `subprocess`, `tempfile`, `time` |
| `test_audio_output.py` | `dsh_bot_runtime`, `dsh_bot_runtime.skills.music_download`, `json`, `pathlib`, `struct`, `subprocess`, `sys`, `tempfile`, `unittest`, `unittest.mock`, `wave` |
| `test_gpt_sovits_voice.py` | `dsh_bot_runtime`, `dsh_bot_runtime.skills.voice_generation`, `io`, `json`, `pathlib`, `requests`, `struct`, `tempfile`, `unittest`, `unittest.mock`, `wave` |
| `test_media_quota.py` | `asyncio`, `dataclasses`, `dsh_bot_runtime`, `dsh_bot_runtime.skills.media_analysis`, `dsh_bot_runtime.video_understanding.models`, `dsh_bot_runtime.video_understanding.sources`, `dsh_bot_runtime.video_understanding.store`, `os`, `pathlib`, `tempfile`, `unittest`, `unittest.mock` |
| `test_media_transform.py` | `PIL`, `dsh_bot_runtime.skills.media_analysis`, `dsh_bot_runtime.skills.media_analysis.transform_common`, `json`, `pathlib`, `shutil`, `subprocess`, `sys`, `tempfile`, `time`, `unittest`, `unittest.mock` |
| `test_namespace_imports.py` | `__future__`, `json`, `os`, `pathlib`, `subprocess`, `sys`, `tempfile`, `textwrap`, `unittest` |
| `test_singing_runner.py` | `dataclasses`, `dsh_bot_runtime`, `dsh_bot_runtime.rvc_runner`, `dsh_bot_runtime.separation_runner`, `dsh_bot_runtime.singing_common`, `io`, `os`, `pathlib`, `struct`, `sys`, `tempfile`, `types`, `unittest`, `unittest.mock`, `wave` |
| `test_singing_service.py` | `dsh_bot_runtime.rvc_service`, `dsh_bot_runtime.singing_common`, `io`, `json`, `pathlib`, `requests`, `struct`, `sys`, `tempfile`, `threading`, `time`, `unittest`, `wave` |
| `test_singing_worker.py` | `dsh_bot_runtime`, `dsh_bot_runtime.singing_common`, `io`, `json`, `pathlib`, `requests`, `struct`, `tempfile`, `unittest`, `unittest.mock`, `wave` |
| `test_video_limits.py` | `asyncio`, `dsh_bot_runtime.skills.media_analysis`, `dsh_bot_runtime.video_understanding`, `dsh_bot_runtime.video_understanding.media`, `dsh_bot_runtime.video_understanding.models`, `dsh_bot_runtime.video_understanding.sources`, `os`, `pathlib`, `tempfile`, `types`, `unittest`, `unittest.mock` |
| `test_voice_api.py` | `dsh_bot_runtime.skills.voice_generation`, `pathlib`, `tempfile`, `unittest`, `unittest.mock` |
| `test_comfyui.py` | `dsh_bot_runtime.skills.image_generation`, `dsh_bot_runtime.skills.image_generation.comfyui`, `dsh_bot_runtime.skills.image_generation.openai`, `json`, `pathlib`, `tempfile`, `unittest`, `unittest.mock` |
| `test_worker.py` | `PIL`, `asyncio`, `base64`, `docx`, `dsh_bot_runtime`, `dsh_bot_runtime.model_usage`, `dsh_bot_runtime.skills.image_generation`, `dsh_bot_runtime.skills.media_analysis`, `dsh_bot_runtime.skills.media_analysis.image_download`, `dsh_bot_runtime.skills.media_analysis.platform_links`, `dsh_bot_runtime.video_understanding`, `dsh_bot_runtime.video_understanding.backend`, `dsh_bot_runtime.video_understanding.models`, `dsh_bot_runtime.video_understanding.sources`, `io`, `json`, `openpyxl`, `os`, `pathlib`, `pypdf`, `requests`, `shutil`, `subprocess`, `sys`, `tempfile`, `time`, `unittest`, `unittest.mock`, `wave` |

Tests no longer inject production modules through `sys.path`. Only external-RVC fixtures temporarily inject paths to simulate an operator-installed third-party `rvc` package, restoring them afterward.

## Entries and reusable modules

| Category | Entry | Behavior |
| --- | --- | --- |
| Media worker | `python -B -P -u -m dsh_bot_runtime.worker`; compatible `python/worker.py` | One stdin JSON job, stdout `dsh.media-worker` v1 envelope; import does not read stdin |
| RVC service | `python/rvc_service.py` or `-m dsh_bot_runtime.rvc_service` | main parses args, creates manager/server and runs persistently |
| RVC runner | `python/rvc_runner.py` or `-m dsh_bot_runtime.rvc_runner` | main reads fixed job JSON, writes status JSON, exits 0/1 |
| RVC output | `python/rvc_output.py` or `-m dsh_bot_runtime.rvc_output` | main performs fixed output encoding, exits 0/1/2 |
| Video metadata | `python/extract_worker.py` or `-m dsh_bot_runtime.video_understanding.extract_worker` | main processes one fixed URL and outputs JSON only |
| Image dispatcher | `-m dsh_bot_runtime.skills.image_generation.image_api`; compatible `python/image_api.py` | main selects one configured service adapter; models cannot invoke CLI or supply paths |
| OpenAI image adapter | `-m dsh_bot_runtime.skills.image_generation.openai.image_api` | OpenAI-compatible generate/edit implementation |
| ComfyUI image adapter | `-m dsh_bot_runtime.skills.image_generation.comfyui.image_api` | ComfyUI API workflow submission and output download |
| Media/voice skill CLI | `-m ...media_api`, `-m ...voice_api` | Compatible stdin/stdout debug entries; production manifests call execute(job) |
| Skill-only entries | music/singing `entry.execute(job)` | Worker-only, not independent persistent CLIs |
| Shared libraries | audio, usage, social, singing, video core, transform helpers | Functions/types only; import never runs main |

## Import-time behavior

- Top-level execution is limited to constants, functions, classes, dataclasses, registry declarations and normal imports; `worker.SKILL_OPERATIONS` starts as `None`.
- `video_understanding.__init__` directly loads only pure models; `VideoService` is a lazy module attribute.
- Imports do not read operations manifests, environment credentials or user/profile files; scan models; create files/directories/SQLite/threads/timers/sockets/servers/children.
- SQLite opens only in `JobStore()` construction; directories appear only in `VideoService()`/`SourceResolver()`; `JobManager()` creates session directories/FIFO thread when constructed. These belong to execute/service lifecycle, not imports.
- `rvc_runner.convert()` sets `RVC_CUDA_GRAPH=0` only during execution; extractor plugin policy is also execution-only.
- Cold subprocess tests import all modules forward/backward with conflicting basenames, audit sockets/processes/SQLite/threads/writes, and verify no pyc/`__pycache__` remains.

## Optional-dependency branches

- PDF/DOCX/XLSX load `pypdf`, `pypdfium2`, `python-docx`, `openpyxl` on first matching document_read format.
- The dispatcher loads only the selected image adapter; image generation imports requests at actual CLI execution, Pillow on decoding/JPEG normalization; ordinary worker import does neither.
- GPT-SoVITS imports requests in its branch; first Edge synthesis imports edge_tts, retaining `EDGE_TTS_NOT_INSTALLED` when absent.
- Audio/video analysis/download imports requests, Pillow, aiohttp/yarl or video service only for the relevant operation. Local documents/unrelated skills do not depend on these entries loading successfully.
- Isolated metadata extractor imports yt_dlp inside extract(), yielding `YTDLP_UNAVAILABLE` if absent.
- RVC imports `rvc.vc.*` during model validation/inference, faiss only for configured indexes, `rvc.separation.*` only when separation is enabled.
- FFmpeg/ffprobe are execution-time external commands, not import-time probes.

## npm package layout

`package.json.files` distributes only:

- `python/dsh_bot_runtime/**/*.py`: the sole implementation tree.
- `python/worker.py`, `image_api.py`, `rvc_service.py`, `rvc_runner.py`, `rvc_output.py`, `extract_worker.py`: six thin CLI shims.
- `skills/**/*.md`, `skills/**/operations.json`: model instructions/references/fixed entry declarations.
- TypeScript builds, lifecycle package, documentation and controlled scripts.

The release gate rejects skill Python copies, `python/vendor/**`, unapproved root Python modules, pyc/caches, test doubles, databases, logs, archives and runtime directories. Installation smoke runs a network-free document job from the actual installed archive using controlled `PYTHONPATH` and `-B -P -m dsh_bot_runtime.worker`, not just the source checkout.
