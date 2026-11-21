# Python 依赖与运行时

简体中文 | [English](../en/python-dependencies.md)

支持 Python **3.12 和 3.13**。用户依赖文件使用兼容范围，`*-ci.txt` 保存 CI 精确快照；快照不保证所有平台 wheel 或外部模型服务可用。

## 安装

```powershell
python -m pip install -r requirements.txt
python -m pip check
# 使用 Edge TTS 时另装：
python -m pip install -r requirements-voice-generation.txt
```

基础依赖支持 HTTP、图片、PDF、Office 和媒体下载。FFmpeg/ffprobe 需单独安装。`yarl` 由网络模块直接导入，因此显式声明，不依赖 `aiohttp` 间接安装。

| 文件 | 用途 |
| --- | --- |
| `requirements.txt` | 基础媒体与文档依赖 |
| `requirements-voice-generation.txt` | 可选 Edge TTS |
| `requirements-ci.txt`、`requirements-voice-generation-ci.txt` | 对应 CI 精确版本 |
| `requirements-audit-ci.txt` | 临时审计工具，不属于运行时发布包 |

CUDA、RVC、GPT-SoVITS、Breeze、Music、模型权重和第三方服务由运营者单独管理，不加入主 requirements。特定 Python/平台缺少 wheel 时，记录具体版本和错误，再调整该环境；不要把整个外部项目加入主依赖。

## 包与加载边界

生产实现统一位于 `python/dsh_bot_runtime/`。宿主只信任安装包的 `python/` 根，使用 `-B -P -u -m dsh_bot_runtime.worker` 启动，不继承调用方 `PYTHONPATH` 或从工作目录猜测仓库位置。

技能 entry 和 dispatcher 由 `skills/catalog.json` 定义并生成 TypeScript/Python registry；各技能的 `operations.json` 描述操作。普通 worker import 不扫描技能，首次执行才读取 manifest，使用完整包名加载批准 entry。新增操作和生成检查见[开发指南](development.md)。

模块导入不读取凭据、用户配置或模型，不创建文件、数据库、线程、网络连接或子进程。文档解析库、Pillow、Edge TTS、yt-dlp、Faiss 与 RVC 等依赖在对应执行路径加载；某个可选技能缺依赖时返回该能力错误，不阻断无关文档或图片能力。FFmpeg/ffprobe 也在执行时调用。

## 发布布局

`python/dsh_bot_runtime/**/*.py` 是唯一实现树；根目录的 `worker.py`、`image_api.py`、`rvc_service.py`、`rvc_runner.py`、`rvc_output.py`、`extract_worker.py` 仅作为薄 CLI 入口。技能目录发布 Markdown、操作声明和 catalog，不发布另一份 Python 实现。

发布门禁排除 `pyc`、`__pycache__`、测试、运行数据和未批准的根级 Python 文件；安装 smoke 在实际归档安装目录执行无网络文档作业。完整验证入口见[测试指南](testing.md)，许可证和已知依赖风险见[依赖审计](dependency-audit.md)。
