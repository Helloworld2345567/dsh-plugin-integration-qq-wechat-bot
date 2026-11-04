# 安装到已有 DeepSeek Harness

统一前置检查、首次验证和能力边界见[快速开始](getting-started.md)；变量说明见[配置参考](configuration.md)，失败处理见[排障文档](troubleshooting.md)。

本方式适合已经维护 Harness profile、希望把 QQ／微信机器人能力加入该 profile 的用户。它只安装主 bundle，不接管现有 profile，也不安装独立生命周期协调器。

> 当前项目的文档和管理界面仅提供简体中文，当前版本不承诺英文 UI。

## 前置条件

- Windows 10/11、PowerShell 7
- Node.js 24+
- Python 3.12 或 3.13
- DeepSeek Harness 0.2.1-rc.2
- `ffmpeg` 与 `ffprobe`
- 一个可以停止并重新启动的 Harness profile
- 基础安装不要求 CUDA、RVC、GPT-SoVITS、Music 或模型权重

## 从源码安装

```powershell
npm ci
python -m pip install -r requirements.txt
npm run build
npm run verify:release

dsh plugin --profile <profile> add .
dsh --profile <profile> --no-open
```

将 `<profile>` 替换为已有 profile 名称。安装前应停止正在使用该 profile 的 Harness；安装完成后重新启动它。不要手工编辑 profile 的 `package.json` 或复制 `cordis.patch.yml`。

如果媒体 worker 使用的不是命令行中的 `python`，请在启动 Harness 前设置 `BOT_PYTHON` 为已安装依赖的 Python 3.12/3.13 解释器。Edge TTS 还需要安装：

```powershell
python -m pip install -r requirements-voice-generation.txt
```

## 验证

1. 打开 Harness 设置。
2. 确认侧栏出现“机器人面板”。
3. 在 Harness 模型设置中配置聊天模型和凭据。
4. 在机器人面板创建人格和机器人，完成 QQ 或微信授权。
5. 启动机器人并发送一条测试消息。

若插件没有显示，先检查 profile 是否加载了 `dsh-plugin-integration-qq-wechat-bot`，以及 Harness 版本是否为 `0.2.1-rc.2`。

## 能力边界

本方式不会创建项目专属的 `bots` profile，也不会安装 `dsh-bot-lifecycle`。主插件可以正常运行，但项目提供的版本握手、受管热升级、监督重启、离线双包 journal 和自动回滚只属于[独立产品 profile 部署](deploy-product-profile.md)。已有 Harness 的运营者必须按该 profile 自己的停机／升级流程替换主包；不要从独立产品路径复制 coordinator，也不承诺未声明的跨版本组合兼容。

GPT-SoVITS、Music、RVC、CUDA、模型权重和第三方外部项目不会随主插件安装。未登记的能力显示为 `missing` 或 `blocked`，不会静默切换到其他服务。
