# 测试与验收契约

简体中文 | [English](en/testing.md)

测试使用 Node.js 24+、Python 3.12/3.13 和 Harness `0.2.1-rc.5`。默认使用离线 fixture 或本地测试服务器，不读取真实凭据，不连接真实平台，不发送平台消息。按变更选择最低检查见[开发指南](development.md)。

## 命令用途

| 命令 | 检测的失败与运行条件 |
| --- | --- |
| `npm run check:environment` | 缺少基础依赖、FFmpeg/ffprobe、lockfile 或版本不符；只读，可选语音依赖缺失仅报 `OPTIONAL` |
| `npm run check:architecture` | 跨层依赖、循环、SQL 所有权、Python 命名空间或构建入口漂移；只读离线 |
| `npm run check:skills` | 技能声明、参数、路由、引用或上下文预算不符合契约；只读 |
| `npm run generate:skills` | 生成 TS/Python registry；加 `-- --check` 只验证生成文件没有漂移 |
| `npm run inspect:skills` | 查看紧凑的技能、工具和操作目录；只读，不是运行验收 |
| `npm run test:skills` | 技能契约、生成文件与关键技能单元回归 |
| `npm run typecheck` | TypeScript 类型错误 |
| `npm run test`（或 `npm test`） | TypeScript 逻辑、SQLite 和协议 fixture 回归；部分媒体用例需要测试 Python/FFmpeg |
| `npm run test:python` | worker 协议、命名空间导入、import 副作用及媒体处理回归；需要测试 Python，部分用例需要 FFmpeg |
| `npm run check:python-dependencies` | requirements 语法、基础包缺失或 `pip check` 冲突；不安装依赖 |
| `npm run build` | 主包与 lifecycle 构建失败；生成忽略的 `dist/` 与构建摘要 |
| `npm run check:docs` | 本地链接、锚点、双语配对和 CI YAML 错误 |
| `npm run check:contracts` | 文档命令/版本、npm scripts、CI 和测试隔离契约漂移 |
| `npm run check:licenses` | 依赖许可证或来源声明不符；读取已安装元数据 |
| `npm run check:release` | npm dry-run 中缺失发布文件或混入运行数据、测试、凭据等 |
| `npm run verify:release` | 统一运行架构、技能、类型、构建、TS/Python 测试、依赖、文档、许可证与发布检查 |
| `npm run release:pack` | 先运行同一源码门禁，再实际生成、验证并清理临时 npm 归档 |
| `npm run test:native` | 临时 Harness profile 中的真实 Agent loop、持久化和 fixture provider 集成 |
| `npm run test:lifecycle-native` | 双包版本握手、排空、主包热升级、监督重启与失败回滚 |
| `npm run test:install-smoke` | 实际归档安装、已安装 Python worker、监督启动/重启与 launcher state 清理；需要 `BOT_TEST_PYTHON` |

通过只代表该检查覆盖的范围。发布命令已经包含的门禁无需在前后重复运行；原生集成三项仍需分别执行。Repository contract 使用真实临时 SQLite，覆盖重开持久化、scope 隔离、revision/CAS、cursor、事务回滚和确定性恢复。

## 测试环境与变量

Runner 使用最小环境白名单、隔离用户/临时目录和动态端口，不复制整个 `process.env`。Python 使用固定包根与 `-B -P -m`，不继承外部 `PYTHONPATH`。原生 fixture 的 `OPENAI_API_KEY` 是 runner 写入的固定假值。

| 变量 | 用途 |
| --- | --- |
| `BOT_TEST_PYTHON` | 明确指定的 Python 3.12/3.13 测试解释器，不代表生产解释器 |
| `BOT_TEST_TMP` | 工作区或 CI 的测试临时根；每次运行创建子目录并清理 |
| `BOT_TEST_WEB_TOOLS_SOURCE` | 可选本地 `dsh-web-tools` fixture；仅接受当前 checkout 内且包名已验证的目录 |
| `BOT_TEST_ANALYSIS_KEY` | 明显假的凭据传递 fixture，不调用真实服务 |
| `NATIVE_TEST_RESULT`、`LIFECYCLE_NATIVE_FOLDER` | runner 创建的结果文件或生命周期临时根 |
| `BOT_HOME`、`BOT_WORKSPACE_ROOT`、`BOT_PERSONAS_ROOT`、`BOT_DATA_HOME`、`BOT_PYTHON` | runner 创建或校验的隔离目录与解释器 |
| `PYTHONPATH` | runner 固定为受信 `python/` 包根，不是用户可继承的测试输入 |

不得使用共享 Harness profile、真实账号/群/用户 ID、token、Cookie、模型端点或用户 npm/pip 配置。测试变量不能写入生产配置或公开 Issue。

## 人工验收

- fixture 通过不等于 QQ/微信真实投递；health/probe 通过不等于媒体质量、完整音频或试听通过。真实平台与外部模型服务由运营者单独验收。
- 检查中英词条和占位符一致，英文标签在宽屏及 760px、460px 布局可用，语言切换保留草稿。
- 固定机器人提示语言独立于 UI；保存后持久化，新操作使用新语言，进行中的轮次保留原语言。人格文本、用户内容和 TTS 参数不随切换改写。
- 未登记能力继续显示 `missing`/`blocked`，不静默换服务。测试不承诺 V3 人格迁移、第三方 Adapter ABI 或外部服务结果。
- 源码中的 `python -B tests/benchmark_media_transform.py --repeats 3` 可复现合成素材基准并自动清理临时产物；不含网络、模型或平台投递，不是性能承诺。

## CI 与失败处理

| CI job | 范围 |
| --- | --- |
| Linux `quality` | Node 24、Python 3.12、源码发布门禁与 npm/Python 依赖审计 |
| Windows `release-gate` | Python 3.12、FFmpeg、实际归档验证与三项原生/安装测试 |
| Windows `python-compatibility` | Python 3.13 的固定依赖安装与 `pip check` |

失败即停止对应流程，保留错误类别、阶段和必要的脱敏尾部输出；不要自动逐文件重跑来掩盖原始失败。所有子进程树、服务器、timer、launcher state 和临时目录须在 `finally` 清理。

CI 只上传依赖审计 JSON 与 `.codex/*-evidence/` 中的脱敏失败诊断；成功后清理测试文件，归档验证后删除 `.tgz`。证据不得包含凭据、Authorization、Cookie、用户 ID、数据库、完整日志、本机路径或模型权重。
