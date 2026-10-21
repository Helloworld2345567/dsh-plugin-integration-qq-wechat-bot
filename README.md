# QQ / 微信 Harness 插件

让 DeepSeek Harness 负责上下文、Agent 循环、工具、skills、模型和回复。插件提供官方渠道连接、多 bot 管理、可热切换人格、受控媒体 worker 与持久化投递。

支持 DeepSeek Harness **0.2.1-rc.2**、Node.js **24+**。独立数据目录默认 `~/.dsh-bots`，不修改现有 Harness 或 AstrBot 安装。

当前是 **0.1.3 联调版本**。本地与原生 Harness 验证已通过；真实媒体提供商与多账号收发仍需分别验收，见 [验证记录](docs/validation.md)。

## 安装与启动

Windows 需要 PowerShell 7、Node.js 24、Python 3.12 或 uv。音频识别、视频／GIF 处理另需 `ffmpeg` 和 `ffprobe` 位于 PATH。

```powershell
npm ci
npm run build
pwsh -File scripts/windows.ps1 install
pwsh -File scripts/windows.ps1 start -Port 3000
```

安装脚本创建专用 Python 环境并安装媒体依赖，组合 `dsh-base`、`dsh-web-app` 和本插件。浏览器打开启动日志中的本地 URL，在“设置 → QQ / 微信机器人”管理。保管启动 URL 中的本机授权令牌。

```powershell
# 可选：在 install/start/stop 时使用相同的数据目录
$env:BOT_HOME = Join-Path $env:LOCALAPPDATA 'HarnessBots'
pwsh -File scripts/windows.ps1 stop
```

`BOT_PYTHON` 可指定已经安装 requirements.txt 的 Python。其余数据目录、渠道凭据、会话及附件均由该实例管理。不要将 BOT_HOME 放在发布目录内。停止通过父子进程 IPC 请求 Harness 正常退出，超时后才终止该启动器持有的进程树。

## 配置与接入

1. 在 Harness 原生“模型”设置中添加聊天提供商及凭据。
2. 在本插件“配置与人格”中给“默认”或“小樱”选择聊天模型。可复制、新建、编辑、查看版本及归档配置。
3. 创建 bot，绑定配置，使用手机扫描二维码并确认。QQ 也支持已有 AppID／AppSecret；输入框隐藏 Secret，后端保存在 Harness credentials service。
4. 启动连接，再在平台上发送消息。QQ 支持官方私聊及群 @；微信 iLink 支持私聊。普通微信群、公众号、企业微信不在本版范围。

扫码仍取决于手机确认、平台开放资格、服务可用性及对应账号权限。过期后重新获取二维码；授权失效时停止并重新授权。同一 bot 的账号身份固定，更换账号应创建新 bot，避免混用历史。

QQ 当前公开扫码协议提供等待、完成和过期状态；若手机取消而平台未返回单独拒绝状态，面板会保持等待直到过期。微信提供的取消／拒绝状态会直接显示。

每份产品配置对应一个人格；bot 可共享配置。切换配置保留 session 与历史，下一轮生效；正在执行的轮次固定人格、模型和能力快照。编辑共享配置影响所有绑定 bot 的后续轮次。`/stop` 取消本会话工作，`/new` 或 `/reset` 才创建新对话。

默认可信用户列表为空。仅面板指定的**可信私聊用户 ID**能使用配置允许的原生本机工具；群消息不获得本机权限。权限新增下一轮生效，撤销会即时拒绝后续工具调用并取消可取消的工作。给用户添加本机权限意味着允许其通过 bot 操作运行账户可访问的主机资源。

## 可选联网插件

