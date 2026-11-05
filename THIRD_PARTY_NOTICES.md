# Third-party notices

本文件只声明当前 checkout 能确认的来源和边界。没有在 checkout、依赖元数据或上游公开许可证中确认的 tag、commit、版权归属不会凭空补写。版本范围依赖的许可证应以实际安装版本的上游声明为准。

## 随本项目发布或作为运行时依赖安装

| 项目 | 上游仓库/来源 | tag 或 commit | 原始许可证 | 本项目路径/用途 | 是否修改 |
| --- | --- | --- | --- | --- | --- |
| DeepSeek Harness | <https://github.com/deepseek-ai/deepseek-harness> | npm `0.2.1-rc.2`；上游源码 commit 未在本 checkout 确认 | MIT | npm 运行时 `@deepseek-ai/dsh` 及其 peer/传递包 | 否；本项目只通过公开插件契约接入 |
| Cordis | 同上游 Harness 发行依赖 | npm `~4.0.5`；上游源码 commit 未在本 checkout 确认 | MIT（依赖元数据） | Harness peer/runtime closure | 否 |
| `json-bigint` | <https://www.npmjs.com/package/json-bigint> | npm `1.0.0`（lockfile） | MIT | 运行时 JSON 数字处理 | 否 |
| `qrcode` | <https://www.npmjs.com/package/qrcode> | npm `1.5.4`（lockfile） | MIT | 运行时二维码 | 否 |
| `silk-wasm` | <https://www.npmjs.com/package/silk-wasm> | npm `3.7.1`（lockfile） | MIT；SILK 实现保留上游声明 | 运行时语音编解码 | 否 |
| `ws` | <https://www.npmjs.com/package/ws> | npm `8.22.1`（lockfile） | MIT | QQ/微信 WebSocket 传输 | 否 |
| `yaml` | <https://www.npmjs.com/package/yaml> | lockfile 当前版本 | ISC | 配置与 patch 解析 | 否 |
| `zod` | <https://www.npmjs.com/package/zod> | lockfile 当前顶层版本 | MIT | 运行时 schema 校验 | 否 |
| TypeScript、esbuild、tsx 和 `@types/*` | 各自 npm 包仓库，版本以 `package-lock.json` 为准 | lockfile 精确版本 | 以 lockfile `license` 字段为准（MIT 或 Apache-2.0） | 开发、构建和类型检查 | 否 |

`package-lock.json` 的所有 `resolved` URL 统一为 npm 公共 registry，并保留完整性哈希。完整的传递依赖版本和许可证字段以 lockfile 为准；`npm run check:licenses` 会检查直接依赖、来源和 lockfile 许可证字段。

## 随本项目发布的复用/适配代码

### astr-bot-sakura 相关复用

- 上游仓库：<https://github.com/Helloworld2345567/astr-bot-sakura>
- tag/commit：当前 checkout 没有可验证的上游 tag 或 commit，不作猜测。
- 原始许可证：项目既有来源记录标为 MIT；发布者应在确认上游对应文件后补充精确版权行或 commit。
- 对应路径：`python/dsh_bot_runtime/skills/image_generation/`（图片客户端）、`skills/image-generation/`（技能契约）、`python/dsh_bot_runtime/social_posts.py`（社交帖子读取）以及 `python/dsh_bot_runtime/video_understanding/`（视频分析核心）。
- 是否修改：是。当前项目拆除了 AstrBot 导入，改为框架无关的 worker/service 接口，并增加会话、配额、URL 校验、媒体限制、错误分类和 Harness 受管配置。
- 这些目录实际随 npm 包发布，因此本声明随包保留；上游未确认的 commit 不应被宣传为已验证来源。

### 图片客户端

- `python/dsh_bot_runtime/skills/image_generation/image_api.py` 是本项目发布的 canonical 图片 HTTP 客户端；命名空间 worker 通过固定模块入口执行图片操作。
- 上游参考和许可证按上述 astr-bot-sakura 记录处理；本项目的 API contract 位于 `skills/image-generation/references/`，不是对第三方服务协议的再许可。
- 图片服务密钥不在代码或包中，由环境变量/受管配置提供。

