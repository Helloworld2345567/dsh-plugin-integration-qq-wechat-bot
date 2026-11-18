# 开发指南

简体中文 | [English](en/development.md)

本页用于源码开发；部署见[快速开始](getting-started.md)。双语维护规则见[贡献指南](../CONTRIBUTING.md#双语维护规范)。

面板 UI 重构和扩展遵循 [UI 设计与扩展指导](ui-design-guidelines.md)。

## 初始化

准备 Node.js 24+、Python 3.12 或 3.13、`ffmpeg` 和 `ffprobe`。Harness 固定为 `0.2.1-rc.5`，由 npm 安装；Windows 使用 PowerShell 7。基础开发不需要平台凭据、CUDA、模型权重或外部媒体服务。

在仓库根目录执行：

```powershell
npm ci
python -m pip install -r requirements.txt
# 需要验证可选 Edge TTS 时：
python -m pip install -r requirements-voice-generation.txt
npm run check:environment
```

环境检查只读，不连接平台；缺少可选 voice-generation 显示 `OPTIONAL`，基础依赖、版本或 FFmpeg 缺失需先修复。CI 使用 `requirements-ci.txt` 与 `requirements-voice-generation-ci.txt` 固定测试版本。

## 目录与开发边界

TypeScript 实现在 `src/`，媒体实现在 `python/dsh_bot_runtime/`，技能声明在 `skills/`，测试在 `tests/`。独立生命周期 bundle 由 `packages/bot-lifecycle/` 自行构建；根构建会调用它，禁止手工复制协议或摘要算法。详细职责、依赖方向和扩展步骤见[架构边界](architecture-boundaries.md)。

普通测试使用 fixture、临时 profile 和最小子进程环境，不读取共享 Harness profile 或真实凭据，不调用外部平台与模型服务。Python 包根由 runner 指定，不能继承调用方 `PYTHONPATH`。运行数据和临时产物不得提交或进入发布包。

## 按变更选择验证

先确定要检测的失败，再选择相应命令。下面是变更提交前的最低范围；完整命令用途与测试环境见[测试契约](testing.md)。

| 变更 | 检查 |
| --- | --- |
| 文档 | `npm run check:docs`；命令或运行版本变化加 `npm run check:contracts`；发布文件变化加 `npm run check:release` |
| TypeScript 核心或构建脚本 | `npm run check:architecture`、`npm run typecheck`、`npm test`、`npm run build`；跨 Python 协议加 `npm run test:python` |
| Python worker | `npm run check:architecture`、`npm run test:python`、`npm run check:python-dependencies`；变更包入口时验证归档中的 `-P -m dsh_bot_runtime.worker` |
| 技能声明或路由 | `npm run generate:skills`、`npm run test:skills`；Python 实现变化再运行 Python 测试 |
| UI 或语言资源 | `npm run typecheck`、`npm test`、`npm run build`；验证中英文切换、占位符和草稿保留 |
| lifecycle | 源码门禁及 `npm run test:lifecycle-native`；安装流程变化加 `npm run test:install-smoke` |
| 安装器或发布内容 | `npm run release:pack`、`npm run test:install-smoke` |

## 发布与原生集成

`npm run verify:release` 执行统一源码门禁。需要实际归档时直接执行 `npm run release:pack`，它先运行同一门禁，再生成、校验并删除临时 npm 归档，不上传或发布。

原生集成另行运行，三者覆盖范围不同：

```powershell
$env:BOT_TEST_PYTHON = (Get-Command python).Source
npm run test:native
npm run test:lifecycle-native
npm run test:install-smoke
```

这些测试使用本地 fixture，不创建真实 bot、不发送平台消息。PR 记录实际结果及未运行项；真实平台投递、媒体质量和试听须由运营者单独验收。失败只保留必要的脱敏诊断，测试结束停止子进程并清理临时目录。
