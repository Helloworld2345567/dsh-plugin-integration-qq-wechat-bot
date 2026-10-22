# QQ / 微信 Harness 插件

让 DeepSeek Harness 负责上下文、Agent 循环、工具、skills、模型和回复。插件提供官方渠道连接、多 bot 管理、可热切换人格、受控媒体 worker 与持久化投递。

支持 DeepSeek Harness **0.2.1-rc.2**、Node.js **24+**。独立数据目录默认 `~/.dsh-bots`，不修改现有 Harness 或 AstrBot 安装。

当前是 **0.2.2 联调版本**。支持自修改、动态技能、聊天命令、按 bot 统计及独立升级恢复；聊天命令也可用自然语言表达，覆盖会话、人格、模型、技能、统计与维护。使用方法见 [命令、自进化与统计](docs/evolution-commands-stats.md)，验证边界见 [验证记录](docs/validation.md)。

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

可信私聊用户可以直接说“把当前会话切换到某模型”或“恢复人格默认模型”，小樱通过 `bot_model` 查询已配置的提供商和模型，再切换当前会话；存在多个候选时会请你选择。此操作无需本机工具权限，下一轮生效，当前轮及已启动的子任务保持原模型。也可使用 `/model`；会话模型覆盖不会修改共享人格，`/persona` 切换会清除该覆盖。

其他命令同样支持自然语言，例如“开个新会话”“停止当前任务”“压缩上下文”“查看历史会话”“切换到默认人格”“关闭图片生成技能”“查看今天的用量”“重新加载人格文件”“重启服务”。权限与对应斜杠命令一致。明确的基础控制短句可在模型忙碌时直接处理；由工具发起的会话变更先排队，当前轮结束后执行并发送结果确认。重启继续等待实例在途工作排空。

默认可信用户列表为空。仅面板指定的**可信私聊用户 ID**能使用配置允许的原生本机工具；群消息不获得本机权限。权限新增下一轮生效，撤销会即时拒绝后续工具调用并取消可取消的工作。给用户添加本机权限意味着允许其通过 bot 操作运行账户可访问的主机资源。

## 工作目录与配置文件夹

默认工作目录位于安装时仓库目录的 `.runtime/workspaces/` 下，每个会话使用独立子目录；`.runtime/` 已加入 `.gitignore`，目录中的文件不会提交或打包。安装脚本将默认根目录保存在独立数据目录的 `workspace.json`，后续从其他目录启动或升级仍沿用它。可通过启动进程的 `BOT_WORKSPACE_ROOT` 环境变量覆盖默认根目录。

在“机器人”页填写某个 bot 的绝对工作目录并点击“保存工作目录”，下一轮使用指定目录，session 与历史不变，正在执行的任务和子任务保留原目录。留空恢复默认的会话子目录。指定目录会被该 bot 的可信用户共享；其他 bot 不会随之改变。目录切换不会授予新的本机工具权限。旧版本默认工作目录的文件在首次使用新目录时复制保留，不覆盖已有新目录，也不删除旧文件。

人格的可编辑文件保存在独立数据目录的 `personas/<配置ID>/` 中，默认布局如下：

```text
~/.dsh-bots/
├─ personas/
│  └─ sakura/
│     ├─ config.json     # 名称、模型引用、工具、技能、图片风格及版本号
│     └─ persona.md      # 人设和说话规则
└─ storages/
   └─ bot-integration/
      └─ bots.sqlite     # 生效版本、历史版本、机器人绑定和运行状态
```

升级首次加载时，现有配置自动导出为这两个文件，保持当前版本号与会话历史；已有文件草稿不会被覆盖。`config.json` 不包含 `personaPrompt`，人设正文只在 `persona.md` 中编辑。保留文件中的 `id`、`schemaVersion` 和 `revision`；ID 须与目录名相同，revision 是编辑所依据的生效版本，不需要手动递增。配置只引用模型和密钥环境变量名，不保存密钥。

手工编辑两个文件后，在“配置与人格”选择对应人格并点击“校验并应用文件”。应用前继续使用 SQLite 中的上一生效版本；校验通过后生成新版本，并同步文件的 revision，下一轮生效。无改动重复应用不会增加版本。新建人格也可以复制一份目录，更改目录名及 config.json 的 id、将 revision 设为 1，然后通过“从人格文件添加”导入。

面板“保存配置”共用相同的校验与发布流程，同时更新两个文件。检测到文件草稿或过期版本时拒绝覆盖，请先应用文件或将草稿恢复为生效内容；错误 JSON、缺少文件或模型无效不会替换生效配置。应用后仍保留轮次快照、历史和即时撤权规则。文件替换采用临时文件与 `.pending.json` 保存日志；进程中断后按数据库提交结果恢复，遇到额外人工修改时保留现场并显示错误，需核对日志后再操作。

“机器人”和“配置与人格”页的“打开配置目录”会打开所绑定人格的目录。Windows 使用正常窗口启动 Explorer，并等待确认对应目录窗口可见；10 秒内未确认会显示错误及手动打开路径，不以进程启动成功代替窗口打开。按钮不接受任意路径，也不作为聊天工具开放。非标准布局的自定义插件 `dataDir` 将人格保存在该目录的 `personas/` 下。

## 可选联网插件

