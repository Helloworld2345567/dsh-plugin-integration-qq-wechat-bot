# QQ / 微信 Harness 插件

简体中文 | [English](README.en.md)

为 DeepSeek Harness 提供 QQ 官方渠道、微信 iLink、多机器人与人格管理，以及图片、语音、音乐和视频能力。

## 功能

- 独立的机器人设置、渠道会话、附件和长期记忆；切换人格保留会话。
- 图片生成与编辑、图片理解、语音识别、TTS 回复、视频分析和媒体转换。
- 音乐搜索下载与 RVC 音色转换，可按需接入外部服务和模型。
- 可信私聊中的定时任务、主动聊天、受控工具和长任务进度提醒。
- 中英文管理面板，配置从下一轮生效；界面语言与机器人固定提示语言独立。
- 独立产品部署支持监督启动、受管升级和回滚。

## 安装与上手

需要 Node.js 24+、Python 3.12/3.13、DeepSeek Harness `0.2.1-rc.5`；音视频处理需要 `ffmpeg` 和 `ffprobe`。Windows 使用 PowerShell 7。

先阅读[快速开始](docs/getting-started.md)，选择一种安装方式：

| 方式 | 适用场景 |
| --- | --- |
| [安装到已有 Harness](docs/install-existing-harness.md) | 向现有 profile 添加主插件，由你管理该 profile 的启停和更新 |
| [部署独立机器人产品](docs/deploy-product-profile.md) | 由安装器管理隔离的 `bots` profile、工作区和生命周期协调器 |

基础安装不要求 CUDA、GPT-SoVITS、Music、RVC 或模型权重；这些能力按需单独部署。未配置的能力显示为 `missing` 或 `blocked`。

安装后，在 Harness 配置聊天模型与凭据，进入“机器人面板”创建人格和机器人，完成 QQ/微信授权，再发送第一条测试消息。每个机器人独立保存模型、媒体和权限；人格文件仅支持 `schemaVersion: 4`。

## 文档

| 任务 | 文档 |
| --- | --- |
| 配置机器人、环境变量与工作区 | [配置参考](docs/configuration.md) |
| 诊断安装、连接和媒体故障 | [排障](docs/troubleshooting.md) |
| 配置 TTS、RVC 模型和音色 | [模型库](docs/voice-model-library.md) · [RVC 音色转换](docs/singing-conversion.md) |
| 接入音乐与了解 QQ 投递限制 | [音乐接入](docs/music-integration.md) · [QQ 媒体投递](docs/qq-media-delivery.md) |
| 开发、测试与架构 | [开发指南](docs/development.md) · [测试](docs/testing.md) · [架构](docs/architecture.md) · [依赖边界](docs/architecture-boundaries.md) · [ADR](docs/adr/) |
| 检查依赖与许可证 | [Python 依赖](docs/python-dependencies.md) · [依赖审计](docs/dependency-audit.md) · [第三方声明](THIRD_PARTY_NOTICES.md) |

## 开发与发布

实现位于 `src/`，媒体 worker 位于 `python/`，技能位于 `skills/`，辅助 bundle 位于 `packages/`；脚本与测试分别位于 `scripts/`、`tests/`。

`npm run verify:release` 执行发布门禁。`npm run release:pack` 生成临时归档、检查包内容并在结束时清理归档。开发准备和按变更选择验证的方式见[开发指南](docs/development.md)。

贡献请读 [CONTRIBUTING.md](CONTRIBUTING.md)；使用问题见 [SUPPORT.md](SUPPORT.md)，安全报告见 [SECURITY.md](SECURITY.md)，协作规则见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 与 [AGENTS.md](https://github.com/Helloworld2345567/dsh-plugin-integration-qq-wechat-bot/blob/main/AGENTS.md)。版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT](LICENSE)。外部服务、模型和第三方依赖遵守各自许可证，见[第三方声明](THIRD_PARTY_NOTICES.md)。
