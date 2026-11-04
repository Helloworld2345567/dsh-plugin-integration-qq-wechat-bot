# 贡献指南

感谢参与本项目。项目当前只维护中文界面；本文件描述的是代码、文档和发布流程，不代表已经提供英文 UI。

## 开发入口与测试契约

首次初始化、目录职责、测试安全边界和按变更类型的最低验证见[开发指南](docs/development.md)；测试分层、变量分类、CI 对照和脱敏证据要求见[测试契约](docs/testing.md)；模块职责、合法依赖方向和扩展限制见[架构边界契约](docs/architecture-boundaries.md)。前两页是贡献者命令的唯一维护入口。

## 开发环境（Windows）

- Windows 10/11，PowerShell 7。
- Node.js 24 或更高版本；`package.json` 中的 Harness 运行时固定为 `0.2.1-rc.2`。
- Python 3.12 或 3.13。基础媒体依赖安装自 `requirements.txt`，Edge TTS 是可选依赖，安装自 `requirements-voice-generation.txt`。
- `ffmpeg` 和 `ffprobe` 可从 PowerShell 直接调用。
- QQ、微信、Music、RVC、GPT-SoVITS、CUDA 和模型权重不是开发依赖，不应加入主包或 CI。

不要把本机 Harness profile、运行数据、凭据、用户 ID 或服务端点复制到仓库。

## 安装

```powershell
npm ci
python -m pip install -r requirements.txt
# 需要语音生成时再安装：
python -m pip install -r requirements-voice-generation.txt
```

CI 使用经过记录的测试版本文件 `requirements-ci.txt` 和 `requirements-voice-generation-ci.txt`；它们用于可复现的 CI 验证，不替代用户输入文件。

## 本地验证

提交前至少运行：

```powershell
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
npm run verify:release
npm run release:pack
$env:BOT_TEST_PYTHON = (Get-Command python).Source
npm run test:native
npm run test:lifecycle-native
npm run test:install-smoke
npm run audit:dependencies
```

`test:native` 需要可运行的 Harness 原生环境，安装 smoke 需要设置项目约定的测试 Python 解释器。没有 Harness 或外部平台凭据时，应在 PR 中说明哪些验收未运行及原因，不要用模拟结果替代。

发布检查使用：

```powershell
npm run release:pack
```

该命令只在临时目录生成归档，验证归档内容后清理临时文件；不会提交或发布包。不要直接运行 `npm audit fix` 或 `npm audit fix --force`，依赖升级必须逐项评估。

## 依赖和许可证

- `package-lock.json` 使用 npm 公共 registry 的完整性校验；不要把区域镜像写入 lockfile。
- `@deepseek-ai/dsh`、Cordis 和同一 Harness 运行时的 peer 包固定在当前兼容版本，未经兼容性证明不得升级。
- 新增或升级依赖时，在 PR 中说明原因、运行时/开发时范围、许可证、上游地址、Node 24 和 Windows 验证结果。
- 修改 Python 依赖时，同时更新版本范围、CI 测试版本说明和 `THIRD_PARTY_NOTICES.md`；不要把 CUDA、模型、RVC 或 Music 项目带入主依赖。
- 供应链或许可证无法确认时先停止合并，并补充来源证据；不要凭猜测填写 commit、版权人或许可证。

## 分支、提交和 PR

- 从最新 `main` 创建短生命周期分支；不要直接改写共享分支历史。
- 提交信息使用简洁的动词开头，建议遵循 `type: summary`，例如 `chore: ...`、`fix: ...`、`feat: ...`。
- 一个 PR 聚焦一个问题，说明行为变化、兼容性边界、依赖/许可证影响和回滚方式。
- PR 必须附上实际运行的命令和结果；如果跳过 Harness 原生测试、平台验收或外部服务测试，必须明确写出原因。
- 不要在没有明确授权时 push、publish 或发送 QQ/微信/其他平台消息。
- 不要在 PR 中上传凭据、运行时日志、数据库、用户数据、模型权重、签名下载链接或本机路径。

## 不应提交的文件

禁止提交或打包：

- `.runtime/`、`.codex/`、`node_modules/`、虚拟环境、缓存和 `__pycache__/`；
- 数据库、日志、归档（包括 `.tgz`）、临时输出和测试工作区；
- `.env`、平台 token、API key、Harness credentials、用户 ID 或签名 URL；
- RVC/GPT-SoVITS/CUDA 模型、checkpoint、索引和其他模型权重；
- 外部 Music、QQ、微信或 TTS 服务的运行数据。

凭据必须通过 Harness credentials 管理；图片服务的密钥只能由环境变量或受管配置提供。
