# 快速开始

简体中文 | [English](../en/getting-started.md)

## 前置条件

Windows 10/11 使用 PowerShell 7，并准备：

- Node.js 24+、Python 3.12 或 3.13、DeepSeek Harness `0.2.1-rc.5`；
- 音视频工具 `ffmpeg`、`ffprobe`；
- 可访问的 npm registry，以及用于 QQ/微信授权的账号。

确认命令可用；版本不符合或命令不存在时，先安装对应依赖：

```powershell
node --version
python --version
ffmpeg -version
ffprobe -version
```

基础安装不要求 CUDA、GPT-SoVITS、Music、RVC 或模型权重。基础 Python 依赖见 `requirements.txt`，Edge TTS 的可选依赖见 `requirements-voice-generation.txt`；外部服务与模型单独部署。

## 选择安装方式

| 方式 | 管理范围 | 安装步骤 |
| --- | --- | --- |
| 已有 Harness profile | 只添加主插件，由你管理原 profile 的启停与更新 | [已有 Harness 安装指南](install-existing-harness.md) |
| 独立机器人产品 | 创建隔离的 `bots` profile、数据和工作区，成对安装主插件与 `dsh-bot-lifecycle`，提供监督启动与升级恢复 | [独立产品部署指南](deploy-product-profile.md) |

按所选指南在项目根目录执行命令。升级、回滚和卸载也遵循同一指南，勿把独立产品的协调器复制到已有 Harness profile。

## 首次配置与验证

1. 打开 Harness 设置中的“机器人面板”。若没有出现，检查实际启动的 profile、Harness 版本和已安装 bundle；独立产品应同时加载主插件与 `dsh-bot-lifecycle`。
2. 在 Harness 模型设置中配置聊天模型和凭据。QQ/微信账号凭据同样由 Harness credentials 服务保存，不写入人格或发布文件。
3. 创建人格，填写名称和人设；当前使用 `schemaVersion: 4`。
4. 创建机器人，选择渠道和人格，配置模型、回复行为与媒体，完成 QQ/微信授权。每个机器人独立保存运行设置，修改从下一轮生效。
5. 启动机器人，在已授权的私聊发送普通文本。文本正常后，再逐项验证所需媒体能力。
6. 查看投递记录：`pending`/`registered` 只是等待处理，`failed` 表示已确认失败，`unknown` 表示提交后无法确认结果；以平台回执确认送达。

管理界面跟随 Harness 语言；“服务”页可独立选择所有机器人的固定提示语言。完整设置见[配置参考](configuration.md)。

## 接入可选能力

- 安装或使用异常：[排障](troubleshooting.md)。

未登记或不可用的能力显示为 `missing` 或 `blocked`，不会静默换用其他服务。Health 和自动测试不能替代真实平台投递、完整媒体输出及音色试听；平台授权、额度和外部服务可用性由运营者分别确认。
