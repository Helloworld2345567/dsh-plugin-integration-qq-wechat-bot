# 开发指南

本页是贡献者的开发入口，不是生产部署说明。项目当前只支持简体中文；英文 locale/UI、V3 人格迁移或回退、第三方 Adapter ABI 和外部平台/模型验收不在本阶段范围内。

## Windows 前置条件

在全新 checkout 上，使用 Windows 10/11 与 PowerShell 7，并准备：

- Node.js 24 或更高版本；
- Python 3.12 或 3.13；
- DeepSeek Harness `0.2.1-rc.5`（由 `package.json` 的 engine 和依赖固定）；
- 可从同一 PowerShell 调用的 `ffmpeg` 与 `ffprobe`；
- 可访问 npm registry 的网络（仅安装依赖时需要）。

基础开发和测试不需要 QQ/微信凭据、CUDA、RVC、GPT-SoVITS、Music 或模型权重。Edge TTS 是可选 voice-generation 层；Music、RVC、GPT-SoVITS 和其他外部服务由运营者单独部署。

## 全新 checkout 初始化

在仓库根目录按以下顺序执行。命令均已存在于当前 `package.json`，不要用未实现的别名替换：

```powershell
npm ci
python -m pip install -r requirements.txt
# 需要验证可选 Edge TTS 时再执行：
python -m pip install -r requirements-voice-generation.txt

npm run check:environment
npm run check:architecture
npm run typecheck
npm test
npm run test:python
npm run check:python-dependencies
npm run build
npm run check:docs
npm run check:contracts
npm run check:licenses
npm run check:release
```

`check:architecture` 是只读、离线的静态模块图门禁；它检查 runtime import 循环、client/core/channel/Harness/lifecycle/Service Adapter/测试/package 边界、Python 单一命名空间、路径修改／裸内部 import／动态 module key、固定 skill entry 以及构建入口漂移。它还要求 lifecycle 从 `packages/bot-lifecycle/src/index.ts` 构建、子包不越界导入根 `src/`、主包/coordinator 都声明版本化 contract、发布 export/files 完整且旧 `src/lifecycle/` 不得复活。持久化边界同样是门禁的一部分：只有 `src/infrastructure/sqlite/` 可导入 `node:sqlite`，只有 `src/infrastructure/` 可准备 SQL 或持有数据库句柄，业务层不得导入 repository 实现，`src/core/store.ts` 与 `src/infrastructure/sqlite/store.ts` 两个历史 facade 均不得复活。输出仅包含仓库相对路径。完整规则见[架构边界契约](architecture-boundaries.md)。

`check:environment` 是只读、离线优先的预检：它不会修改 Harness profile、安装依赖、启动平台连接或打印环境变量。可选 `voice-generation` 缺失只显示 `OPTIONAL`，基础 Python 依赖、Python 版本、Node/Harness 版本、FFmpeg/ffprobe 或 lockfile 缺失才会阻止流程。

需要完整发布证据时再执行：

```powershell
npm run verify:release
npm run release:pack
$env:BOT_TEST_PYTHON = (Get-Command python).Source
npm run test:native
npm run test:lifecycle-native
npm run test:install-smoke
```

其中 `verify:release` 是源码门禁；`release:pack` 会先运行同一门禁，然后在临时目录实际生成并校验 npm 归档；三个 `test:*native`/`install-smoke` 是 Harness 原生集成、生命周期原生集成和独立安装验收，不互相替代。它们默认使用 fixture/local provider，不创建真实 bot、不连接 QQ/微信，也不发送平台消息。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| `src/` | TypeScript 运行时、渠道适配器、管理 API 与管理面板 |
| `python/dsh_bot_runtime/` | 唯一 Python 公共命名空间：worker、共享媒体组件、service runner、vendored video core 与 skill 实现 |
| `python/*.py` | 仅保留 worker／RVC／extractor 的薄 CLI 兼容入口，不放可复用实现 |
| `skills/` | 技能说明、references 与 `operations.json` 固定 entry；不放 Python 代码 |
| `packages/bot-lifecycle/src/` | coordinator、integrity、protocol、bundle entry 和双方共享的版本化 contract 单一源码；不得导入根 `src/` |
| `scripts/` | 构建、安装、启动、发布门禁和测试辅助脚本 |
| `tests/` | TypeScript、Python、Harness fixture 与契约测试 |
| `docs/` | 用户、贡献者、运维和架构文档 |

根 `npm run build` 会调用 lifecycle 子包自己的 `scripts/build.mjs`，生成源码摘要和输出 hash；`npm --prefix packages/bot-lifecycle run verify:build` 在 prepack 前拒绝陈旧 dist。不得手工复制 protocol、identity 或 hash 算法到主包。

运行数据、Harness profile、凭据、数据库、日志、npm 临时归档、测试证据、`.codex/`、`.runtime/` 和 Python 缓存不属于源码目录，也不得提交或进入发布包。

## 开发安全边界

- 普通测试不得使用真实 QQ/微信 token、账号/群/用户 ID、Harness credentials、API key、Cookie 或真实服务端点。
- 测试不得向 QQ/微信发送消息，不得调用真实外部模型、TTS、Music、RVC 或 GPT-SoVITS 服务；需要网络行为时使用 fixture 或明确的本地测试服务器。
- 测试子进程使用最小环境白名单；Python 测试与 worker 的 `PYTHONPATH` 只能由 runner 设置为当前受信 `python/` 包根，不得继承调用方值或复制整个 `process.env`。
- 不要直接修改共享 Harness profile；测试使用临时 `BOT_HOME`、`BOT_WORKSPACE_ROOT`、空 npm 配置和 fixture credentials。
- 不要将真实端点、用户 ID、完整日志、数据库、运行数据、签名 URL 或模型权重提交到仓库。
- 不要升级 `@deepseek-ai/dsh`、Cordis 或其他 Harness 核心包来绕过测试失败；兼容版本固定为阶段 3 已确认的契约。

## 变更类型与最低验证

| 变更类型 | 最低验证 |
| --- | --- |
| 纯文档 | `npm run check:docs`；若涉及命令/版本契约，再运行 `npm run check:release` |
| 构建/脚本 | `npm run check:architecture`、`npm run typecheck`、`npm test`、`npm run build`、`npm run check:release` |
| TypeScript 核心 | `npm run check:architecture`、`npm run typecheck`、`npm test`、`npm run test:python`、`npm run build` |
| Python worker | `npm run check:architecture`、`npm run test:python`、`npm run check:python-dependencies`、`npm run build`；媒体相关变更需确认 FFmpeg/ffprobe，并验证归档内 `-P -m dsh_bot_runtime.worker` |
| lifecycle | 上述源码门禁、`npm run test:lifecycle-native`；涉及安装时加 `npm run test:install-smoke` |
| 安装器/发布 | `npm run check:release`、`npm run verify:release`、`npm run release:pack`、`npm run test:install-smoke` |
| UI/locale | `npm run typecheck`、`npm test`、`npm run build`、`npm run check:docs`、`npm run check:release`；当前阶段仍只支持中文 |

外部平台、外部模型、真实 TTS/Music/RVC/GPT-SoVITS 结果由运营者按独立验收流程完成，不得用本地 fixture 结果替代。

## 提交前证据

PR 或本地提交说明应列出实际运行的命令、结果和未运行项目。失败证据只能保留必要的脱敏错误分类和短日志；删除凭据、Authorization、Cookie、用户/群 ID、绝对路径、数据库、完整消息和模型文件。没有明确授权时禁止 push、publish 或发送任何平台消息。
