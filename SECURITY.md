# 安全政策

## 支持范围

当前只支持最新 `0.2.x` 小版本（当前版本为 `0.2.10`）和仓库 `main` 上仍受维护的安全修复。更早版本、未发布的本地修改以及不兼容的 Harness 运行时不在支持范围内。插件当前要求 DeepSeek Harness `0.2.1-rc.2`；这不是承诺该运行时的所有上游间接依赖都可以独立升级。

## 报告漏洞

请使用 GitHub 的私有漏洞报告入口：

<https://github.com/Helloworld2345567/dsh-plugin-integration-qq-wechat-bot/security/advisories/new>

如果入口暂时不可用，请先通过维护者的 GitHub 私下渠道联系并请求安全报告方式，不要在公开 Issue、PR、讨论区或平台群聊中粘贴漏洞细节。报告应包含受影响版本、最小复现步骤、影响范围和建议修复方向；请尽量删除真实数据。

维护者会确认收到报告，评估严重性和受影响范围，并在修复或缓解措施可公开后更新公告。请不要在修复发布前公开披露尚未协调的漏洞。

## 报告中禁止包含的内容

无论是安全报告还是普通 Issue，都不要公开：

- API key、cookie、密码、Harness credentials、QQ/微信 token 或其他凭据；
- QQ 号、微信用户 ID、群 ID、消息内容或真实附件；
- 平台 token、下载签名、带授权参数的 URL 或本机绝对路径；
- 未脱敏日志、数据库、会话文件、模型权重和运行时归档。

渠道凭据必须使用 Harness credentials 服务；不要把凭据写入 persona、仓库文件、命令行参数或发布包。

## 供应链和归档边界

- npm 安装由 `package-lock.json` 和公共 npm registry 的 integrity 校验约束；依赖审计中的 Harness 固定版本和其间接依赖暂缓项记录在 [依赖审计](docs/dependency-audit.md) 中。
- 不运行 `npm audit fix` 或 `npm audit fix --force` 作为自动修复。升级 Harness、Cordis 或其他核心包前必须证明兼容当前运行时并完成原生测试。
- Python 的基础依赖和可选 voice-generation 依赖分开；外部 Music、RVC、GPT-SoVITS、CUDA、模型权重和外部服务不属于主包供应链。
- 发布包通过 `npm run check:release` 和实际临时归档检查；归档不得包含运行时数据、凭据、数据库、日志、模型权重、`.codex`、`.runtime`、`node_modules` 或临时 `.tgz`。
- 第三方声明和来源边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
