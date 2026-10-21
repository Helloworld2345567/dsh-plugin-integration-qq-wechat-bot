# bot-unified-chat

可独立打包的 DeepSeek Harness 0.2.1-rc.2 原生模式。保留 Harness 运行上下文、工具和压缩机制，在 Windows 组合原生 PowerShell 持久终端。

在项目根目录运行 `npm run build`，然后在本目录运行 `npm pack`。使用 Harness 的 `dsh plugin add <包路径>` 安装。QQ／微信集成已内置相同模式，不需再次安装此包。

模式仅提供可组合的工具环境；人格、模型及渠道权限由宿主按 Agent 安装动态提示词和执行检查。未依赖本机 unified-chat-mode，也不修改它。