### 视频分析代码（原 video_understanding_core）

- `python/dsh_bot_runtime/video_understanding/` 是随本项目发布的框架无关视频分析核心，供 media-analysis 和 singing worker 使用。
- 上游参考按 astr-bot-sakura 的既有来源记录；没有可确认的 tag/commit 就不填写。
- 当前改动包括下载地址和公网地址校验、FFmpeg 媒体探测、大小/时长/并发限制、模型输入输出 schema、错误脱敏和凭据不落盘。
- 它不包含 AstrBot 的 AGPL 实现，也不授予任何外部平台或模型的使用权。

## 仅作行为参考、未打包的项目

| 项目 | 仓库 | 原始许可证 | 本项目关系 | 部署者限制 |
| --- | --- | --- | --- | --- |
| AstrBot | <https://github.com/AstrBotDevs/AstrBot> | AGPL-3.0-or-later | 仅参考公开适配行为和协议边界；AGPL 实现未打包 | 使用 AstrBot 本身或其代码时必须遵守 AGPL；本 MIT 包不包含其代码 |
| `@tencent-weixin/openclaw-weixin` | <https://github.com/Tencent/openclaw-weixin> | MIT | 仅作 iLink 协议/行为参考；OpenClaw runtime 未打包 | 本包不包含 OpenClaw runtime 或专有 QQ connector；平台使用仍受腾讯接口和条款约束 |
| unified-chat mode | 用户授权的 `unified-chat-mode` 1.0.12 行为参考 | 许可来自项目维护者的明确授权记录 | 仅适配行为；没有外部本地路径依赖随包发布 | 不得把未发布的原始项目文件当作本包代码分发 |

这些参考项目没有被 npm 包实际打包。QQ 和 iLink 适配器是本项目根据公开 HTTP/WebSocket wire protocol 编写的代码，不是对 AGPL 参考实现的复制。

## 外部可选集成（不打包）

- Music：运营者可以在独立 Python 环境使用 <https://github.com/CharlesPikachu/musicdl>。既有项目配置记录的版本为 `2.14.2`，但该版本不是本包的锁定依赖；当前 checkout 未包含上游 commit/tag。
- Musicdl 原始许可证为 PolyForm Noncommercial 1.0.0。它不是本项目 MIT 包的一部分，也不随 npm 包或 `requirements.txt` 安装；部署者若单独安装，必须遵守其非商业分发和使用限制，并保留原始许可证。
- RVC、GPT-SoVITS、CUDA、HuBERT/ContentVec、RMVPE、模型权重和其他外部 TTS/Music 服务均不打包、不列入主 Python requirements。它们的许可证和模型条款由部署者单独审核。

## Python 依赖（当前测试快照）

用户 requirements 保留版本范围；下表是当前 CI/本机测试快照的许可证摘要，依赖自身的完整声明优先：

| 包 | 当前快照 | 许可证摘要 | 是否主包依赖 |
| --- | --- | --- | --- |
| requests | 2.34.2 | Apache-2.0 | 是 |
| Pillow | 13.0.0 | MIT-CMU（以安装包 License-Expression 为准） | 是 |
| aiohttp | 3.14.3 | Apache-2.0 AND MIT | 是 |
| yarl | 1.25.1 | Apache-2.0 | 是（代码直接导入，不依赖 aiohttp 的传递安装） |
| pypdf | 6.21.4 | BSD-3-Clause | 是 |
| python-docx | 1.2.0 | MIT | 是 |
| pypdfium2 | 5.14.0 | BSD-3-Clause、Apache-2.0 及 PDFium/依赖许可证 | 是 |
| openpyxl | 3.1.5 | MIT | 是 |
| yt-dlp | 2026.10.26 | Unlicense（以安装包 metadata 为准） | 是 |
| edge-tts | 7.3.1 | LGPLv3；可选 voice-generation 依赖 | 否，单独安装 |

Python 的完整依赖版本和安全检查说明见 [docs/python-dependencies.md](docs/python-dependencies.md) 与 [docs/dependency-audit.md](docs/dependency-audit.md)。安装者应保留上游许可证和 NOTICE；本项目不把这些许可证改写为 MIT。
