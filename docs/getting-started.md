# 快速开始

本页是本项目的可执行安装入口。项目当前只提供简体中文文档和管理界面；不承诺英文 UI、第三方 Adapter ABI 或外部平台/外部服务验收。

## 前置条件

适用于 Windows 10/11 和 PowerShell 7：

- Node.js 24 或更高版本；
- Python 3.12 或 3.13；
- DeepSeek Harness `0.2.1-rc.5`；
- 可从 PowerShell 直接调用的 `ffmpeg` 和 `ffprobe`；
- 可访问项目所需的 npm registry。`package-lock.json` 使用 npm 公共 registry 的完整性校验。

基础安装只安装项目声明的 Node/Python 基础依赖，不要求 CUDA、RVC、GPT-SoVITS、Music 或任何模型权重。Edge TTS、Music、RVC 和 GPT-SoVITS 是可选层或外部服务，按能力边界单独配置。

先确认版本和工具：

```powershell
node --version
python --version
ffmpeg -version
ffprobe -version
```

Python 基础依赖来自 `requirements.txt`；需要内置 Edge TTS 时再安装 `requirements-voice-generation.txt`。不要把 QQ/微信凭据、Harness credentials、服务密钥或模型文件复制到项目目录。

## 选择安装路径

两条路径共享主插件代码，但职责不同：

| 路径 | 适用对象 | 会修改什么 | 生命周期能力 |
| --- | --- | --- | --- |
| [安装到已有 Harness](install-existing-harness.md) | 已经维护 Harness profile 的用户 | 只向指定 profile 添加主 bundle | 不安装项目生命周期协调器 |
| [部署独立机器人产品 profile](deploy-product-profile.md) | 需要隔离数据、工作区和受监督进程的运营者 | 创建/维护项目自己的 `bots` profile、数据和工作区 | 同时安装 `dsh-bot-lifecycle`，负责排空、监督重启、升级和一次回滚 |

不要把两条路径混用：已有 Harness 路径不会接管 profile；独立产品路径不会修改其他 profile。

## A. 安装到已有 Harness profile

在本项目根目录 PowerShell 中执行：

```powershell
npm ci
python -m pip install -r requirements.txt
npm run build
npm run verify:release
dsh plugin --profile <profile> add .
```

将 `<profile>` 替换为已经存在的 Harness profile 名称。安装前停止正在使用该 profile 的 Harness；`add .` 完成后重启 Harness。不要手工编辑 profile 的 `package.json` 或复制 `cordis.patch.yml`。

基础媒体 worker 默认使用 `python`；如果使用其他 Python 3.12/3.13 解释器，在启动 Harness 前设置 `BOT_PYTHON`。需要 Edge TTS 时，另外执行：

```powershell
python -m pip install -r requirements-voice-generation.txt
```

安装完成后打开 Harness 设置，确认出现“机器人面板”。这一模式不创建项目专属 `bots` profile，也不提供项目的受管升级、监督重启和自动回滚。

## B. 部署独立机器人产品 profile

该路径必须使用仓库已有脚本，不要自行拼接 Harness profile 文件：

```powershell
npm ci
python -m pip install -r requirements.txt
npm run verify:release
node scripts/install.mjs .
node scripts/start.mjs --port 3080
```

生产环境应在安装前设置产品数据和工作区目录；使用安全占位符替换下面的值，不要把真实路径提交到仓库：

```powershell
$env:BOT_HOME = '<absolute-product-home>'
$env:BOT_WORKSPACE_ROOT = '<absolute-workspace-root>'
node scripts/install.mjs .
node scripts/start.mjs --port 3080
```

安装器默认创建 `bots` profile、媒体 Python 环境并安装 `requirements.txt`、共享工作区存储、主 bundle 和 `dsh-bot-lifecycle`。默认层是 `core,basic-media`；可选 `voice-generation` 层只安装本项目声明的 Edge TTS 依赖，外部 Music、RVC、GPT-SoVITS 和模型仍须运营者自行部署和验收。可选层由现有 `--layers=` 参数或 `BOT_INSTALL_LAYERS` 控制，必须包含 `core,basic-media`。

