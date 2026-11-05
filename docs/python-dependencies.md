# Python 依赖支持矩阵

本项目支持 Python 3.12 和 3.13。`requirements.txt` 是用户输入文件，使用兼容范围；CI 使用对应的 `*-ci.txt` 精确快照来减少同一 CI 运行中的解析漂移。`requirements-audit-ci.txt` 只包含临时审计工具，不属于运行时包。精确快照不是对所有平台 wheel、外部服务或模型的长期保证。

## 基础环境

```powershell
python -m pip install -r requirements.txt
python -m pip check
```

基础依赖提供 HTTP、URL 校验、图片、PDF、Office、PDFium 和媒体下载能力。`yarl` 由 `dsh_bot_runtime.video_understanding.network` 直接导入，因此作为直接依赖声明，不依赖 `aiohttp` 的传递安装。FFmpeg/ffprobe 是独立系统前置条件，不由 pip 安装。

所有生产模块统一位于 `python/dsh_bot_runtime/`；宿主只把该目录的父级 `python/` 作为受信包根。HTTP/Pillow、文档解析、Edge TTS、yt-dlp、Faiss 与 RVC 等依赖在对应能力首次执行或对应叶子模块加载时才需要；核心 worker 导入不探测网络、模型、SQLite 或外部服务。基础命名空间缺失会 fail closed；某个可选 skill 的 entry 或依赖损坏只返回稳定的 skill／能力错误，不阻断 document、image 或其他 skill。

## 可选语音生成

```powershell
python -m pip install -r requirements-voice-generation.txt
```

Edge TTS 只启用可选 voice-generation 路径；基础安装不依赖它。它不包含本地模型、CUDA 或外部服务凭据。

## 明确排除

CUDA、RVC、GPT-SoVITS、Music、模型权重、平台登录数据和第三方服务均由运营者单独管理，不加入主 requirements，也不在 CI 安装。遇到 Python 包无法在特定 Python/平台提供 wheel 时，应记录具体版本和平台，不要为了绕过错误把外部项目塞入主依赖。
