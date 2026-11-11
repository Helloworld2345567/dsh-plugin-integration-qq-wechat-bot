# Python 运行时审计清单

简体中文 | [English](en/python-runtime-inventory.md)

本文记录单一命名空间整改后的生产模块、测试 import、入口、副作用、可选依赖和发布布局。公共命名空间固定为 `dsh_bot_runtime`；实现根为 `python/dsh_bot_runtime/`。

## 发现与加载规则

- 宿主只把已安装包内的 `python/` 作为受信包根，以 `-B -P -u -m dsh_bot_runtime.worker` 启动媒体 worker；不继承调用方 `PYTHONPATH`，不从 cwd 猜测仓库根。
- `skills/*/operations.json` 只能声明四个固定发布 entry；架构门禁校验其内容摘要、模块存在性和 build-time Host registry。工具参数、路由、配额和模型可见行为仍由同一 manifest 声明。Host import 不扫描 skill 文件。
- Python worker 首次执行 skill operation 时才读取 manifest；import 普通 worker、document、image 或社交模块不会扫描 skill。
- entry 使用标准 `importlib.import_module()`；完整 package name 是唯一 `sys.modules` key。同一 skill 的多个 operation 共用同一模块对象，重复加载稳定。
- 人格、聊天输入、工作区、模型参数和 cwd 均不能提供 Python 模块、包或脚本路径。生产代码禁止 `spec_from_file_location()`、`sys.path.insert/append`、`site.addsitedir` 和写入 `PYTHONPATH`。
- manifest 无效映射 `SKILL_OPERATION_MANIFEST_INVALID`；entry 导入失败映射 `SKILL_OPERATION_IMPORT_FAILED`；缺少 `execute` 映射 `SKILL_OPERATION_ENTRY_MISSING`；未知执行异常映射 `SKILL_OPERATION_FAILED`。只有 `dsh_bot_runtime` 定义的格式化业务 code 可以跨层，其他异常不输出类型名、消息、路径、endpoint、credential 或 traceback。

## 生产模块 import 清单

下表列出静态可见的全部 import，包含函数内惰性 import；相对 import 保留前导点。

| 模块 | 完整 import 清单 |
| --- | --- |
| `dsh_bot_runtime` | 无 |
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
| `worker` | `__future__`, `asyncio`, `contextlib`, `docx`, `dsh_bot_runtime.errors`, `dsh_bot_runtime.singing_common`, `dsh_bot_runtime.social_posts`, `importlib`, `io`, `json`, `math`, `openpyxl`, `os`, `pathlib`, `pypdf`, `pypdfium2`, `re`, `subprocess`, `sys`, `time`, `zipfile` |
| `skills` 及五个 skill `__init__` | 无 |
| `skills.image_generation.image_api` | `PIL`, `__future__`, `argparse`, `base64`, `dsh_bot_runtime.model_usage`, `getpass`, `hashlib`, `io`, `ipaddress`, `json`, `mimetypes`, `os`, `pathlib`, `re`, `requests`, `socket`, `sys`, `time`, `urllib.parse` |
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
| `video_understanding.__init__` | `.models`, `dsh_bot_runtime.video_understanding.service`（仅访问 `VideoService` 属性时惰性导入） |
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

所有生产内部 import 都使用 `dsh_bot_runtime...` 或包内相对形式；外部 `rvc.*`、`faiss`、`edge_tts`、`yt_dlp` 保持第三方标准 key，不建立私有 alias。不存在两个不同路径占用同一项目内部 `sys.modules` key 的情况。

## 测试 import 清单

| 测试 | 完整 import 清单 |
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
| `test_worker.py` | `PIL`, `asyncio`, `base64`, `docx`, `dsh_bot_runtime`, `dsh_bot_runtime.model_usage`, `dsh_bot_runtime.skills.image_generation`, `dsh_bot_runtime.skills.media_analysis`, `dsh_bot_runtime.skills.media_analysis.image_download`, `dsh_bot_runtime.skills.media_analysis.platform_links`, `dsh_bot_runtime.video_understanding`, `dsh_bot_runtime.video_understanding.backend`, `dsh_bot_runtime.video_understanding.models`, `dsh_bot_runtime.video_understanding.sources`, `io`, `json`, `openpyxl`, `os`, `pathlib`, `pypdf`, `requests`, `shutil`, `subprocess`, `sys`, `tempfile`, `time`, `unittest`, `unittest.mock`, `wave` |

测试不再通过 `sys.path` 注入项目生产模块；唯一仍会临时注入路径的是 RVC 外部项目 fixture，用于模拟运营者安装的第三方 `rvc` 包，并在测试结束时回滚。

## 入口与可复用模块

