# 依赖与供应链审计

简体中文 | [English](en/dependency-audit.md)

本文件记录阶段 2 的可复核基线，不把安全工具的非零计数伪装成“零漏洞”。审计日期为 2026-11-03，工作树使用 Node 24.17.0、npm 11.13.0 和 Python 3.13.14；CI 仍覆盖 Python 3.12。

## 来源与可复现安装

- `package-lock.json` 是 lockfile v3，所有 `resolved` 归一到 `https://registry.npmjs.org/`，同时保留 npm integrity。项目根 `.npmrc` 明确该公共 registry；未把区域或私有镜像作为隐含供应链。
- `npm ci` 使用 lockfile，不运行 lifecycle 脚本以外的项目安装逻辑；发布检查使用 `npm pack --ignore-scripts`。受限网络可通过 `npm_config_registry`、命令行 `--registry` 或组织缓存显式覆盖下载端点，但不应改写提交的公共 registry resolved 来源。
- `requirements.txt` 和 `requirements-voice-generation.txt` 是用户输入文件，保留兼容范围；安全修复要求的 Pillow 版本范围从 `>=10,<13` 收紧为 `>=13,<14`。`requirements-ci.txt` 与 `requirements-voice-generation-ci.txt` 记录当前 CI 验证用的精确版本，但不把 Python 环境或外部服务打进主包。
- 基础媒体依赖与可选 voice-generation 依赖分离。Music、RVC、GPT-SoVITS、CUDA、模型权重和外部服务不在 npm 或 Python 主依赖中。
- 阶段 5 静态 import 审计确认 vendored 网络模块直接导入 `yarl`；因此用户范围显式声明 `yarl>=1.17,<2`，CI 快照使用已随 aiohttp 环境验证的 `1.25.1`。这消除对传递安装的隐式依赖，不新增网络能力。

## npm 审计结果

本次执行过：

```text
npm audit --json
npm ls --all
npm outdated --json
```

快照结果为 `196` 个报告项：`189 high`、`7 moderate`、`0 critical`、`0 low`。`npm audit --omit=dev --json` 与包含开发依赖的结果相同，说明本次非零结果不是开发依赖单独造成的。`npm ls --all` 成功；`npm outdated` 的主要差异来自 Harness 上游候选版本和跨大版本工具升级。

### 运行时漏洞与暂缓项

| 范围 | 结果 | 处理 |
| --- | --- | --- |
| DeepSeek Harness `@deepseek-ai/dsh` 及其 `0.2.1-rc.5` 子包 | 高危报告项，直接运行时依赖和大量固定间接包 | 暂缓。当前插件的扩展行为和 peer 契约绑定 `0.2.1-rc.5`；升级候选至少涉及兼容性变化，不能用 `audit fix --force` 代替原生验收。 |
| `undici` | 由 Harness/其 LLM 依赖引入的运行时高危报告项 | 暂缓到兼容的 Harness 版本；不是本项目直接声明依赖。 |
| `zod` < 4.6.6 | 仅出现在 Harness 子树中的旧嵌套版本；顶层直接版本为 4.6.7 | 暂缓到 Harness 兼容升级；不能强行 override 破坏 Harness 的 peer/运行时契约。 |
| `@modelcontextprotocol/client` 2.2.0 | Harness MCP 子树中的中危报告项 | 暂缓到 Harness 兼容升级；本项目不直接调用它的业务 API。 |
| `fflate` 0.8.2 | Harness LibreOffice 子树中的中危报告项；其他路径已为 0.8.3 | 暂缓到 Harness 兼容升级。 |

审计脚本 `npm run audit:dependencies` 只允许上表中已记录的 Harness 传递项通过，并报告实际计数；出现未记录的包、直接业务依赖漏洞或新的严重等级时会失败。该策略是“已知暂缓”，不是安全豁免或零漏洞声明。

### 可安全处理的直接依赖

- `ws` 从 `8.22.0` 更新到 `8.22.1`，仍在 Node 24 支持的同一 major 内，许可证为 MIT，lockfile integrity 已更新。已运行类型检查、TypeScript/Python 测试、构建和发布检查。
- `yaml`、`zod`、`json-bigint`、`qrcode`、`silk-wasm` 和开发工具没有在本次审计中发现需要强制升级的直接漏洞。大版本 TypeScript、esbuild、Node types 或 Harness 候选不因 outdated 输出而盲目升级。
- `@deepseek-ai/dsh`、Cordis 及其 Harness peer 包保持 `0.2.1-rc.5` / `~4.0.5`；本阶段没有证明更高版本兼容，因此不升级。

## Python 审计

用户范围和 CI 快照分别为：

| 文件 | 用途 | 版本策略 |
| --- | --- | --- |
| `requirements.txt` | 用户安装的基础媒体/文档/下载依赖 | 兼容范围；支持 Python 3.12/3.13，具体 wheel 由 pip 解析 |
| `requirements-voice-generation.txt` | 可选 Edge TTS | 兼容范围；不安装不会影响基础机器人和媒体能力 |
| `requirements-ci.txt` | CI 可复现验证 | 2026-11-03 测试版本精确记录 |
| `requirements-voice-generation-ci.txt` | CI 可复现可选 TTS 验证 | 2026-11-03 测试版本精确记录 |

本次 `python -m pip check` 通过。初始 Python 审计在 Pillow `12.3.0` 上报告 39 个 Pillow 漏洞；它们均有 `13.0.0` 修复版本。本阶段将用户范围收紧为 `Pillow>=13,<14`，CI 快照使用 `13.0.0`，并在升级后重新运行 `pip-audit`：基础依赖和可选 Edge TTS 当前均报告 `vulns: []`。许可证清单使用 `pip-licenses --from=mixed --format=json` 复核；审计工具只在临时环境运行，不进入主包。

维护者可复核：

```powershell
python -m pip install -r requirements-ci.txt -r requirements-voice-generation-ci.txt
python -m pip install pip-audit==2.10.1 pip-licenses==5.5.5
pip-audit -r requirements.txt -r requirements-voice-generation.txt
pip-licenses --from=mixed --format=table
```

许可证风险边界：基础依赖的许可证以安装包元数据和上游声明为准；`edge-tts` 的 LGPLv3 仅属于可选依赖，部署者应保留其上游声明。`pypdfium2` 还涉及 PDFium 及其依赖许可，不能只按 Python wrapper 的许可证判断。`yt-dlp` 当前元数据标注 Unlicense，使用者仍需遵守目标站点和媒体内容规则。

## 决策原则

1. 不直接执行 `npm audit fix` 或 `npm audit fix --force`。
2. 每次直接依赖升级都必须说明原因、许可证和上游来源，并通过 Node 24、Harness `0.2.1-rc.5`、Windows、完整测试和发布检查。
3. Harness 固定版本的风险记录为“不可独立升级的已知暂缓项”；在上游兼容版本可验证前，不通过 override、patch 或删除审计结果来降低数量。
4. lockfile 变更必须使用公共 registry、保留 integrity，并在受限网络中由缓存/镜像配置显式控制，而不是提交隐含镜像地址。
