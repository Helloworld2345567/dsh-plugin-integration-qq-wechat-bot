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
- `dsh-bot-lifecycle` 是独立 bundle，不是主插件内部服务；`installation.json` 保持既有 schema，`lifecycle-installation.json` 另行记录 current/previous 主包与 coordinator 的 archive hash、identity、package version 和 contract。

### 只替换主包

只有当前 coordinator 明确接受 candidate 的 runtime protocol、主包 package version 和 capabilities，且 candidate 明确接受当前 coordinator API/capabilities 时，才允许受管热更新。coordinator 会先校验 candidate/previous hash 和 contract，再排空任务；激活失败仍只恢复 previous 主包一次，不重放 unknown 外部结果。

### 离线更新两个 bundle

protocol major、coordinator API、双方 package range 或 required capability 需要变化时，旧 coordinator 不会尝试热替换自己。按以下顺序操作：

```powershell
node scripts/stop.mjs
node scripts/install.mjs <package-directory-or-tgz>
node scripts/start.mjs --port 3080
```

安装器在修改 profile 前验证双包兼容并要求 launcher 已停止；installer 与 launcher 通过产品级排他锁互斥。然后离线安装 coordinator 与主包，记录安全 journal，再核对两份 hash、identity、版本和 contract。中途失败只尝试一次 previous 主包→previous coordinator 恢复；强杀后须先重跑 installer 收敛非终态 journal。旧归档 hash 不匹配时保持停机，不能删除 journal、猜测版本或只手工替换其中一个。锁文件的人工归档条件见[排障文档](troubleshooting.md#11-安装后升级或回滚失败)。

### 不兼容恢复

遇到 `LIFECYCLE_*` 错误时：保持 profile 停止；保留 `installation.json`、`lifecycle-installation.json`、`lifecycle-installations/`、`evolution/` 和 package archives；从可信源码或已验证归档重新运行安装器；只有启动检查通过后再启动 launcher。旧安装缺少 `lifecycle-installation.json` 不会静默迁移，必须走上述停机双包安装。

架构决策见 [ADR 0001](adr/0001-delivery-modes.md)、[ADR 0003](adr/0003-lifecycle-and-uncertain-outcomes.md)和 [ADR 0004](adr/0004-lifecycle-bundle-compatibility.md)。
