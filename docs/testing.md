# 测试与验收契约

简体中文 | [English](en/testing.md)

本项目维护简体中文与英文。测试默认是离线优先的代码/协议验证：不使用真实 QQ/微信凭据，不创建真实 bot，不连接真实平台，不发送平台消息，也不承诺第三方 Adapter ABI 或外部模型/服务结果。

## 测试分层

| 命令 | 目的 | 临时文件/子进程 | Harness | FFmpeg | Python | 网络 | 真实凭据 | 预期输出与失败证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `npm run check:architecture` | 静态模块图、依赖方向、runtime cycle、入口与目录契约 | 只读；不启动业务进程 | 否 | 否 | 否 | 否 | 禁止 | JSON `PASS`；失败只含规则 ID 和仓库相对路径，不输出绝对路径 |
| `npm run typecheck` | TypeScript 类型门禁 | 不应修改源码；Node 子进程由 npm/tsc 管理 | 否 | 否 | 否 | 否 | 禁止 | `tsc` 无错误；终端只保留脱敏错误 |
| `npm test` | 隔离的 TypeScript 纯逻辑/fixture 测试 | 使用临时 `.codex` 目录；启动受限 Node/Python 子进程 | 否 | 视 fixture 而定 | 个别媒体 fixture 使用测试解释器 | 默认不允许真实外网；网络测试只用 fixture/local server | 禁止 | Node test 全部通过；失败只保留短的脱敏输出 |
| `npm run test:python` | Python worker、命名空间乱序冷导入、import 无副作用、媒体限制与协议单元测试 | Python unittest 临时输出；不保留 pyc/cache/运行数据 | 否 | 依测试而定 | 是，3.12/3.13 | 禁止真实服务 | 禁止 | `OK`；Python traceback 不得含凭据/绝对路径 |
| `npm run check:python-dependencies` | 需求语法、pip check、基础包检查 | 只读；启动受限 Python 子进程 | 否 | 否 | 是 | 默认不允许安装/下载 | 禁止 | JSON `PASS` 或明确缺包；optional 缺失不冒充基础失败 |
| `npm run build` | 生成主包 `dist/`，并由 lifecycle 子包自己的源码入口生成 bundle、contract export 与源码/输出摘要 | 修改被 Git/npm 排除的构建目录；esbuild 子进程/worker | 否 | 否 | 否 | 否 | 禁止 | 构建成功；陈旧 lifecycle dist 或摘要变化必须失败 |
| `npm run check:docs` | Markdown 链接、锚点、CI YAML 与文档入口 | 只读 | 否 | 否 | 否 | 否 | 禁止 | JSON `PASS`；失败指出文档相对路径 |
| `npm run check:contracts` | 文档、npm scripts、CI 版本和测试隔离契约一致性 | 只读 | 否 | 否 | 否 | 否 | 禁止 | JSON `PASS`；失败指出漂移的命令、版本或 runner |
| `npm run check:licenses` | npm/Python 许可证与来源契约 | 只读或读取已安装元数据 | 否 | 否 | 可选 | 否 | 禁止 | JSON `PASS`；证据不得含用户路径/凭据 |
| `npm run check:release` | npm pack dry-run、发布包内容和敏感文本门禁 | npm dry-run；不应留下归档 | 否 | 否 | 否 | 否 | 禁止 | JSON `PASS`；不得包含 `.codex`、`.runtime`、数据库、日志、凭据、fixture |
| `npm run verify:release` | 统一源码发布门禁：架构、类型、TS/Python 测试、依赖、构建、文档、许可证、归档检查 | 只允许既有被排除的 `dist/`/临时目录 | 否 | 否 | 是 | 否 | 禁止 | 所有阶段成功；按失败阶段保留脱敏摘要 |
| `npm run release:pack` | 先运行同一 `verify:release`，再实际生成、校验并清理临时 npm 归档 | 临时目录和归档必须在 `finally` 清理 | 否 | 否 | 否 | 否 | 禁止 | JSON 含归档摘要/hash，不上传原始运行数据 |
| `npm run test:native` | Harness 原生插件集成：真实 loop、持久化、fixture provider | 临时 profile/workspace、受限子进程；失败才保留脱敏证据 | 是，临时 profile | 仅 fixture 需要 | 测试解释器 | 禁止真实平台/外部模型 | 仅明显假的 fixture credential | `status: PASS`；证据目录只含脱敏摘要 |
| `npm run test:lifecycle-native` | lifecycle 原生安装、版本握手、主包热升级、排空、监督重启和一次回滚 | 临时 profile、动态端口、子进程树必须停止 | 是，临时 profile | 否 | 测试解释器 | 禁止真实服务 | 仅 fixture 值 | `status: PASS`；coordinator 在主包卸载后保持存活；失败保留必要脱敏日志，不保留 token/数据库 |
| `npm run test:install-smoke` | 实际 npm 包/安装器/命名空间 worker/监督启动与重启 smoke | 空产品 home、临时 workspace、动态端口；失败才保留证据 | 是，临时 profile | 否 | `BOT_TEST_PYTHON` 指定解释器 | 仅本机 smoke；禁止外部平台 | 禁止 | `status: PASS` 且零 bot；从已安装归档运行 document worker，并验证 launcher state 清理 |