启动器通过本机受认证的控制端点管理停止，通过 IPC nonce 接收生命周期信号。停止独立产品实例：

```powershell
node scripts/stop.mjs
```

独立产品的升级、回滚和数据责任由生命周期协调器与运营者共同承担。安装本地源码或本地 `.tgz` 时，安装器检查归档结构并计算/记录当前 SHA-256 和安装后包身份；这不等同于验证下载来源。固定 GitHub Release 安装必须由运营者提供预期 SHA-256，bootstrap 比较成功后才安装。journal 驱动的受管升级会重新校验已记录的归档 hash；健康启动失败时最多自动恢复一次上一份仍匹配的归档。升级前仍应保留 `BOT_HOME`/工作区备份。成功升级后，可信管理员可通过 `/evolve rollback <task-id>` 并提供历史任务 ID 排队回滚；回滚保留人格、会话、附件和凭据，不重放未知的外部投递。详见 [lifecycle bundle 说明](../packages/bot-lifecycle/README.md) 和 [ADR 0003](adr/0003-lifecycle-and-uncertain-outcomes.md)。

项目没有独立的“卸载”命令。卸载独立产品时先执行 `node scripts/stop.mjs`，备份需要保留的数据，再由运营者按自己的备份和保留策略移除产品 profile、`BOT_HOME` 和工作区；删除这些目录会删除其中的运行数据。已有 Harness profile 的移除必须使用该 Harness 版本提供的 Plugin Manager/设置页面移除动作，不要手工删除依赖或 profile 文件。

## 首次验证路径

按以下顺序验证，遇到问题先看[排障文档](troubleshooting.md)：

1. **确认插件加载**：在 Harness 设置中看到“机器人面板”；独立产品确认 `bots` profile 同时加载 `dsh-bot-lifecycle` 和主 bundle。受监督重启是否可用，以安装 smoke 或实际 restart journal 的结果为准。若没有加载，检查当前实际启动的 profile、Harness 版本和已安装 bundle 身份。
2. **配置模型和 credentials**：在 Harness 模型设置中配置聊天模型和凭据。媒体分析复用该 provider 的受管 credentials；不要把密钥写入人格、命令参数或 `.env.example`。
3. **创建人格**：在机器人面板创建人格，填写人格提示词，选择模型、工具和技能。当前人格文件只接受 `schemaVersion: 4`；旧 V3 及更早格式不读取、不迁移、不回退。
4. **创建 bot**：创建 bot，选择 QQ 或微信渠道和对应账号，绑定人格。人格和 bot 的保存会形成 revision；修改通常从下一轮生效。
5. **完成 QQ/微信授权**：在 bot 卡片启动对应授权流程。QQ/微信平台授权、事件权限、账号状态和平台限流由运营者自行完成；凭据只进入 Harness credentials 服务。
6. **发送第一条测试消息**：确认 bot 已连接后，在已授权的 QQ 私聊或微信会话发送一条普通中文测试消息。先验证文本，再分别验证需要的媒体能力。
7. **确认投递状态**：`pending`/`registered` 只表示等待队列，`failed` 表示已确认失败，`unknown` 表示提交后结果无法确认；只有平台回执才是送达证据。

## 能力边界

- QQ/微信平台授权和运营者账号准备不随主包完成；
- 外部 TTS、Music、RVC、GPT-SoVITS、CUDA、服务端和模型权重不随主包安装；
- 未登记或不可用的能力明确显示为 `missing` 或 `blocked`，不会静默换用其他服务；
- 当前不承诺英文 UI；
- 当前不承诺第三方 Adapter ABI；
- 项目测试和 health 只证明代码、协议或可探测性，不等于外部平台、外部服务或真实角色效果验收；
- 配置参考、环境变量来源和重启边界见[配置参考](configuration.md)。
