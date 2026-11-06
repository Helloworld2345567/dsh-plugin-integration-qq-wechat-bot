# 配置参考

本页只记录当前代码和测试实际读取的配置。未列出的变量不会因为写入环境而获得插件支持。项目当前仅支持中文 UI；人格配置只接受 `schemaVersion: 4`。

## 配置优先级和通用规则

- 产品 profile 的目录由安装器和启动器统一注入；已有 Harness profile 不会自动接管这些目录。
- 人格的 `media.image` 只保存允许的 HTTPS 地址、模型名和**密钥环境变量名**，不保存密钥值。人格覆盖优先于环境默认值，并随 V4 人格 revision 保存。
- QQ/微信凭据、聊天模型凭据和媒体分析凭据属于 Harness credentials 服务或受控 worker 注入，不应写进人格、仓库、命令行参数或发布包。
- 修改环境变量不会改变人格 revision；由于环境变量由进程继承，通常需要重启对应 Harness/产品进程后才完全生效。修改人格面板配置则生成新的 revision，并按运行时规则从下一轮生效。
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
| `BOT_IMAGE_BASE_URL` | 端点值，可能包含运营信息 | 图片服务的环境默认 HTTPS 地址；无环境值时为 `https://api.openai.com/v1`。人格 `media.image.baseUrl` 优先。 | 是 | 否（除非写入人格） | 否 | 示例只允许安全占位符；真实服务地址不得提交 |
| `BOT_IMAGE_MODEL` | 非敏感配置 | 图片服务的环境默认模型；无环境值时为 `gpt-image-2`。人格 `media.image.model` 优先。 | 是 | 否（除非写入人格） | 否 | 允许模型名占位符，不写私有模型路径 |
| `BOT_IMAGE_KEY_ENV` | 非敏感变量名；被指向的值敏感 | 指定图片密钥实际所在的环境变量名；无设置时优先 `IMAGE_ACCESS_KEY`，兼容 `SAKURA_IMAGE_API_KEY`，再回退变量名 `IMAGE_ACCESS_KEY`。 | 是 | 否（除非写入人格） | 否 | 只允许变量名，不允许密钥值 |
| `IMAGE_ACCESS_KEY` | **敏感** | 图片服务默认实际密钥；只在后台进程内读取。 | 是 | 否 | 否 | 禁止进入发布包、Issue、日志和 `.env.example` |
| `SAKURA_IMAGE_API_KEY` | **敏感** | 图片密钥兼容别名；仅在未提供 `IMAGE_ACCESS_KEY` 时作为 fallback。 | 是 | 否 | 否 | 禁止出现真实值 |
| `SAKURA_IMAGE_BASE_URL` / `OPENAI_BASE_URL` | 端点值 | 图片服务旧环境别名，优先级低于 `BOT_IMAGE_BASE_URL`。 | 是 | 否 | 否 | 只写占位符 |
| `SAKURA_IMAGE_MODEL` | 非敏感配置 | 图片模型旧环境别名，优先级低于 `BOT_IMAGE_MODEL`。 | 是 | 否 | 否 | 只写占位符 |
| `BOT_ANALYSIS_API_KEY` | **敏感，短生命周期** | 媒体分析/ASR worker 的固定注入变量名。实际密钥来自 Harness 模型 provider credentials；宿主只在每次子进程任务环境中注入，不要求运营者直接设置。 | 无需手工重启设置 | 否 | 否 | 禁止填写或伪造真实值；不要把它当作公开配置入口 |
| `BOT_VOICE_MODELS_ROOT` | 非敏感配置，但会暴露本机路径 | 首次打开音色模型库时的模型根目录默认值；面板保存的库设置优先。模型、权重和参考音频仍是外部资源，不随主包安装。 | 是（或重新打开/刷新服务） | 否 | 否 | 不写真实路径、权重路径或模型文件 |
| `BREEZE_TTS_URL` | 非敏感配置 | Breeze-TTS-2.cpp HTTP 服务地址默认值；面板保存的 Breeze 地址优先。 | 是（或重新打开/刷新服务） | 否 | 否 | 只写占位符，不写凭据或真实运行日志 |
| `GPT_SOVITS_ROOT` | 非敏感路径 | GPT-SoVITS 外部项目目录默认值；面板保存的启动目录优先。仅用于用户点击“启动 GPT-SoVITS”，不会自动启动。 | 是 | 否 | 否 | 只写占位符，不写本机路径 |
| `BREEZE_TTS_ROOT` | 非敏感路径 | Breeze-TTS-2.cpp 外部项目目录默认值；面板保存的启动目录优先。仅用于用户点击“启动 Breeze TTS”，不会自动启动。 | 是 | 否 | 否 | 只写占位符，不写本机路径 |
| `BREEZE_TTS_VOICES_ROOT` | 非敏感路径 | Breeze `.breeze` 音色目录默认值；面板保存的目录优先。刷新时自动识别该目录中的已保存音色。 | 是（或刷新服务） | 否 | 否 | 只写占位符，不写本机路径 |
| `BOT_LAUNCH_TOKEN` | **敏感运行时 nonce** | `scripts/start.mjs` 每次启动随机生成，用于 launcher、bot bundle 与 lifecycle 的本机 IPC 停止/就绪/重启握手；不应手工固定。 | 由启动器管理 | 否 | 是 | 禁止记录、复制或提交 |
| `BOT_OPEN_DIRECTORY` | 路径敏感、短生命周期 | Windows“打开配置目录”动作在已校验路径后临时注入给本机 PowerShell helper；不是用户配置入口，不应手工设置。 | 无，由单次动作管理 | 否 | 否 | 禁止记录真实值或写入 `.env.example` |

