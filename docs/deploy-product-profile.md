# 部署独立机器人产品 profile

统一前置检查、首次验证和能力边界见[快速开始](getting-started.md)；变量说明见[配置参考](configuration.md)，失败处理见[排障文档](troubleshooting.md)。

本方式适合希望由项目创建并管理隔离 `bots` profile 的运营者。安装器会创建产品数据目录、媒体 Python 环境、独立工作区、主 bundle 和生命周期协调 bundle；不会修改其他 Harness profile。

> 当前项目的文档和管理界面仅提供简体中文，当前版本不承诺英文 UI。

## 前置条件

- Windows 10/11、PowerShell 7
- Node.js 24+
- Python 3.12 或 3.13
- DeepSeek Harness 0.2.1-rc.2
- `ffmpeg` 与 `ffprobe`
- 基础安装不要求 CUDA、RVC、GPT-SoVITS、Music 或模型权重
- 可选：`uv`，未安装时回退到 Python `venv` 和 `pip`

## 本地源码部署

```powershell
npm ci
npm run verify:release
node scripts/install.mjs .
node scripts/start.mjs --port 3080
```

默认产品数据位于 `.runtime/bot-data`，机器人工作区位于 `.runtime/workspaces`。生产部署应在安装前明确设置：

```powershell
$env:BOT_HOME = '<BOT_HOME>'
$env:BOT_WORKSPACE_ROOT = '<BOT_WORKSPACE_ROOT>'
node scripts/install.mjs .
node scripts/start.mjs --port 3080
```

停止受监督实例：

```powershell
node scripts/stop.mjs
```

安装器默认安装 `core,basic-media`，不会安装 CUDA、GPT-SoVITS、Music、RVC 外部项目或模型权重。可选 Edge TTS 层示例：

```powershell
node scripts/install.mjs . --layers=core,basic-media,voice-generation
```

可用层为 `core`、`basic-media`、`voice-generation`、`music`、`singing-rvc`；`core` 和 `basic-media` 必须存在。可选层只安装本项目声明的配套依赖，外部服务仍由运营者单独部署和验收。

## 固定 GitHub Release 部署

正式远程安装必须同时固定仓库、semver release tag、`.tgz` 资源名和预期 SHA-256：

```powershell
node scripts/bootstrap-github.mjs `
  --repository=OWNER/REPO `
  --ref=v1.2.3 `
  --asset=PACKAGE.tgz `
  --sha256=64位小写十六进制摘要 `
  --home=<BOT_HOME>
```

Bootstrap 只允许 HTTPS GitHub 地址，逐跳验证重定向和 DNS，并在 hash 与 tar 安全检查通过后调用安装器。失败时只使用上一份 hash 仍匹配的归档回滚。

## 验证

1. 启动后打开命令输出中的 Harness URL。
2. 在设置中打开“机器人面板”。
3. 配置聊天模型、人格和渠道授权。
4. 确认核心聊天可用。
5. 对 GPT-SoVITS、完整音乐下载和 RVC 分别执行真实输出验收。

Profile health 只代表当前可探测，不等于真实媒体结果已经通过。验收记录绑定人格 revision 和 Profile revision。

## 数据与升级

- 人格与产品状态保存在 `BOT_HOME`。
- 会话、附件索引、引擎缓存和默认机器人工作区位于 `BOT_WORKSPACE_ROOT`。
- 凭据由 Harness credentials 服务管理，不写入发布文件。
- 受管升级由独立 `dsh-bot-lifecycle` bundle 排空任务、安装已验证归档并在失败时尝试一次回滚。

架构决策见 [ADR 0001](adr/0001-delivery-modes.md)和 [ADR 0003](adr/0003-lifecycle-and-uncertain-outcomes.md)。
