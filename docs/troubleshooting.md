# 运维排障

本页按相同结构收集可执行的安全排查步骤。所有命令都在项目根目录或产品运营者明确的工作目录执行；示例不包含平台凭据、用户/群 ID、签名 URL、数据库内容或本机绝对路径。收集证据前先停止正在运行的敏感任务，并只保留脱敏后的错误代码、版本和状态。

## 统一安全规则

- 不要在命令行、Issue、日志片段或截图中粘贴 QQ/微信 token、Cookie、Harness credentials、API key、用户/群 ID、消息正文、签名下载 URL、模型权重路径或本机绝对路径。
- 不要上传数据库、完整日志、运行时目录、附件、模型权重或未脱敏的平台响应。
- `health`/`probe` 只说明可探测或协议可用，不代表真实平台发送、完整下载、TTS、RVC 或 GPT-SoVITS 音色已经验收。
- `pending`/`registered` 是等待投递；`failed` 是已确认失败；`unknown` 是提交后结果无法确认。除平台回执外，不要声称用户已收到。

## 1. 插件未出现在 Harness 设置中

**症状**：设置中没有“机器人面板”，或启动日志没有加载主 bundle。

**安全检查**：确认使用的是预期的 Harness profile，Harness 版本为 `0.2.1-rc.5`，并且当前进程已经停止后再重新安装；不要通过日志分享 profile 目录或 credentials 内容。

**可能原因**：没有执行 Plugin Manager 安装、安装到另一个 profile、构建/发布门禁失败、主 bundle 未被 profile 的 bundle 列表加载，或运行时版本不兼容。

**修复动作**：已有 Harness 按顺序执行 `npm ci`、`npm run build`、`npm run verify:release`，然后 `dsh plugin --profile <profile> add .` 并重启 Harness。独立产品不要执行该命令替代产品安装器，改用 `node scripts/install.mjs .` 和 `node scripts/start.mjs`。不要手工改 profile manifest。

**仍失败时的脱敏证据**：Harness 版本、Node/Python 版本、`npm run verify:release` 的失败阶段、安装路径类型（源码目录或固定归档）和脱敏错误代码。

**不应提供**：profile 目录、凭据、启动 token、用户数据、完整日志或签名归档 URL。

## 2. Host row inactive 或 profile 未激活

**症状**：插件已安装但 Host row 显示 inactive，或管理面板没有可用的 profile。

**安全检查**：确认启动的是安装目标 profile，而不是另一个 Harness 实例；确认 profile 仍满足 `engines.dsh`，且产品 `bots` profile 没有被手工删除/覆盖。

**可能原因**：profile 未激活、主 bundle 被禁用、`dsh-bot-lifecycle` 与主 bundle 的版本/实例握手不一致，或已有 Harness 模式被误当成独立产品模式。

**修复动作**：已有 Harness 重新使用对应 `--profile <profile>` 启动并在设置确认加载；独立产品先 `node scripts/stop.mjs`，再使用同一 `BOT_HOME` 执行 `node scripts/start.mjs`。不要将 lifecycle bundle 单独当作第三方 runtime 安装。

**仍失败时的脱敏证据**：profile 名称可用占位符表示、Host row 状态、Harness 版本、bundle 名称和 lifecycle handshake 是否可用。

**不应提供**：真实 profile 路径、IPC nonce、凭据或整段启动日志。

## 3. QQ 授权失败或事件权限不足

**症状**：QQ 扫码/授权失败、连接后收不到事件，或发送返回平台权限/限流错误。

**安全检查**：在 QQ 运营者控制台确认应用、机器人账号、事件订阅和消息权限；确认授权针对当前 bot 和目标会话，不要在 Issue 中填写 QQ 号或群号。

**可能原因**：平台授权未完成、事件订阅未开启、账号状态/权限不足、平台限流或平台侧暂时不可用。插件不能替运营者完成平台审核和权限开通。

