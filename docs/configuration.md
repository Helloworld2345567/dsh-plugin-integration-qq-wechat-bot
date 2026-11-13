# 配置参考

简体中文 | [English](en/configuration.md)

本页只记录当前代码和测试实际读取的配置。未列出的变量不会因为写入环境而获得插件支持。项目支持中英文 UI；人格配置只接受 `schemaVersion: 4`。

## 配置优先级和通用规则

- 产品 profile 的目录由安装器和启动器统一注入；已有 Harness profile 不会自动接管这些目录。
- 图片服务的地址、模型、默认协议、密钥变量名和 ComfyUI 工作流在服务面板集中配置；人格/机器人媒体设置只选择启用的图片协议。`openAiKeyEnv` 允许指定密钥变量名，未配置时默认 `OPENAI_API_KEY`；宿主将变量名和对应凭据传给 worker，图片脚本直接读取所选变量。地址、模型、协议和工作流以显式参数传给图片脚本，不读取环境变量回退。
- QQ/微信凭据、聊天模型凭据和媒体分析凭据属于 Harness credentials 服务或受控 worker 注入，不应写进人格、仓库、命令行参数或发布包。
- 修改环境变量不会改变人格 revision；由于环境变量由进程继承，通常需要重启对应 Harness/产品进程后才完全生效。修改人格会生成新的 revision；修改机器人设置独立保存，均从下一轮生效。
- 这些目录变量都有代码默认值；只有在需要覆盖默认目录时，才必须在安装/启动前设置。不要在 Issue、日志或示例中填写本机绝对路径。

## 产品与运行时目录

独立产品脚本直接接受运营者设置的目录变量只有 `BOT_HOME`、`BOT_WORKSPACE_ROOT` 和 `BOT_PYTHON`。它会在子进程环境中固定注入 `DSH_HOME=BOT_HOME`、`DSH_AGENTS_HOME=BOT_HOME/agents`、`BOT_PERSONAS_ROOT=BOT_HOME/personas`，并把 `BOT_DATA_HOME` 放到 `BOT_WORKSPACE_ROOT/.runtime/storages/bot-integration`；外部同名值不会覆盖这些产品布局。已有 Harness profile 或直接加载主插件时，后四项才按各自的 Harness/插件默认值生效。