`BOT_IMAGE_BASE_URL` 必须是无凭据、无查询和无片段的 HTTPS 地址；图片密钥环境变量名必须是大写变量名。图片配置的详细行为见 [image-generation 技能](../skills/image-generation/SKILL.md)。

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

人格的 TTS 与 STS 音色分别选择。音色下拉框旁的“刷新”扫描已保存的模型库设置，不要求先保存人格草稿；新建人格、启用语音或切换引擎后都可直接选择音色。选择和其他修改一起保存在草稿中，点击人格底部“保存”后从下一轮生效。模型目录或服务地址修改后先保存连接设置，再刷新。ASR 与视频理解跟随主聊天模型，ASR 可单独选择聊天或转写协议。

“处理延时回复”控制私聊任务尚未完成时的阶段提示。默认开启，默认每 60 秒发送一次；关闭后只发送最终结果。开启时可设置 10–3600 秒的间隔，修改在保存人格后从下一轮生效。

主插件的实际 Config schema 只有以下字段，可在 Harness bundle 配置中设置：

| 字段 | 默认/作用 | 重启 | 影响人格 revision |
| --- | --- | --- | --- |
| `dataDir` | 机器人运行数据目录；为空时按 `BOT_DATA_HOME`、`DSH_HOME` 和 `.runtime/bot-data` 推导。 | 需要重新加载插件 | 否 |
| `python` | 媒体 worker Python 解释器；为空时使用 `BOT_PYTHON` 或 `python`。 | 需要重新加载插件 | 否 |
| `debounceMs` | 同一会话入站消息合并等待时间，默认 `2000` ms，范围 `0–60000`。 | 需要重新加载插件 | 否 |

## 仅开发/测试使用的变量

以下变量由仓库测试脚本读取，不是用户配置，不要复制到生产 `.env` 或 Issue：`CI_PYTHON`、`BOT_TEST_PYTHON`、`BOT_TEST_TMP`、`BOT_TEST_WEB_TOOLS_SOURCE`、`BOT_TEST_IMAGE_KEY`、`NATIVE_TEST_RESULT`、`LIFECYCLE_NATIVE_FOLDER`。测试脚本还会清理或临时设置 `HOME`、`TEMP`、`npm_config_store_dir` 等隔离目录变量。

## 不应写入环境或发布包的内容

不要将 QQ/微信 token、账号/用户/群 ID、Harness credentials、API key、Cookie、签名 URL、数据库文件、日志全文、模型权重或本机绝对路径写入 `.env`、persona、Issue、PR 或 npm 包。`.env.example` 只提供变量名、空值和安全说明；它不是凭据模板。参见 [安全政策](../SECURITY.md) 和 [获取支持](../SUPPORT.md)。
