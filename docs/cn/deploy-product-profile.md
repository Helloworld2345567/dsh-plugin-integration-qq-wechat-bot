# 部署独立机器人产品 profile

简体中文 | [English](../en/deploy-product-profile.md)

安装器创建隔离的 `bots` profile、产品数据、媒体 Python 环境和工作区，并成对安装主插件与 `dsh-bot-lifecycle`。其他 Harness profile 不受影响。环境要求与首次配置见[快速开始](getting-started.md)，变量见[配置参考](configuration.md)。

## 从源码安装与启停

在项目根目录执行。生产部署先将以下占位符替换为绝对路径；开发时可省略两项变量，默认使用 `.runtime/bot-data` 与 `.runtime/workspaces`：

```powershell
$env:BOT_HOME = '<absolute-product-home>'
$env:BOT_WORKSPACE_ROOT = '<absolute-workspace-root>'
npm ci
python -m pip install -r requirements.txt
npm run verify:release
node scripts/install.mjs .
node scripts/start.mjs --port 3080
```

前面的 Python 依赖用于源码验证。安装器另行建立媒体环境并安装基础依赖；可用时使用 `uv`，否则使用 Python `venv`/`pip`。设置了 `BOT_PYTHON` 时使用指定解释器。

打开启动输出中的 Harness URL，按[首次配置与验证](getting-started.md)接入机器人。停止受监督实例：

```powershell
node scripts/stop.mjs
```

安装、启动、停止和后续更新须使用同一 `BOT_HOME`；在新终端中重新设置环境变量。

### 可选依赖

默认层为 `core,basic-media`。需要 Edge TTS 时，把安装命令改为：

```powershell
node scripts/install.mjs . --layers=core,basic-media,voice-generation
```

也可通过 `BOT_INSTALL_LAYERS` 设置。可用层包括 `core`、`basic-media`、`voice-generation`、`music`、`singing-rvc`，前两项必需；可选层只安装本项目声明的依赖，外部服务、CUDA 与模型仍需单独部署。

### 单独控制机器人服务

在主插件配置中设置 `autoStart: false`，可加载面板、配置和历史而不自动连接渠道或执行后台任务。面板工具栏的“开启/停止机器人服务”保留各机器人的启用偏好；卡片的“运行”开关控制单个机器人。保持同一 profile 和唯一的 Harness 进程，外部 TTS/RVC 等服务使用各自的启停入口。

## 固定 GitHub Release 安装

固定仓库、semver tag、`.tgz` 资源名与预期 SHA-256 后执行：

```powershell
node scripts/bootstrap-github.mjs `
  --repository=OWNER/REPO `
  --ref=v1.2.3 `
  --asset=PACKAGE.tgz `
  '--sha256=<64-lowercase-hex-digest>' `
  '--home=<absolute-product-home>'
```

替换所有示例值。Bootstrap 验证 GitHub HTTPS 下载、预期 hash 和归档结构后才安装。本地源码/归档安装记录当前 hash 与包身份，但这不等于验证下载来源。

## 更新与恢复

更新前备份 `BOT_HOME` 和 `BOT_WORKSPACE_ROOT`：前者保存人格与产品状态，后者保存会话、附件索引、引擎缓存和工作区；凭据由 Harness credentials 服务管理。

当前 coordinator 与候选主包双向兼容时，可排空任务后只热更新主包。激活失败最多恢复上一份仍通过校验的主包一次。成功升级后，可信管理员可用 `/evolve rollback <task-id>` 指定历史任务回滚；不会重放结果未知的外部投递。

需要更新 coordinator、协议主版本或不兼容能力时，停机更新两个 bundle。将路径替换为可信包目录或归档：

```powershell
node scripts/stop.mjs
node scripts/install.mjs '<package-directory-or-tgz>'
node scripts/start.mjs --port 3080
```

安装器验证双包兼容性、记录 journal，并与启动器互斥。中断后重跑安装器完成恢复；上一份归档校验失败时保持停机，不能删除 journal 或只手工替换其中一个 bundle。旧安装缺少 `lifecycle-installation.json` 时也须停机重装双包。

遇到 `LIFECYCLE_*` 错误，保留 `installation.json`、`lifecycle-installation.json`、`lifecycle-installations/`、`evolution/` 和包归档，从可信源码或已验证归档重跑安装器。锁文件与恢复操作见[升级/回滚排障](troubleshooting.md#11-安装后升级或回滚失败)；协议与数据保留约定见[lifecycle bundle](../../packages/bot-lifecycle/README.md)。

## 卸载

项目没有专用卸载命令。先执行 `node scripts/stop.mjs`，备份需要保留的数据，再按保留策略移除产品 profile、`BOT_HOME` 和工作区；删除目录会删除其中的运行数据。外部服务与模型按各自部署方式移除。