**修复动作**：重新从 bot 卡片发起授权，等待平台确认后重新连接；只在平台控制台调整必要的事件权限。先发送纯文本测试，再验证媒体。不要重复发送无法确认状态的附件；先查看投递记录。

**仍失败时的脱敏证据**：平台（QQ）、授权步骤的脱敏阶段、时间范围、脱敏错误码、事件类型和 Harness/插件版本。

**不应提供**：QQ token、Cookie、openid、群号、消息内容、签名 URL 或完整平台响应。

## 4. 微信 iLink 登录、轮询或媒体限制

**症状**：微信 iLink 登录二维码过期、轮询一直 pending、连接断开，或媒体发送被拒绝。

**安全检查**：确认手机端授权仍有效、网络可访问 iLink 服务，并确认附件符合微信当前渠道限制；不要把二维码、票据或 CDN 地址截图上传。

**可能原因**：登录票据过期、轮询上下文失效、微信平台会话/媒体格式限制、平台限流或外部服务异常。

**修复动作**：在面板取消旧登录并重新发起授权；连接确认后先发送中文文本，再发送小型可播放音频或普通文件。失败附件可按提示重新登记，不能把平台上传签名复制到新请求。微信普通附件限制与 QQ 分片策略不同，不能套用 QQ 上限。

**仍失败时的脱敏证据**：iLink 阶段（扫码、轮询、确认、发送）、脱敏错误分类、媒体类型/大小区间、版本和时间范围。

**不应提供**：二维码、登录票据、微信用户 ID、CDN 签名 URL、Cookie、真实消息或附件。

## 5. Python worker 启动失败

**症状**：媒体任务报 worker 启动失败、协议不支持或 Python 退出。

**安全检查**：执行 `python --version`，确认是 Python 3.12 或 3.13；确认基础依赖按 `requirements.txt` 安装，`BOT_PYTHON` 指向同一解释器；不要分享解释器的本机路径。

**可能原因**：Python 版本不兼容、依赖未安装、worker 工作目录不可写、`BOT_PYTHON` 指向不存在的解释器、子进程环境缺少依赖，或 worker 协议版本不匹配。

**修复动作**：停止相关 Harness，使用目标解释器执行 `python -m pip install -r requirements.txt`；独立产品重新执行 `node scripts/install.mjs .` 让安装器重建/检查媒体环境；确认工作区可写后重启。不要将密钥放入 worker 命令行。

**仍失败时的脱敏证据**：Python 主次版本、缺失包名、worker 错误代码、`npm run check:python-dependencies` 结果和运行模式（已有 Harness/独立 profile）。

**不应提供**：绝对路径、完整环境变量转储、凭据、模型文件或完整 worker 日志。

## 6. FFmpeg/ffprobe 缺失

**症状**：音视频转码、探测或 QQ 音频准备失败，提示找不到 `ffmpeg` 或 `ffprobe`。

**安全检查**：在 PowerShell 执行 `Get-Command ffmpeg` 和 `Get-Command ffprobe`，再执行各自的 `-version`；确认命令来自运营者批准的安装来源。

**可能原因**：未安装、没有加入当前进程 PATH、`ffmpeg` 与 `ffprobe` 版本/架构不匹配，或进程启动前 PATH 未刷新。

**修复动作**：安装 Windows 发行版的 ffmpeg，确保两个命令都能在启动 Harness 的同一 PowerShell 中调用；关闭并重启 Harness/独立产品。不要把二进制、下载签名 URL 或机器路径提交到项目。

**仍失败时的脱敏证据**：两个命令是否可发现、版本首行、平台和失败操作类型。

**不应提供**：完整 PATH、本机安装路径、签名下载地址或运行时日志全文。

## 7. 图片服务配置失败

**症状**：图片状态显示未配置、缺少 provider key、端点无效或生成失败。

**安全检查**：确认服务地址是无凭据、无查询、无片段的 HTTPS 地址；确认 `BOT_IMAGE_KEY_ENV` 只是变量名，实际密钥已由安全环境注入；不要在面板、Prompt 或 Issue 中测试密钥值。

