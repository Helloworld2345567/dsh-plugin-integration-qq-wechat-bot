# 运维排障

简体中文 | [English](en/troubleshooting.md)

先确认安装方式、版本和失败阶段，再处理对应问题。公开求助只提供脱敏错误码、状态和必要版本；不要上传凭据、完整日志、数据库、附件、用户 ID、签名 URL 或本机路径。报告入口见[获取支持](../SUPPORT.md)。

## 1. 插件未出现在 Harness 设置中

确认 Harness 为 `0.2.1-rc.5`，正在使用安装时的 profile，主 bundle 未禁用。按[已有 Harness 安装](install-existing-harness.md)重新安装并重启；独立产品使用[产品安装器](deploy-product-profile.md)。构建或发布门禁失败时先修复失败阶段，不手工修改 profile manifest。

## 2. Host row inactive 或 profile 未激活

已有 Harness 使用对应 `--profile <profile>` 启动并确认 bundle 已加载。独立产品保持同一 `BOT_HOME`，执行 `node scripts/stop.mjs` 后再执行 `node scripts/start.mjs`；若报 lifecycle 握手错误，转到第 11 节。生命周期协调器仅由独立产品成对安装。

## 3. QQ 授权失败或事件权限不足

在 QQ 运营者控制台确认应用状态、事件订阅和消息权限，再从机器人卡片重新授权。插件不能代办平台审核。授权成功后先验证纯文本，再验证媒体；权限或限流错误按平台错误码处理。无法确认是否发送成功时先看投递记录，避免重复发送。

## 4. 微信 iLink 登录、轮询或媒体限制

二维码过期或轮询上下文失效时，在面板取消旧登录并重新授权。确认网络与手机授权有效；连接后先验证文本，再验证小型音频或普通文件。媒体失败按微信当前格式和大小限制处理，不能套用 QQ 分片上限或复制旧上传签名重试。

## 5. Python worker 启动失败

确认 `BOT_PYTHON` 指向实际安装依赖的 Python 3.12/3.13，工作区可写。使用同一解释器检查版本和安装基础依赖：

```powershell
python --version
python -m pip install -r requirements.txt
```

若设置了 `BOT_PYTHON`，以上 `python` 应换为该解释器。独立产品可在停止后重跑 `node scripts/install.mjs .` 修复媒体环境，再重启。仍失败时保留缺失包名、worker 错误码和退出阶段；协议不匹配应安装配套插件与 worker。

## 6. FFmpeg/ffprobe 缺失

在启动 Harness 的同一 PowerShell 中执行 `ffmpeg -version`、`ffprobe -version`。找不到命令时安装 FFmpeg 并将两者加入 PATH，然后重启 Harness/产品，让进程获得新 PATH。若仍失败，记录版本首行和具体失败操作。

## 7. 图片服务配置失败

在“服务”分别检查 OpenAI 或 Google Gemini 生图的地址、模型、密钥变量名，以及 ComfyUI 的地址和 API 工作流；再检查“机器人 → 媒体 → 图片”所选协议。地址、模型、协议和工作流不读取旧环境变量回退，配置规则见[配置参考](configuration.md)。

OpenAI 和 Google 地址要求 HTTPS，且不含凭据、查询或片段。后台进程必须读取到面板指定的密钥变量（默认分别为 `OPENAI_API_KEY` 和 `GEMINI_API_KEY`）；更改变量后重启。确认服务支持所选模型，再做一次单张测试；Google 默认模型为 `gemini-2.5-flash-image`。

ComfyUI 启动按钮从工作流目录向上查找同时包含 `scripts/start_comfyui.ps1` 和 `ComfyUI/main.py` 的项目；找不到时检查部署布局。面板使用 `--disable-dynamic-vram --disable-pinned-memory --cache-none` 启动，已有实例不会被替换。若发生 Windows 蓝屏，保留 BugCheck/Minidump 并检查内存和驱动，不要反复提交导致崩溃的工作流；这些参数不能保证消除系统故障。

## 8. voice-generation 未安装

Edge TTS 缺依赖时，在实际媒体解释器中执行 `python -m pip install -r requirements-voice-generation.txt`。独立产品停止后可执行 `node scripts/install.mjs . --layers=core,basic-media,voice-generation`，再重启。Edge TTS 不要求 API key，但依赖外部网络服务；GPT-SoVITS、Breeze 和 RVC 需要各自的外部环境。

## 9. RVC、Music、GPT-SoVITS 显示 missing 或 blocked

未部署可选服务时，`missing`/`blocked` 是预期状态。到“服务”检查外部项目、模型库及 Service Profile，补齐资源后刷新；再在机器人媒体设置中选择对应音色或能力。端点、模型路径和权重放在 Profile 私有配置，不能写入人格。

按[音色模型库](voice-model-library.md)、[音乐接入](music-integration.md)或[RVC 接入](singing-conversion.md)检查具体依赖。health/probe 成功只证明服务可探测或协议可用，仍需实际合成、下载或转换验证输出。

## 10. 消息发送 pending、failed 或 unknown

| 状态 | 含义与处理 |
| --- | --- |
| `pending` / `registered` | 等待投递；检查机器人连接、队列、当前身份和权限 |
| `failed` | 已确认失败；按 prepare/upload/commit 阶段、错误码和平台限制修复 |
| `unknown` | 已提交但无法确认平台是否接受；使用现有记录的恢复入口，不自动重跑 TTS/RVC/Music |

附件须归当前渠道所有。只有用户明确要求重新发送时才创建 resend 意图；生成成功或进入队列不等于用户已收到。QQ 媒体限制和状态见[投递说明](qq-media-delivery.md)。

## 11. 安装后升级或回滚失败

先确认是独立产品，`BOT_HOME` 未变化，上一对主包/coordinator 归档仍存在。保留 `installation.json`、`lifecycle-installation.json`、`lifecycle-installations/`、evolution journal 和旧归档。

- 兼容主包升级的健康检查失败时，最多自动恢复一次 hash 仍匹配的上一主包；未知外部投递不会重放。已完成的兼容主包升级可由可信管理员执行 `/evolve rollback <task-id>`。
- 需要新 coordinator 或缺少 `lifecycle-installation.json` 时，保持停止，执行 `stop → install.mjs <package-directory-or-tgz> → start`。离线安装失败只尝试一次 previous main → previous coordinator 恢复。
- previous hash/identity 不匹配时，使用可信且匹配的双包归档重跑安装器，不手工混装或替换运行中的 `node_modules`。
- 强杀后出现 `LIFECYCLE_OPERATION_STALE`：先从操作系统确认记录的 PID 已不存在，再将 `BOT_HOME/lifecycle-operation.lock` 移动归档；先重跑 installer 收敛未完成 journal，再启动。进程仍存活时不能删除锁。

记录脱敏 phase、错误码和健康检查阶段，具体更新步骤见[独立产品部署](deploy-product-profile.md)。

## 12. 收集脱敏诊断信息

提供插件版本/提交、Harness/Node/Python/FFmpeg 版本、安装方式、执行的命令、失败阶段、错误码及能力/投递状态。只在有关时补充媒体类型、大小区间和是否有平台回执。提交前将路径替换为 `<path>`、身份替换为 `<id>`、密钥替换为 `<redacted>`；漏洞按[安全政策](../SECURITY.md)私下报告。