Lifecycle 单元/原生/安装测试覆盖：完全兼容、protocol major 不兼容、coordinator 太旧、主包太旧、compatible minor capability 协商、缺失/伪造元数据、capability-free 旧组合、允许的主包热替换、必须离线双包升级的拒绝、启动 identity/version/hash 检查、排空后的监督重启、激活失败恢复 previous artifact、离线双包中途失败的一次回滚、源码/output 摘要漂移和 identity pattern 越界。测试不导入或发送 QQ／微信消息。

`npm run check:environment` 是测试前的只读预检，不替代上述门禁。它检查操作系统、Node 24+、Harness `0.2.1-rc.5`、Python 3.12/3.13、ffmpeg/ffprobe、基础 Python 依赖和 lockfile；voice-generation 缺失显示 `OPTIONAL`，不阻止基础流程。

## Repository contract 套件

`tests/repository-contract.test.ts` 直接对真实临时 SQLite adapter 运行唯一 contract 套件：重开持久化后配置 revision、binding、asset 与 pending delivery 仍然一致；scope／channel 隔离；persona revision CAS；session generation 与 stale／forged cursor；delivery 分页、blocker、unknown 不自动重放、retry 复用原 intent、显式 resend 新 intent；多步写入事务回滚；Profile revision 不可变。Store facade 不再参与测试。新增 repository 时必须在该套件补一条对应断言，并保持 `npm run check:architecture` 通过。

## 测试环境与变量分类

测试 runner 不复制整个 `process.env`。子进程只接收系统执行所需的 `PATH`/`PATHEXT`/`SystemRoot`/`WINDIR`/`COMSPEC`、隔离的 `HOME`/临时目录，以及 runner 创建的目录变量。Python runner 额外把 `PYTHONPATH` 固定为被测 checkout 或已安装归档的 `python/`，并用 `-B -P -m` 验证公共命名空间；从不继承外部 `PYTHONPATH`。真实 API key、Cookie、Authorization、Harness profile/session、用户/群 ID、模型端点和 npm/pip 用户配置不会进入测试子进程。

仅测试使用的变量如下，不能写入生产 `.env` 或 Issue：

- `BOT_TEST_PYTHON`：管理员明确提供的测试解释器；必须是 Python 3.12/3.13，不代表生产解释器。
- `BOT_TEST_TMP`：测试临时根；只允许 workspace/CI 临时目录，测试应为每次运行创建唯一子目录并清理。
- `BOT_TEST_WEB_TOOLS_SOURCE`：可选的本地 `dsh-web-tools` fixture 来源；runner 只接受当前 checkout 内、package name 已验证的目录，不接受远程包或仓库外路径。
- `BOT_TEST_ANALYSIS_KEY`：明显假的 fixture 值，只用于验证凭据传递路径，不调用真实服务。
- `NATIVE_TEST_RESULT`：native fixture 写入的结果文件；由 runner 创建。
- `LIFECYCLE_NATIVE_FOLDER`：lifecycle fixture 的临时根；由 runner 创建。
- `BOT_HOME`、`BOT_WORKSPACE_ROOT`、`BOT_PERSONAS_ROOT`、`BOT_DATA_HOME`、`BOT_PYTHON`：runner 创建/校验的隔离目录或测试解释器。
- `PYTHONPATH`：只能由测试 runner 覆盖为受信 `python/` 包根，用于验证 `dsh_bot_runtime`；不是用户可继承的测试输入。

