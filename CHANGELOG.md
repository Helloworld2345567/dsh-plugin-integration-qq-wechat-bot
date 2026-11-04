# 变更记录

本文件记录面向使用者和维护者的可验证变化。未列出的英文 UI、第三方 Adapter ABI 或外部服务验收不应被视为已完成。

## [0.2.10] - 2026-11-03

### 阶段 0：发布加固（已完成）

- 加强构建、发布包内容、敏感信息、路径和归档安全边界。
- 保留 Harness 原生测试、生命周期测试和独立安装 smoke 作为发布前证据。

### 阶段 1：插件元数据与主题契约（已完成）

- 对齐插件元数据、中文 locale、图标和主题契约。
- 保持当前项目仅支持中文；英文 locale/UI 不在本版本范围内。

### 阶段 2：开源治理与依赖安全（已完成）

- 增加贡献、安全、行为准则、支持和变更记录文档，以及 Issue/PR 模板和 Dependabot 配置。
- 将 lockfile 的 resolved 来源统一为 npm 公共 registry，并将 `ws` 安全补丁版本更新到 `8.22.1`；未升级 DeepSeek Harness、Cordis 或其他 Harness 核心包。
- 增加依赖审计、许可证/来源检查、Markdown/CI 配置检查和实际临时归档验证。
- 明确 Python 3.12/3.13、基础媒体依赖与可选 voice-generation 依赖的边界，并记录当前安全审计中必须暂缓的 Harness 间接依赖。
- 完善第三方声明：无法从当前 checkout 验证的上游 commit/tag 不作猜测；AGPL/PolyForm 项目仅作参考或外部可选集成时单独说明。

### 阶段 3：安装、配置与运维契约

- 增加统一快速开始、实际环境变量配置参考、安全 `.env.example` 和结构化排障文档。
- 明确已有 Harness profile 与独立产品 profile 的安装、停止、升级、回滚和卸载责任边界。
- 将 image-generation 技能修正为 V4-only 人格契约；不承诺 V3 迁移或回退。
- 扩展 lifecycle bundle 文档，明确受监督失败恢复、一次回滚、未知结果不重放和无第三方 Adapter ABI 承诺。
- 增强 Markdown 本地链接/锚点、CI 结构、发布包文档包含性和敏感内容检查。

### 阶段 4：开发与测试契约

- 增加 Windows 开发入口、测试分层、CI 对照和外部验收边界文档。
- 增加只读环境预检，统一 Node/Harness/Python、FFmpeg/ffprobe、基础与可选 Python 依赖状态。
- 将 TypeScript、Python 和三项 Harness 原生验收改为最小环境白名单、隔离 HOME/临时目录、动态端口、受控输出和进程树清理。
- 增加文档命令、CI 版本、测试变量、发布门禁和测试 runner 隔离契约检查；未改变 QQ/微信业务、权限、媒体、凭据、人格或 lifecycle 运行语义。
