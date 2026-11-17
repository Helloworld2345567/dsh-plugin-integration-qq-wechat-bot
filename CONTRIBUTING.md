# 贡献指南

简体中文 | [English](CONTRIBUTING.en.md)

开发环境使用 Node.js 24+、Python 3.12/3.13、DeepSeek Harness `0.2.1-rc.5`；Windows 使用 PowerShell 7。初始化和按变更选择检查见[开发指南](docs/development.md)，命令用途、测试隔离与 CI 见[测试契约](docs/testing.md)，模块依赖见[架构边界](docs/architecture-boundaries.md)。

## 双语维护规范

- 中文文档保留原路径；根目录和子包英文文档使用 `.en.md`，详细英文文档位于 `docs/en/`，文件名与 ADR 编号对应。
- 每对文档顶部保留 `简体中文 | English` 互链；正文优先链接同语言页面。功能、命令、配置、版本和限制须同批同步。
- UI、固定提示和诊断使用语义 key 与参数，中英文词条和占位符对应。名称、用户内容及第三方原始诊断不自动翻译。
- 内置技能及模型操作说明只维护一份英文运行指令。`npm run check:docs` 检查配对和链接，`npm run check:contracts` 检查命令一致性；翻译含义仍需人工审阅。

## 提交与评审

- 从最新 `main` 创建短期分支，提交信息说明实际变化，一个 PR 聚焦一个问题。
- PR 说明行为变化、兼容性或依赖影响、实际运行的检查与结果。未做原生集成或外部验收时写明原因，fixture 不代表真实平台或模型结果。
- 发布归档使用 `npm run release:pack`，它包含统一源码门禁与归档检查；不必先重复运行相同发布门禁。
- 没有明确授权时不得 push、publish 或发送平台消息。

## 依赖与数据

- npm lockfile 使用公共 registry；Harness 与 Cordis 版本变更须提供兼容性依据，不用升级依赖绕过测试失败，也不直接运行 `npm audit fix --force`。
- 新增依赖说明用途、来源、许可证和运行环境验证。Python 依赖变更同步需求范围、CI 测试版本及[第三方声明](THIRD_PARTY_NOTICES.md)。来源或许可证未确认前不合并。
- 凭据由 Harness credentials 管理；图片密钥通过受控环境注入。运行数据、端点、用户 ID、签名 URL、数据库、日志、模型权重、外部服务项目和本机 profile 不得提交或打包。
- 临时文件和测试产物放在项目 `.codex/` 等约定目录，使用后清理。不要提交缓存、虚拟环境、归档或构建中间产物。