可在同一个 `bots` profile 安装 [dsh-web-tools](https://github.com/A3Boy/dsh-web-tools)，提供原生 `web_search` 与 `web_fetch`。在“配置与人格 → 工具与技能 → 业务工具”中为需要联网的人格加入这两个名称；它们不要求可信用户身份，也不授予命令或本地文件权限。默认人格不会自动获得联网权限；已有会话在下一轮读取新设置，撤销即时生效。

插件自身在“设置 → 网页搜索”管理搜索源；搜索需要相应服务 Key 或已配置的自建搜索服务，网页正文读取可使用无 Key 的通用抓取。凭据缺失应返回错误，不能冒充搜索成功。插件的会话联网开关仍可进一步关闭这些工具。安装第三方 bundle 后需要重启 Harness；本仓库不内嵌该插件或搜索凭据。

## 媒体能力

图片理解与扫描文档 OCR 直接使用当前聊天模型，不需要另配视觉服务。请为人格选择支持图像输入的模型。扫描 PDF 的无文字页会渲染为真实图片交给该模型，最多处理 10 页，未覆盖部分明确标记。

图片生成／编辑直接调用内置 `image-generation` skill，共用唯一图片客户端，成功自动登记回传。默认读取 `IMAGE_ACCESS_KEY`；支持 `BOT_IMAGE_BASE_URL`、`BOT_IMAGE_MODEL`、`BOT_IMAGE_KEY_ENV` 扩展变量，兼容 `SAKURA_IMAGE_BASE_URL`、`SAKURA_IMAGE_MODEL`、`SAKURA_IMAGE_API_KEY`。未设置地址／模型时使用 OpenAI 公共接口和 `gpt-image-2`。已有 skill 使用其他默认地址或模型时，将其非敏感设置映射到上述变量即可，无需复制密钥。

可在独立数据目录的 `.env` 中设置这些变量；已继承的进程环境变量优先。面板显示图片 skill 继承的模型和密钥就绪状态；高级设置可按人格覆盖地址、模型及密钥**环境变量名**，留空继承。切勿把真实密钥填入人格提示词、仓库或验收记录。图片环境变量变化需重启进程；人格和模型设置不需重启。

语音识别和视频理解使用内置 `media-analysis` skill 与受管脚本，默认跟随本轮聊天提供商和模型，从 Harness 原生“模型”设置读取 URL 与凭据，不另配媒体服务。可从已有提供商中指定分析模型；变更下一轮生效。密钥通过 credentials service 按任务解析，只临时注入 worker 环境，不写入任务、人格或工具结果。原生提供商凭据更新无需重启。

音频默认通过 `/chat/completions` 的真实 `input_audio` 载荷识别，也可选择 `/audio/transcriptions` 协议。视频沿用独立视频核心的 MP4 载荷契约；需要所选模型支持相应模态，配置就绪不能代替实测。不兼容的提供商协议会明确拒绝。语音合成配置与自动语音回复已移除，已有音频产物仍可回传。

| 能力 | 接口／行为 |
| --- | --- |
| 图片理解 | 当前聊天模型原生图像附件，发送真实图片字节，无独立视觉服务 |
| 图片生成／参考编辑 | 唯一共享客户端 `skills/image-generation/scripts/image_api.py`；失败后可重试，每轮最多成功一张，不并行生成，真实参考图，统一 JPEG |
| 语音 | 优先平台转写；脚本通过多模态聊天或 `/audio/transcriptions` 识别；SILK 在宿主解码，音频标准化为 WAV，最长 300 秒 |
| 视频 | 独立视频核心，经 `/chat/completions` 发送实际 MP4；要求后端支持该视频载荷契约，返回画面、音轨与覆盖范围 |
| 文档 | PDF、DOCX、TXT、CSV、XLSX；扫描 PDF 页面由当前聊天模型识别，未读取页明确标记不完整 |
| 产物 | 图片、音频、视频、GIF、文件；固定 ffmpeg 转码，可信用户可使用获准的 Harness 原生命令 |

纯视频／文件和纯链接输入先静默暂存，收到处理指令后才读取。引用附件及同一会话最近十分钟的附件可用于后续任务。HTTP 成功、模型返回文本或磁盘路径都不等于媒体语义验收通过。

附件下载或读取失败时，插件通过持久化投递队列说明请求尚未进入模型；后续同会话追问可获得对应失败记录，避免把旧图片或其他任务的成功当作这次结果。0.2.1 修复了 Node.js 24 自动选择地址时 pinned DNS lookup 的 `all: true` 回调类型错误；该错误发生在图片下载阶段，不能据此判断图片模型是否支持识别。真实故障参考图已下载并解码为 1268 × 868 JPEG；实际提供商的参考编辑和语义识别仍需独立验证。

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
npm run test:lifecycle-native
# 独立空 BOT_HOME 验证实际安装包、监督重启和正常停止
npm run test:install-smoke
npm run build
npm run check:release
npm pack --ignore-scripts
```

可独立打包的 [bot-unified-chat 模式](packages/bot-unified-chat/README.md) 共用同一份实现；本插件已内置，无需重复安装。它不依赖本机 unified-chat-mode。

代码采用 MIT；复用来源及许可见 [第三方声明](THIRD_PARTY_NOTICES.md)。本仓库不包含 AstrBot／OpenClaw 运行时、平台凭据或旧聊天。更多信息见 [架构](docs/architecture.md)、[验证](docs/validation.md) 和 [迁移](docs/migration.md)。
