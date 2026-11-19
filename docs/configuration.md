# 配置参考

简体中文 | [English](en/configuration.md)

本页只记录当前代码和测试实际读取的配置。未列出的变量不会因为写入环境而获得插件支持。项目支持中英文 UI；人格配置只接受 `schemaVersion: 4`。

## 配置优先级和通用规则

- 人格只管理人设和文件；模型、回复、媒体、工具与技能权限由每个机器人保存。同一人格可供多机器人共用，切换人格保留历史、机器人设置和会话覆盖。
- 修改人格生成新 revision；机器人设置独立保存，均从下一轮生效，当前轮使用冻结配置。已有机器人从原 V4 人格复制一次运行设置，之后不再由旧人格字段覆盖。
- 图片服务在“服务”配置，在机器人媒体设置中选择；其他媒体使用受管 Service Profile。QQ/微信、聊天模型和媒体分析凭据由 Harness credentials 管理。

## 产品与运行时目录

环境变量不改变人格 revision；修改后通常需要重启继承它们的进程。路径使用本机配置，公开报告使用占位符。

独立产品脚本直接接受运营者设置的目录变量只有 `BOT_HOME`、`BOT_WORKSPACE_ROOT` 和 `BOT_PYTHON`。它会在子进程环境中固定注入 `DSH_HOME=BOT_HOME`、`DSH_AGENTS_HOME=BOT_HOME/agents`、`BOT_PERSONAS_ROOT=BOT_HOME/personas`，并把 `BOT_DATA_HOME` 放到 `BOT_WORKSPACE_ROOT/.runtime/storages/bot-integration`；外部同名值不会覆盖这些产品布局。已有 Harness profile 或直接加载主插件时，后四项才按各自的 Harness/插件默认值生效。

| 变量/配置 | 默认行为与作用范围 | 重启 |
| --- | --- | --- |
| `BOT_HOME` | 独立安装器的产品数据根；未设置时为当前目录 `.runtime/bot-data`。启动器、lifecycle 和安装记录使用它。 | 是 |
| `DSH_HOME` | 已有 Harness/直接插件启动的数据根兼容回退；插件数据目录未显式设置时参与推导。独立产品始终将其设为 `BOT_HOME`，不接受单独覆盖。 | 是 |
| `BOT_DATA_HOME` | 已有 Harness/直接插件启动时的主插件 SQLite 数据目录，优先于 `DSH_HOME` 推导值。独立产品始终使用工作区 `.runtime/storages/bot-integration`。 | 是 |
| `BOT_WORKSPACE_ROOT` | 默认是当前工作目录 `.runtime/workspaces`；首次独立安装后写入 `BOT_HOME/workspace.json`，后续启动复用。保存会话、附件、引擎缓存和 worker 工作区。 | 是 |
| `BOT_PERSONAS_ROOT` | 已有 Harness/直接插件启动的人格文件根；未设置时从插件数据目录推导。独立产品始终使用 `BOT_HOME/personas`，不接受单独覆盖。 | 是 |
| `BOT_PYTHON` | 媒体 worker 使用的 Python 解释器；未设置时已有 Harness 使用 `python`，独立产品使用 `BOT_HOME/media-venv` 中的解释器。需要 Python 3.12/3.13 和基础 requirements。 | 是 |
| `OPENAI_API_KEY`、`GEMINI_API_KEY` 或服务面板指定的变量 | 图片服务的凭据来源；OpenAI 读取 `openAiKeyEnv`，Google Gemini 读取 `googleKeyEnv`，默认分别为 `OPENAI_API_KEY` 和 `GEMINI_API_KEY`。ComfyUI 不使用此密钥。 | 修改变量值后重启 |
| `BOT_VOICE_MODELS_ROOT` | 首次打开音色模型库时的模型根目录默认值；面板保存的库设置优先。模型、权重和参考音频仍是外部资源，不随主包安装。 | 是（或重新打开/刷新服务） |
| `BREEZE_TTS_URL` | Breeze-TTS-2.cpp HTTP 服务地址默认值；面板保存的 Breeze 地址优先。 | 是（或重新打开/刷新服务） |
| `GPT_SOVITS_ROOT` | GPT-SoVITS 外部项目目录默认值；面板保存的启动目录优先。仅用于用户点击“启动 GPT-SoVITS”，不会自动启动。 | 是 |
| `BREEZE_TTS_ROOT` | Breeze-TTS-2.cpp 外部项目目录默认值；面板保存的启动目录优先。仅用于用户点击“启动 Breeze TTS”，不会自动启动。 | 是 |
| `BREEZE_TTS_VOICES_ROOT` | Breeze `.breeze` 音色目录默认值；面板保存的目录优先。刷新时自动识别该目录中的已保存音色。 | 是（或刷新服务） |