**可能原因**：密钥变量名拼写错误、后台进程未重启、人格 V4 override 覆盖了预期环境值、provider 不支持所选模型，或外部图片服务不可用。

**修复动作**：检查“图片 → 配置”中的地址、模型和密钥变量名，保存后从下一轮生效；重启进程以重新读取环境；确认 provider 允许该模型，再做一次单张测试。默认值是 `https://api.openai.com/v1` 和 `gpt-image-2`，但不代表第三方 provider 一定支持。

**仍失败时的脱敏证据**：配置字段是否存在、模型名、端点域名是否为 HTTPS、状态分类和 HTTP 状态类别；不要提供 URL 查询参数。

**不应提供**：API key、Authorization header、完整请求/响应、签名 URL、用户 Prompt 或本机输出路径。

## 8. voice-generation 未安装

**症状**：启用语音输出后显示缺少依赖或 Edge TTS worker 失败。

**安全检查**：确认基础依赖和可选依赖分别安装，不要把 voice-generation 误认为 GPT-SoVITS 或 RVC。

**可能原因**：没有安装 `requirements-voice-generation.txt`、独立安装时未选择 `voice-generation` 层、Python 解释器不是安装依赖的解释器，或外部网络服务不可用。

**修复动作**：停止进程后，在实际 `BOT_PYTHON` 对应解释器中执行 `python -m pip install -r requirements-voice-generation.txt`；独立产品可执行 `node scripts/install.mjs . --layers=core,basic-media,voice-generation`，再重启。Edge TTS 不要求运营者提供 API key；GPT-SoVITS 是另一条外部 Profile 路径。

**仍失败时的脱敏证据**：Python 版本、`edge-tts` 是否安装、安装层列表、语音协议（Edge TTS 或 GPT-SoVITS）和脱敏错误码。

**不应提供**：凭据、参考音频、模型权重、服务地址中的授权参数或完整音频。

## 9. RVC、Music、GPT-SoVITS 显示 missing 或 blocked

**症状**：能力目录显示 `missing`/`blocked`，模型库没有可用 profile，或 health 通过但实际输出失败。

**安全检查**：确认这是可选外部能力，不是基础安装失败；检查模型/服务是否由运营者单独部署，并确认人格 V4 只保存 `profileRef` 和业务偏好，不保存端点、路径或权重。

**可能原因**：没有登记 Service Profile、模型根目录/外部项目不完整、依赖或服务不可探测、模型说明不唯一、权重/参考音频缺失，或该 profile 尚未进行真实输出验收。

**修复动作**：在“连接/模型库”登记运营者管理的外部环境，刷新并查看安全诊断；补齐资源后重新扫描，再对当前人格 revision 和 profile revision 做真实验收。不要把路径写进人格或尝试静默切换到另一个模型。缺少能力时保持 `missing`/`blocked` 是预期的 fail-closed 行为。

**仍失败时的脱敏证据**：能力状态、profile revision/content hash 的存在性、诊断分类、模型版本和 health/真实验收是否分别通过。

**不应提供**：权重文件、模型绝对路径、服务密钥、外部 Music/QQ/微信 Cookie 或完整推理日志。

## 10. 消息发送 pending、failed 或 unknown

**症状**：附件或文本长时间 pending，显示 failed，或提交后显示 unknown。

**安全检查**：先确认机器人仍连接、会话身份未切换、权限未撤销和附件仍属于当前会话；不要盲目重复发送。

**可能原因**：pending 仍在本地投递队列；failed 是准备/上传等阶段明确失败；unknown 是提交后网络中断，平台是否接受无法确认；平台回执、限流或媒体格式也可能导致失败。

**修复动作**：查看面板投递记录的状态、脱敏 cause code 和平台状态；对 `unknown` 优先使用现有记录的恢复入口，不自动重跑 TTS/RVC/Music；只有用户明确要求重新发送时才创建 resend 意图。暂停/停止期间等待任务排空，再按当前渠道限制重试。