| 变量/配置 | 敏感性 | 默认行为与作用范围 | 重启 | 影响人格 revision | 独立产品专属 | 发布包/Issue |
| --- | --- | --- | --- | --- | --- | --- |
| `BOT_HOME` | 非敏感值，但路径可能暴露隐私 | 独立安装器的产品数据根；未设置时为当前目录 `.runtime/bot-data`。启动器、lifecycle 和安装记录使用它。 | 是 | 否 | 主要是 | 只写 `<absolute-product-home>` 等占位符 |
| `DSH_HOME` | 非敏感值，但路径可能暴露隐私 | 已有 Harness/直接插件启动的数据根兼容回退；插件数据目录未显式设置时参与推导。独立产品始终将其设为 `BOT_HOME`，不接受单独覆盖。 | 是 | 否 | 否 | 只写变量名和占位符 |
| `BOT_DATA_HOME` | 非敏感值，但路径可能暴露隐私 | 已有 Harness/直接插件启动时的主插件 SQLite 数据目录，优先于 `DSH_HOME` 推导值。独立产品始终使用工作区 `.runtime/storages/bot-integration`。 | 是 | 否 | 否 | 不提供真实路径 |
| `BOT_WORKSPACE_ROOT` | 非敏感值，但路径可能暴露隐私 | 默认是当前工作目录 `.runtime/workspaces`；首次独立安装后写入 `BOT_HOME/workspace.json`，后续启动复用。保存会话、附件、引擎缓存和 worker 工作区。 | 是 | 否 | 否 | 不提供真实路径、数据库或日志路径 |
| `BOT_PERSONAS_ROOT` | 非敏感值，但路径可能暴露隐私 | 已有 Harness/直接插件启动的人格文件根；未设置时从插件数据目录推导。独立产品始终使用 `BOT_HOME/personas`，不接受单独覆盖。 | 是 | 否 | 否 | 不提供真实路径 |
| `DSH_AGENTS_HOME` | 非敏感值，但路径可能暴露隐私 | Harness agents 目录；独立产品始终注入 `BOT_HOME/agents`，不是运营者独立配置入口。 | 是 | 否 | 主要是 | 不提供真实路径 |
| `BOT_PYTHON` | 非敏感配置 | 媒体 worker 使用的 Python 解释器；未设置时已有 Harness 使用 `python`，独立产品使用 `BOT_HOME/media-venv` 中的解释器。需要 Python 3.12/3.13 和基础 requirements。 | 是 | 否 | 否 | 允许变量名；不写本机解释器路径 |
| `OPENAI_API_KEY` 或服务面板指定的变量 | **敏感** | OpenAI 兼容图片服务的凭据来源；图片脚本读取服务面板 `openAiKeyEnv` 指定的变量，未配置变量名时默认 `OPENAI_API_KEY`。ComfyUI 不使用此密钥。 | 修改变量值后重启 | 否 | 否 | 只可记录变量名，真实值禁止进入发布包、Issue、日志和 `.env.example` |
| `BOT_ANALYSIS_API_KEY` | **敏感，短生命周期** | 媒体分析/ASR worker 的固定注入变量名。实际密钥来自 Harness 模型 provider credentials；宿主只在每次子进程任务环境中注入，不要求运营者直接设置。 | 无需手工重启设置 | 否 | 否 | 禁止填写或伪造真实值；不要把它当作公开配置入口 |
| `BOT_VOICE_MODELS_ROOT` | 非敏感配置，但会暴露本机路径 | 首次打开音色模型库时的模型根目录默认值；面板保存的库设置优先。模型、权重和参考音频仍是外部资源，不随主包安装。 | 是（或重新打开/刷新服务） | 否 | 否 | 不写真实路径、权重路径或模型文件 |
| `BREEZE_TTS_URL` | 非敏感配置 | Breeze-TTS-2.cpp HTTP 服务地址默认值；面板保存的 Breeze 地址优先。 | 是（或重新打开/刷新服务） | 否 | 否 | 只写占位符，不写凭据或真实运行日志 |
| `GPT_SOVITS_ROOT` | 非敏感路径 | GPT-SoVITS 外部项目目录默认值；面板保存的启动目录优先。仅用于用户点击“启动 GPT-SoVITS”，不会自动启动。 | 是 | 否 | 否 | 只写占位符，不写本机路径 |
| `BREEZE_TTS_ROOT` | 非敏感路径 | Breeze-TTS-2.cpp 外部项目目录默认值；面板保存的启动目录优先。仅用于用户点击“启动 Breeze TTS”，不会自动启动。 | 是 | 否 | 否 | 只写占位符，不写本机路径 |
| `BREEZE_TTS_VOICES_ROOT` | 非敏感路径 | Breeze `.breeze` 音色目录默认值；面板保存的目录优先。刷新时自动识别该目录中的已保存音色。 | 是（或刷新服务） | 否 | 否 | 只写占位符，不写本机路径 |
| `BOT_LAUNCH_TOKEN` | **敏感运行时 nonce** | `scripts/start.mjs` 每次启动随机生成，用于 launcher、bot bundle 与 lifecycle 的本机 IPC 停止/就绪/重启握手；不应手工固定。 | 由启动器管理 | 否 | 是 | 禁止记录、复制或提交 |
| `BOT_OPEN_DIRECTORY` | 路径敏感、短生命周期 | Windows“打开配置目录”动作在已校验路径后临时注入给本机 PowerShell helper；不是用户配置入口，不应手工设置。 | 无，由单次动作管理 | 否 | 否 | 禁止记录真实值或写入 `.env.example` |

服务面板中的 OpenAI 兼容地址必须是无凭据、无查询和无片段的 HTTPS 地址；密钥字段只填写大写环境变量名，不保存密钥值。ComfyUI 使用服务面板保存的本机 `comfyUiBaseUrl` 和 API 工作流路径。独立调用图片脚本时使用 `--protocol`、`--base-url`、`--model` 和 `--workflow` 指定相应配置，使用 `--api-key-env` 选择密钥变量（默认 `OPENAI_API_KEY`）。若所选变量没有密钥则报错，不回退到其他变量。图片配置的详细行为见 [image-generation 技能](../skills/image-generation/SKILL.md)。

## 安装器、启动器和 Harness 管理变量

| 变量/参数 | 敏感性 | 作用与默认行为 | 重启 | 影响人格 revision | 范围 | 发布包/Issue |
| --- | --- | --- | --- | --- | --- | --- |
| `BOT_INSTALL_LAYERS` | 非敏感配置 | 独立安装器的层列表；命令行 `--layers=` 优先，默认 `core,basic-media`，且必须包含这两层。允许 `voice-generation`、`music`、`singing-rvc` 作为可选层。 | 重新安装 | 否 | 独立产品安装器 | 可写层名称，不写本机路径 |
| `BOT_SOURCE_ROOT` | 非敏感路径 | 独立安装/回滚校验使用的源码根覆盖；测试和源码安装使用，正常发布包安装不应设置。 | 重新安装 | 否 | 开发/测试/回滚 | 不提供真实路径 |
| `DSH_PROFILE` | 由 Harness/CLI 管理 | Harness 选择的 profile 名；本插件不直接读取、不定义默认值，也不写入凭据。 | 由 Harness 管理 | 否 | 已有 Harness/CLI | 只提供 `<profile>` |
| `DSH_PROFILE_DIR` | 由 Harness/CLI 管理，路径可能敏感 | Harness 当前 profile 目录；本插件不直接读取、不定义默认值。 | 由 Harness 管理 | 否 | 已有 Harness/CLI | 不提供真实路径 |
| `DSH_SESSION_ID` | 运行时标识 | Harness 测试隔离所用会话标识；不是本插件配置入口。 | 由 Harness 管理 | 否 | Harness/测试 | 不写真实会话 ID |
| `DSH_WEB_URL` | 运行时信息 | Harness Web 地址由 Harness 管理；不是产品 endpoint 配置入口。 | 由 Harness 管理 | 否 | Harness/测试 | 不写真实 URL |

