# QQ / 微信 Harness 插件

为 DeepSeek Harness 提供 QQ 与微信机器人接入、多人格配置、会话管理和媒体能力。

## 功能

- QQ 官方渠道与微信 iLink 渠道
- 多 bot、独立会话和会话级身份隔离
- 人格、模型、工具和技能的版本化配置
- 图片生成、图片理解、音频识别和视频分析
- media-analysis 统一处理抖音/B站免登录链接解析、视频下载与分析、图集和网页原图下载
- 受控文件、媒体与消息投递
- 统计、失败记录和可恢复的生命周期管理
- React 管理面板，支持配置热切换并在下一轮生效

## 环境要求

- Node.js 24+
- Python 3.12+
- DeepSeek Harness 0.2.1-rc.2
- 音频和视频处理需要 `ffmpeg` 与 `ffprobe`

## 安装

```bash
npm ci
npm run build
```

将构建产物安装到 Harness 后启动 `bots` profile。打开 Harness 设置页，在“机器人面板”中完成渠道、账号和人格配置。

媒体脚本依赖见 `requirements.txt`。如果已有可用的 Python 环境，可通过 `BOT_PYTHON` 指定解释器。

## 配置

1. 在 Harness 模型设置中配置聊天模型和凭据。
2. 在机器人面板创建或选择人格，设置模型、工具、技能和媒体能力。
3. 创建 bot，绑定人格并完成对应渠道的授权。
4. 启动 bot，随后即可在 QQ 或微信中使用。

配置文件由 `config.json` 和 `persona.md` 组成，生效版本由 SQLite 保存。修改配置后从面板应用，变更在下一轮生效；当前轮继续使用已冻结的配置。

可信私聊用户可使用人格允许的受控工具。权限在执行时再次检查，撤销后立即阻止后续调用。

## 常用命令

```bash
npm run typecheck
npm test
npm run test:python
npm run build
npm run check:release
```

`npm run test:native`、`npm run test:lifecycle-native` 和 `npm run test:install-smoke` 用于更完整的 Harness 集成检查。

## 项目结构

```text
src/       TypeScript 运行时、渠道适配器、管理 API 和面板
python/    媒体处理 worker
skills/    图片与媒体技能
packages/  可独立安装的辅助 bundle
scripts/   构建、安装、启动和验证脚本
docs/      项目架构文档
tests/     TypeScript 与 Python 测试
```

## 许可证

MIT。第三方依赖和来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

架构说明见 [docs/architecture.md](docs/architecture.md)，贡献和仓库约束见 [AGENTS.md](AGENTS.md)。