可在同一个 `bots` profile 安装 [dsh-web-tools](https://github.com/A3Boy/dsh-web-tools)，提供原生 `web_search` 与 `web_fetch`。在“配置与人格 → 工具与技能 → 业务工具”中为需要联网的人格加入这两个名称；它们不要求可信用户身份，也不授予命令或本地文件权限。默认人格不会自动获得联网权限；已有会话在下一轮读取新设置，撤销即时生效。

插件自身在“设置 → 网页搜索”管理搜索源；搜索需要相应服务 Key 或已配置的自建搜索服务，网页正文读取可使用无 Key 的通用抓取。凭据缺失应返回错误，不能冒充搜索成功。插件的会话联网开关仍可进一步关闭这些工具。安装第三方 bundle 后需要重启 Harness；本仓库不内嵌该插件或搜索凭据。

## 媒体能力

图片理解与扫描文档 OCR 直接使用当前聊天模型，不需要另配视觉服务。请为人格选择支持图像输入的模型。扫描 PDF 的无文字页会渲染为真实图片交给该模型，最多处理 10 页，未覆盖部分明确标记。

图片生成／编辑直接调用内置 `image-generation` skill，共用唯一图片客户端，成功自动登记回传。默认读取 `IMAGE_ACCESS_KEY`；支持 `BOT_IMAGE_BASE_URL`、`BOT_IMAGE_MODEL`、`BOT_IMAGE_KEY_ENV` 扩展变量，兼容 `SAKURA_IMAGE_BASE_URL`、`SAKURA_IMAGE_MODEL`、`SAKURA_IMAGE_API_KEY`。未设置地址／模型时使用 OpenAI 公共接口和 `gpt-image-1`。已有 skill 使用其他默认地址或模型时，将其非敏感设置映射到上述变量即可，无需复制密钥。

可在独立数据目录的 `.env` 中设置这些变量；已继承的进程环境变量优先。面板显示图片 skill 继承的模型和密钥就绪状态；高级设置可按人格覆盖地址、模型及密钥**环境变量名**，留空继承。切勿把真实密钥填入人格提示词、仓库或验收记录。图片环境变量变化需重启进程；人格和模型设置不需重启。

语音识别和视频理解使用内置 `media-analysis` skill 与受管脚本，默认跟随本轮聊天提供商和模型，从 Harness 原生“模型”设置读取 URL 与凭据，不另配媒体服务。可从已有提供商中指定分析模型；变更下一轮生效。密钥通过 credentials service 按任务解析，只临时注入 worker 环境，不写入任务、人格或工具结果。原生提供商凭据更新无需重启。

音频默认通过 `/chat/completions` 的真实 `input_audio` 载荷识别，也可选择 `/audio/transcriptions` 协议。视频沿用独立视频核心的 MP4 载荷契约；需要所选模型支持相应模态，配置就绪不能代替实测。不兼容的提供商协议会明确拒绝。语音合成配置与自动语音回复已移除，已有音频产物仍可回传。

| 能力 | 接口／行为 |
| --- | --- |
| 图片理解 | 当前聊天模型原生图像附件，发送真实图片字节，无独立视觉服务 |
| 图片生成／参考编辑 | 唯一共享客户端 `skills/image-generation/scripts/image_api.py`；每轮一次尝试、最多一张，真实参考图，统一 JPEG |
| 语音 | 优先平台转写；脚本通过多模态聊天或 `/audio/transcriptions` 识别；SILK 在宿主解码，音频标准化为 WAV，最长 300 秒 |
| 视频 | 独立视频核心，经 `/chat/completions` 发送实际 MP4；要求后端支持该视频载荷契约，返回画面、音轨与覆盖范围 |
| 文档 | PDF、DOCX、TXT、CSV、XLSX；扫描 PDF 页面由当前聊天模型识别，未读取页明确标记不完整 |
| 产物 | 图片、音频、视频、GIF、文件；固定 ffmpeg 转码，可信用户可使用获准的 Harness 原生命令 |

纯视频／文件和纯链接输入先静默暂存，收到处理指令后才读取。引用附件及同一会话最近十分钟的附件可用于后续任务。HTTP 成功、模型返回文本或磁盘路径都不等于媒体语义验收通过。

每个输入最多 50 MiB，回传产物最多 20 MiB；每会话附件登记容量 512 MiB、全实例 2 GiB；媒体并发全局 2、每会话 1。UTC 每日每会话每种操作上限：视频 10、生成／编辑各 20、其余各 50。已提交但结果未知的付费操作不自动重试。

面板区分配置状态与人工实测记录，按配置版本保存 `PASS / FAIL / BLOCKED / NOT_RUN` 及证据说明；改版后重新验收。长期记忆仅来自用户本人完整原文中的稳定偏好，可查看、更正、删除，删除标记防止旧来源重新写入。

## 升级与打包

先停止旧实例，在新版目录安装依赖、构建，再运行安装脚本；已有 BOT_HOME、人格、绑定、凭据及历史保持。首次升级到 0.1.2 会新增人格配置版本：启用 media-analysis、移除重复连接与 TTS 设置，旧版本保留；原会话与历史不变。也可向安装脚本传入经过审查的新包路径：

```powershell
pwsh -File scripts/windows.ps1 upgrade -Source './new-plugin.tgz'
pwsh -File scripts/windows.ps1 start
```

正式切换平台账号前停止 AstrBot 等旧消费者；同一数据目录拒绝重复运行。不要批量导入旧聊天或复制整份旧运行配置。

```powershell
npm run typecheck
npm test
# 使用装有 requirements.txt 的解释器
python -m unittest discover -s tests -p 'test_*.py'
node scripts/test-native.mjs
npm run build
npm run check:release
npm pack --ignore-scripts
```

可独立打包的 [bot-unified-chat 模式](packages/bot-unified-chat/README.md) 共用同一份实现；本插件已内置，无需重复安装。它不依赖本机 unified-chat-mode。

代码采用 MIT；复用来源及许可见 [第三方声明](THIRD_PARTY_NOTICES.md)。本仓库不包含 AstrBot／OpenClaw 运行时、平台凭据或旧聊天。更多信息见 [架构](docs/architecture.md)、[验证](docs/validation.md) 和 [迁移](docs/migration.md)。
