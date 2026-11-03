# Python 依赖支持矩阵

本项目支持 Python 3.12 和 3.13。`requirements.txt` 是用户输入文件，使用兼容范围；CI 使用对应的 `*-ci.txt` 精确快照来减少同一 CI 运行中的解析漂移。`requirements-audit-ci.txt` 只包含临时审计工具，不属于运行时包。精确快照不是对所有平台 wheel、外部服务或模型的长期保证。

## 基础环境

```powershell
python -m pip install -r requirements.txt
python -m pip check
```

基础依赖提供 HTTP、图片、PDF、Office、PDFium 和媒体下载能力。FFmpeg/ffprobe 是独立系统前置条件，不由 pip 安装。

## 可选语音生成

```powershell
python -m pip install -r requirements-voice-generation.txt
```

Edge TTS 只启用可选 voice-generation 路径；基础安装不依赖它。它不包含本地模型、CUDA 或外部服务凭据。

## 明确排除

CUDA、RVC、GPT-SoVITS、Music、模型权重、平台登录数据和第三方服务均由运营者单独管理，不加入主 requirements，也不在 CI 安装。遇到 Python 包无法在特定 Python/平台提供 wheel 时，应记录具体版本和平台，不要为了绕过错误把外部项目塞入主依赖。