| 类别 | 入口 | 行为 |
| --- | --- | --- |
| 媒体 worker | `python -B -P -u -m dsh_bot_runtime.worker`；兼容文件 `python/worker.py` | stdin 读取一个 JSON job，stdout 输出 `dsh.media-worker` v1 envelope；import 不读 stdin |
| RVC service | `python/rvc_service.py` 或 `-m dsh_bot_runtime.rvc_service` | `main()` 解析参数后创建 manager/server 并长期运行 |
| RVC runner | `python/rvc_runner.py` 或 `-m dsh_bot_runtime.rvc_runner` | `main()` 读取固定 job JSON，写 status JSON，退出 0/1 |
| RVC output | `python/rvc_output.py` 或 `-m dsh_bot_runtime.rvc_output` | `main()` 执行固定输出编码，退出 0/1/2 |
| 视频 metadata worker | `python/extract_worker.py` 或 `-m dsh_bot_runtime.video_understanding.extract_worker` | `main()` 处理一个固定 URL 参数并只输出 JSON |
| 图片客户端 | `-m dsh_bot_runtime.skills.image_generation.image_api` | `main()` 提供 generate/edit CLI；模型不能调用 CLI 或指定路径 |
| media/voice skill CLI | `-m ...media_api`、`-m ...voice_api` | 兼容 stdin/stdout 调试入口；生产 manifest 调用其 `execute(job)` |
| skill-only entry | music/singing `entry.execute(job)` | 仅由 worker 调用，不是独立长期 CLI |
| 共享库 | audio、usage、social、singing、video core、transform helpers | 只导出函数／类型；import 不执行 main |

## import 时顶层行为

- 所有模块只执行常量、函数、类、dataclass、registry 声明和标准 import；`worker.SKILL_OPERATIONS` 初始为 `None`。
- `video_understanding.__init__` 仅直接加载纯 models；`VideoService` 使用模块属性惰性导入。
- 不在 import 时读取 `operations.json`、环境凭据或用户/profile 文件，不扫描模型，不创建目录、文件、SQLite、线程、timer、socket、server 或子进程。
- `JobStore()` 构造时才连接 SQLite；`VideoService()`/`SourceResolver()` 构造时才创建目录；`JobManager()` 构造时才创建会话目录和 FIFO thread；这些是 execute/service 生命周期行为，不是 import 行为。
- `rvc_runner.convert()` 执行时才设置 `RVC_CUDA_GRAPH=0`；extractor 执行时才设置 yt-dlp 插件策略。
- 冷 subprocess 测试会以正序和逆序导入全部模块，预置冲突 basename，并审计 socket、进程、SQLite、线程和写盘；同时验证没有 pyc／`__pycache__`。

## 可选依赖执行分支

- PDF/DOCX/XLSX：分别在 `document_read` 首次处理对应格式时导入 `pypdf`、`pypdfium2`、`python-docx`、`openpyxl`。
- 图片生成：`requests` 在图片 CLI 实际执行时导入，Pillow 在图像解码／JPEG 归一化时导入；普通 worker import 不触发。
- 语音：GPT-SoVITS 请求分支导入 `requests`；Edge 分支首次合成导入 `edge_tts`，缺失仍返回 `EDGE_TTS_NOT_INSTALLED`。
- 音视频分析与下载：相应 operation 才导入 requests、Pillow、aiohttp/yarl 或 video service；本地 document 与无关 skill 不依赖这些 entry 成功。
- 视频平台 metadata：隔离 extractor 执行 `extract()` 时才导入 `yt_dlp`，缺失返回 `YTDLP_UNAVAILABLE`。
- RVC：模型校验／推理时才导入 `rvc.vc.*`；配置 index 时才导入 `faiss`；启用 separation 时才导入 `rvc.separation.*`。
- FFmpeg/ffprobe 是执行时外部命令依赖；import 不探测它们。

## npm pack 布局

`package.json.files` 只发布（`image_api.py` 与以下五个服务/worker 文件均为薄 CLI shim）：

- `python/dsh_bot_runtime/**/*.py`：唯一实现树；
- `python/worker.py`、`image_api.py`、`rvc_service.py`、`rvc_runner.py`、`rvc_output.py`、`extract_worker.py`：六个薄 CLI 入口；
- `skills/**/*.md` 与 `skills/**/operations.json`：模型说明、references 和固定 entry 声明；
- TypeScript 构建产物、生命周期子包、文档和受控脚本。

发布门禁拒绝 `skills/**/*.py`、`python/vendor/**`、未批准的 `python/*.py`、pyc、`__pycache__`、测试替身、数据库、日志、归档和运行目录。安装 smoke 从实际已安装归档使用受控 `PYTHONPATH` 运行 `-B -P -m dsh_bot_runtime.worker` 的无网络文档作业，避免只验证源码 checkout。