已有 Harness 安装的 profile 由用户通过 `dsh plugin --profile <profile> add .` 管理；独立产品 profile 由 `scripts/install.mjs`、`scripts/start.mjs` 和 `scripts/stop.mjs` 管理。不要通过环境变量伪造 Harness profile 身份。

## 插件 Config（不是环境变量）

机器人的 TTS 与 STS 音色分别选择。“机器人 → 媒体”中的刷新扫描已保存的模型库设置，不要求先保存草稿。选择与其他修改一起保留在机器人草稿中，点击底部“保存”后从下一轮生效。服务地址、目录改动仍在“服务”页保存。ASR 与视频理解跟随该机器人的主聊天模型，ASR 可单独选择聊天或转写协议。

“机器人 → 运行”中的“处理延时回复”控制私聊任务尚未完成时的阶段提示，默认开启、间隔 60 秒，可设为 10–3600 秒；关闭后只发送最终结果。

机器人使用 `bot.settings` 独立保存模型、媒体、回复行为、图片风格、工具和技能权限。已有机器人在首次加载时从原 V4 人格复制一次设置；后续 `bot.save` 未传 `settings` 时保留原值，传入时完整替换。人格文件仍接受 V4，保留旧配置以兼容文件读取，但修改这些旧运行字段不会覆盖已迁移机器人的设置。人格页只编辑 ID、名称、人设及文件；切换人格保留机器人设置和会话覆盖。

主插件的实际 Config schema 只有以下字段，可在 Harness bundle 配置中设置：

| 字段 | 默认/作用 | 重启 | 影响人格 revision |
| --- | --- | --- | --- |
| `dataDir` | 机器人运行数据目录；为空时按 `BOT_DATA_HOME`、`DSH_HOME` 和 `.runtime/bot-data` 推导。 | 需要重新加载插件 | 否 |
| `python` | 媒体 worker Python 解释器；为空时使用 `BOT_PYTHON` 或 `python`。 | 需要重新加载插件 | 否 |
| `debounceMs` | 同一会话入站消息合并等待时间，默认 `2000` ms，范围 `0–60000`。 | 需要重新加载插件 | 否 |
| `autoStart` | 默认 `true`；设为 `false` 时加载机器人面板、配置和历史，等待单独启动机器人服务，再连接渠道和恢复后台任务。 | 需要重新加载插件 | 否 |
| `messageLocale` | `zh`（默认）或 `en`；所有机器人的帮助、命令结果、错误和进度等固定提示语言。在“服务 → 机器人服务”中即时保存，由 Harness 持久化。 | 否；后续操作生效 | 否 |

### 语言设置的作用范围

管理界面跟随 Harness 的 `locale.preference`，与全项目 `messageLocale` 独立。修改界面语言不会改写机器人提示设置、人格、草稿或 TTS 的 `promptLang` / `textLang`。

命令、普通聊天和每次自动化执行开始时冻结固定提示语言；正在执行的任务、排队会话操作及其重启恢复继续使用发起时的语言。重复任务下一次执行使用新设置。旧配置和缺少语言字段的旧记录按中文解释，已生成消息不重新翻译或重发。

面板新建人格只在创建时根据当前界面语言填入起始人设。首次安装的内置默认人格保持身份和行为，但不强制中文，回复语言跟随用户和对话；已有安装的人格不自动改写。内置技能和模型操作说明使用单份英文，正常模型回复仍遵循人格与用户要求。

## 仅开发/测试使用的变量

以下变量由仓库测试脚本读取，不是用户配置，不要复制到生产 `.env` 或 Issue：`CI_PYTHON`、`BOT_TEST_PYTHON`、`BOT_TEST_TMP`、`BOT_TEST_WEB_TOOLS_SOURCE`、`NATIVE_TEST_RESULT`、`LIFECYCLE_NATIVE_FOLDER`。测试脚本还会清理或临时设置 `HOME`、`TEMP`、`npm_config_store_dir` 等隔离目录变量。

## 不应写入环境或发布包的内容

不要将 QQ/微信 token、账号/用户/群 ID、Harness credentials、API key、Cookie、签名 URL、数据库文件、日志全文、模型权重或本机绝对路径写入 `.env`、persona、Issue、PR 或 npm 包。`.env.example` 只提供变量名、空值和安全说明；它不是凭据模板。参见 [安全政策](../SECURITY.md) 和 [获取支持](../SUPPORT.md)。