**仍失败时的脱敏证据**：delivery state、阶段（prepare/upload/commit）、cause code、HTTP 状态类别、媒体类型/大小区间和是否有平台回执。

**不应提供**：上传签名 URL、file_info、平台 trace 中的用户信息、附件内容、凭据或完整响应。

## 11. 安装后升级或回滚失败

**症状**：升级后无法健康启动、任务停留在 restarting/rolling-back，或回滚被拒绝。

**安全检查**：确认只在独立产品 profile 使用项目 lifecycle；确认 `BOT_HOME` 未变化、上一对主包/coordinator 归档仍存在且 SHA-256 匹配；不要删除 `installation.json`、`lifecycle-installation.json`、`lifecycle-installations/`、evolution journal 或旧归档来“清理”状态。

**可能原因**：新归档未通过安全检查/哈希验证；runtime protocol、coordinator API、package range 或 capability 不兼容；identity/version 与安装记录不一致；启动健康检查超时；上一归档被改动；或已有 Harness 模式本来就没有独立协调器。

**修复动作**：先区分失败路径。兼容的主包受管升级在健康启动失败时最多自动恢复一次上一份 hash 仍匹配的主包归档；无法确认的外部投递不因升级而重放。需要新 coordinator 或缺少 `lifecycle-installation.json` 时保持停止，执行 `stop → install.mjs <package-directory-or-tgz> → start`。离线安装器会预检并记录双包 journal；中途失败只尝试一次 previous main→previous coordinator 恢复。若报告 previous hash/identity 不匹配，不要启动或手工混装，改用可信、匹配的双包归档重跑安装器。若进程被强杀后报告 `LIFECYCLE_OPERATION_STALE`，先从操作系统确认记录的 PID 已不存在，再把 `BOT_HOME/lifecycle-operation.lock` **移动并归档**（不要直接覆盖或在进程仍存活时删除），随后先重跑 installer 让未完成 journal 收敛，再启动。已完成的兼容主包升级可由可信管理员使用 `/evolve rollback <task-id>` 排队回滚。始终保留当前数据和 journal，不要直接替换 live `node_modules`。

**仍失败时的脱敏证据**：任务 ID 可截断/替换、phase、安装归档 SHA-256（可只给前后若干字符）、Harness 版本、健康检查阶段和脱敏错误代码。

**不应提供**：归档下载签名 URL、完整 journal、产品目录、数据库、凭据或完整日志。

## 12. 收集脱敏诊断信息

**症状**：需要提交 Issue、Discussion 或维护者请求的安装/运行诊断。

**安全检查**：先复制到临时脱敏文件，搜索并删除 token、key、cookie、password、authorization、用户/群 ID、二维码、URL 查询参数、本机路径、数据库内容和模型权重信息。

**可能原因**：原始日志通常同时包含 profile 路径、平台状态、消息片段和服务端返回，直接上传会扩大泄露范围。

**修复动作**：提供以下最小集合：插件版本/提交、Node/Python/FFmpeg 版本首行、Harness 版本、安装模式（已有 profile/独立产品）、执行过的命令名称、失败阶段、脱敏错误代码、能力状态（`missing`/`blocked`/`ready`）和是否运行了 `npm run verify:release`。平台问题只说明平台类型和事件类别。对照 [SUPPORT.md](../SUPPORT.md) 和 [SECURITY.md](../SECURITY.md) 选择公开 Issue 或私有漏洞报告。

**仍失败时的脱敏证据**：一小段只含错误分类和必要上下文的日志，所有路径替换为 `<path>`、身份替换为 `<id>`、密钥替换为 `<redacted>`，并注明未上传原始附件/数据库。

**不应提供**：日志全文、环境变量转储、QQ/微信授权材料、Harness credentials、API key、Cookie、用户/群 ID、消息正文、签名 URL、数据库、模型权重或完整音频/视频。