`BOT_ANALYSIS_API_KEY` 由宿主按任务从 Harness credentials 注入；`BOT_LAUNCH_TOKEN` 由启动器生成；`BOT_OPEN_DIRECTORY` 由目录打开动作临时注入。这些运行时值不需手工设置，不能记录或提交。

服务面板中的 OpenAI 和 Google 地址必须是无凭据、无查询和无片段的 HTTPS 地址；密钥字段只填写大写环境变量名，不保存密钥值。Google 默认地址为 `https://generativelanguage.googleapis.com/v1beta`，默认模型为 `gemini-2.5-flash-image`，默认密钥变量为 `GEMINI_API_KEY`。ComfyUI 使用服务面板保存的本机 `comfyUiBaseUrl` 和 API 工作流路径。独立调用图片脚本时使用 `--protocol`、`--base-url`、`--model` 和 `--workflow` 指定相应配置，使用 `--api-key-env` 选择密钥变量。若所选变量没有密钥则报错，不回退到其他变量。图片配置的详细行为见 [image-generation 技能](../skills/image-generation/SKILL.md)。

服务地址、模型、协议和工作流以显式参数传入，不读取同名环境配置。OpenAI 和 Google 请求都可用 `image_generation.model` 按次指定模型，不修改默认值或失败后自动换模型；ComfyUI 模型由工作流决定。

### 会话图片服务切换

可信私聊支持 `/image` 或 `/image list` 查看当前轮、下一轮的图片服务及会话覆盖状态；使用 `/image openai`、`/image comfyui`、`/image google` 切换，协议名称忽略大小写。也可说“切换图片服务到 Google”，由 `bot_image_control` 执行相同操作。

选择优先级为会话覆盖 → 机器人图片设置 → 服务页全局默认。`/image reset` 清除会话覆盖。切换从下一轮生效，正在生成的任务保留原服务；同一条消息中切换后请求生图，也仍使用本轮原服务。

覆盖在重启、新建或清空会话、切换人格后保留；恢复历史会话使用该历史保存的选择。图片能力未开启时不能设置服务，但仍可查询和清除覆盖。命令只选择已有服务配置，不修改地址、密钥、模型或工作流，不探测服务在线状态，也不在生成失败后自动切换服务。

## 安装器、启动器和 Harness 管理变量

`BOT_INSTALL_LAYERS` 默认 `core,basic-media`，这两层必须保留；可选 `voice-generation`、`music`、`singing-rvc`，命令行 `--layers=` 优先。`BOT_SOURCE_ROOT` 仅用于源码安装、测试和回滚校验。

`DSH_PROFILE`、`DSH_PROFILE_DIR`、`DSH_SESSION_ID` 和 `DSH_WEB_URL` 由 Harness 管理，不是插件配置入口。已有 Harness 通过 `dsh plugin --profile <profile> add .` 安装；独立产品使用 `scripts/install.mjs`、`scripts/start.mjs` 和 `scripts/stop.mjs`。

## 插件 Config（不是环境变量）

机器人的 TTS 与 STS 音色分别选择。“机器人 → 媒体”中的刷新扫描已保存的模型库设置，不要求先保存草稿。选择与其他修改一起保留在机器人草稿中，点击底部“保存”后从下一轮生效。服务地址、目录改动仍在“服务”页保存。ASR 与视频理解跟随该机器人的主聊天模型，ASR 可单独选择聊天或转写协议。

“机器人 → 运行”中的“处理延时回复”控制私聊任务尚未完成时的阶段提示，默认开启、间隔 60 秒，可设为 10–3600 秒；关闭后只发送最终结果。

主插件的实际 Config schema 只有以下字段，可在 Harness bundle 配置中设置：