native runner 在隔离环境中显式将 `OPENAI_API_KEY` 设为固定的假 fixture 值，不继承宿主的真实密钥，也不放宽通用环境允许列表。

普通 TypeScript/Python 测试不应读取共享 Harness profile、`DSH_PROFILE`、`DSH_HOME`、`DSH_SESSION_ID` 或任何真实凭据。fixture credentials 只使用 `fixture-*` 明文占位值，不能进入 npm pack 或完整日志。

## 真实验收边界

- mock/fixture 通过不等于 QQ/微信平台验收；原生测试不得发送真实平台消息。
- health/probe 通过只证明协议或可探测性，不等于真实媒体结果、完整音频、图片质量、模型角色或下载结果验收。
- 外部 TTS、Music、RVC、GPT-SoVITS、外部模型和平台验收由运营者单独完成，不是 CI 稳定承诺。
- 未登记能力必须继续显示 `missing`/`blocked`，不可静默换服务。
- 测试不承诺 V3 人格迁移/回退、第三方 Adapter ABI，也不把一次机器 benchmark 当作性能保证。

## 双语验收

检查中英词条 key、非空值与占位符一致，插件元数据和配置说明覆盖两种语言。英文界面应覆盖成功、空态、校验失败、服务诊断、通知、确认框和无障碍文本；切换语言后既有提示重绘且表单草稿不丢失。宽屏及 760px、460px 布局应能容纳英文标签。

机器人固定提示语言独立于界面语言：验证旧配置默认中文、保存后刷新/重启保持、新命令和下一次自动化采用新语言、进行中的回合和恢复的排队操作保持原语言。新建人格只填入一次初始文本，现有人格、用户内容和 TTS 参数不随设置改变。模型内部英文指令不能强制正常回复使用英文。

结构化诊断必须通过严格 schema、缓存与管理响应；旧记录仍可读，现有错误码/HTTP 状态保持，公开参数继续满足脱敏要求。英文文档必须能独立完成安装和配置，链接、语言配对、命令契约和发布包包含性由现有检查验证。

## CI 对照与证据

| CI 层 | 运行内容 |
| --- | --- |
| Linux `quality` | Node 24、Python 3.12、统一 `verify:release` 源码门禁，以及 npm/Python 依赖审计 |
| Windows `release-gate` | Node 24、FFmpeg/ffprobe、Python 3.12、实际 `release:pack`；复用同一环境执行 Harness `0.2.1-rc.5` 原生插件、lifecycle 与独立安装验收 |
| Windows `python-compatibility` | Python 3.13 的可复现依赖安装和 `pip check`；3.12 已由 Windows 发布门禁覆盖 |

每项 Windows 原生/安装测试独立运行，失败立即阻止后续步骤，避免后续命令覆盖失败退出码。TypeScript 测试失败后保留原始运行的脱敏输出，不自动逐文件重跑。

CI 上传依赖审计 JSON 和失败测试的脱敏诊断目录；Windows `release:pack` 在日志中输出归档名、SHA-256 和条目摘要，并在验证后删除临时 `.tgz`，不上传归档本体。任何 CI 证据都不能包含凭据、Authorization、Cookie、用户/群 ID、运行数据、数据库、完整日志、本机绝对路径或模型权重。

## 失败处理

失败时优先保留错误类别、阶段、版本首行和短的脱敏尾部输出。Windows 子进程必须终止完整进程树；动态端口优先于固定端口；launcher state、server、timer 和临时目录都必须在 `finally` 清理。只有失败诊断确实需要时才保留脱敏 evidence 目录；成功运行删除全部测试临时文件。仅上传 `.codex/*-evidence/` 下生成的脱敏诊断，不要上传整个 `.codex`、`.runtime`、原始日志、数据库、fixture credential 或完整 Harness profile。
