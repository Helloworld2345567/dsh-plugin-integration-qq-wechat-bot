# 依赖审计与升级

简体中文 | [English](../en/dependency-audit.md)

本页说明依赖来源、审计入口和已知暂缓项。漏洞数量随公告与 lockfile 变化，以当次报告为准；历史检查通过不代表当前无漏洞。

## 安装来源

- Node 使用 lockfile v3 和 `npm ci`；提交的 `resolved` 指向 `https://registry.npmjs.org/` 并保留 integrity。受限网络通过 registry 参数或组织缓存显式覆盖，不将私有镜像写入 lockfile。
- Python 用户范围、CI 快照、可选依赖与外部服务边界见 [Python 依赖](python-dependencies.md)。审计工具仅装入临时环境，不进入运行时包。
- 许可证清单与转发义务见[第三方声明](THIRD_PARTY_NOTICES.md)。

## 审计命令与判断

```powershell
npm run audit:dependencies
npm ls --all
```

`audit:dependencies` 报告实际漏洞计数和已知暂缓项，并拒绝未知包名、直接业务依赖漏洞、非公共 registry 来源和缺失许可证元数据。它**不按漏洞总数或严重等级变化单独阻断**，维护者仍需阅读报告中的新公告和严重等级。

需要查明版本升级范围时使用 `npm outdated`，不要直接运行 `npm audit fix --force`。直接依赖可以在兼容范围内修复；Harness 升级须验证插件和 peer 契约，不能靠强制 override 降低审计数字。

在项目 `.codex/` 下的临时 Python 环境中安装 CI 依赖及审计工具后复核，完成后删除该环境：

```powershell
python -m pip install -r requirements-ci.txt -r requirements-voice-generation-ci.txt -r requirements-audit-ci.txt
python -m pip check
pip-audit -r requirements.txt -r requirements-voice-generation.txt
pip-licenses --from=mixed --format=table
```

`pip check` 检测安装依赖冲突；`pip-audit` 发现漏洞后应确认修复版本和兼容性；许可证结果需与上游声明核对。运行这些命令前确认 `python` 和工具属于该临时环境。

## Harness 已知暂缓项

2026-11-03 的审计登记了下列暂缓范围，当前脚本仍按这些包名处理；是否已修复以本次审计结果为准：

| 范围 | 暂缓原因 |
| --- | --- |
| `@deepseek-ai/dsh*` 与 `@deepseek-ai/libreoffice-kit` | 插件绑定 Harness `0.2.1-rc.5`，需要兼容版本及原生验收 |
| `undici`、嵌套 `zod`、`@modelcontextprotocol/client`、`fflate`、`picomatch` | Harness 依赖树引入，需随兼容上游版本处理 |

这不是零漏洞声明。顶层直接业务依赖的漏洞仍会失败；同一包名下的新风险仍需评估。已知包名集合以 `scripts/audit-dependencies.mjs` 为准。

## 变更要求

升级须说明原因、来源和许可证，保留 lockfile integrity，并通过[开发指南](development.md)规定的相关测试与发布门禁。支持范围为 Node 24、Python 3.12/3.13 及当前 Harness 契约。

可选 `edge-tts` 有 LGPLv3 义务；`pypdfium2` 还涉及 PDFium 及其第三方许可，不能只看 Python wrapper。模型权重与媒体来源另有各自许可，不由主包许可证覆盖。