| 字段 | 默认/作用 | 重启 |
| --- | --- | --- |
| `dataDir` | 机器人运行数据目录；为空时按 `BOT_DATA_HOME`、`DSH_HOME` 和 `.runtime/bot-data` 推导。 | 需要重新加载插件 |
| `python` | 媒体 worker Python 解释器；为空时使用 `BOT_PYTHON` 或 `python`。 | 需要重新加载插件 |
| `debounceMs` | 同一会话入站消息合并等待时间，默认 `2000` ms，范围 `0–60000`。 | 需要重新加载插件 |
| `autoStart` | 默认 `true`；设为 `false` 时加载机器人面板、配置和历史，等待单独启动机器人服务，再连接渠道和恢复后台任务。 | 需要重新加载插件 |
| `messageLocale` | `zh`（默认）或 `en`；所有机器人的帮助、命令结果、错误和进度等固定提示语言。在“服务 → 机器人服务”中即时保存，由 Harness 持久化。 | 否；后续操作生效 |

### 工作区与附件清理

机器人“工作区”中的自定义路径是根目录，默认和自定义路径都会追加 `<botId>/<scopeKey>`；Agent 在其下的 `sessions/<sessionId>/` 工作，普通产物放入 `outputs/`。渠道媒体库独立于会话目录，新建会话仍可按附件 ID 复用未清理的旧媒体。面板显示实际解析目录。

工作区页提供登记容量统计、类型/来源/截止时间筛选、清理预览和“保留”标记。清理只删除选中的已注册附件，保护当前会话、运行任务、未完成或可重试投递及保留项；删除会话会清理会话目录，但渠道附件需要另行清理。总览的“导出历史”按需生成可读 JSONL，不再每轮重复导出。

删除当前会话会停止任务并建立保留模型、音色和图片服务覆盖的空白会话；删除历史会话不影响当前会话。会话目录外的用户文件、渠道附件和长期记忆保留。删除机器人则停止任务、移除授权，并永久清除其全部会话、消息、记忆、附件、媒体任务及自动化记录，保留人格和其他用户文件；旧机器人 ID 保留，新建机器人需使用新 ID。

### 语言设置的作用范围

管理界面跟随 Harness 的 `locale.preference`，与全项目 `messageLocale` 独立。修改界面语言不会改写机器人提示设置、人格、草稿或 TTS 的 `promptLang` / `textLang`。

命令、普通聊天和每次自动化执行开始时冻结固定提示语言；正在执行的任务、排队会话操作及其重启恢复继续使用发起时的语言。重复任务下一次执行使用新设置。旧配置和缺少语言字段的旧记录按中文解释，已生成消息不重新翻译或重发。

面板新建人格只在创建时根据当前界面语言填入起始人设。首次安装的内置默认人格保持身份和行为，但不强制中文，回复语言跟随用户和对话；已有安装的人格不自动改写。内置技能和模型操作说明使用单份英文，正常模型回复仍遵循人格与用户要求。

## 仅开发/测试使用的变量

测试解释器、临时目录和原生验收变量统一见[测试契约](testing.md)，不要复制到生产配置。

## 不应写入环境或发布包的内容

不要将 QQ/微信 token、账号/用户/群 ID、Harness credentials、API key、Cookie、签名 URL、数据库文件、日志全文、模型权重或本机绝对路径写入 `.env`、persona、Issue、PR 或 npm 包。`.env.example` 只提供变量名、空值和安全说明；它不是凭据模板。参见 [安全政策](../SECURITY.md) 和 [获取支持](../SUPPORT.md)。

## 定时、主动会话与进度提醒

可信私聊可用自然语言管理任务，例如“十分钟后提醒我喝水”“每天北京时间零点说晚安”或“开启每日主动聊天”，无需开启本机工具权限。定时任务支持单次、间隔和按时区每天定时，重启后恢复，忙碌时延后。主动会话默认关闭；开启后默认每日最多 3 次、00:00–09:00 静默、至少相隔 180 分钟、用户聊天后冷却 30 分钟。

后台任务使用当前会话历史与人格，需要宿主持续运行。停止当前任务取消正在生成的回复；暂停或删除计划停止后续触发。QQ 主动发送额度和微信上下文有效期由平台决定，生成完成不等于送达，应查看投递记录。

“处理延时回复”会额外调用本轮聊天模型生成私聊阶段提示，失败时使用本地提示，完成或取消即停止；群聊、定时和主动会话不使用此提醒。
