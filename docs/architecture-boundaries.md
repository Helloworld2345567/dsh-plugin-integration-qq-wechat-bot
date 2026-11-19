# 架构边界与扩展规则

简体中文 | [English](en/architecture-boundaries.md)

本页定义源码职责与依赖方向；运行语义见[架构概览](architecture.md)，持久化细节见[Repository 职责](repository-responsibility-matrix.md)。修改生产模块后运行 `npm run check:architecture`；失败时按规则 ID 修正归属或依赖，不能用扩大白名单绕过。

## 模块职责

| 位置 | 职责与允许依赖 |
| --- | --- |
| `src/index.ts` | composition root：创建 adapter、注入端口、注册入口与生命周期；只在组装处跨层 |
| `src/core/` | 平台无关类型、策略与应用服务；依赖内部模块、Node 标准库、声明依赖及中立 lifecycle contract |
| `src/core/ports/` | 窄业务端口与强类型请求；不暴露 SQL、数据库句柄或 generic record kind |
| `src/infrastructure/` | 实现 core 端口，集中持久化与文件 I/O |
| `src/infrastructure/sqlite/` | 唯一 SQLite 连接、schema/migration、事务与 repository 实现 |
| `src/infrastructure/files/` | 人格文件、工作区文件与 journal |
| `src/channels/` | 平台协议、授权、收发和格式适配；只用 core 渠道 contract/纯策略 |
| `src/harness/` | Harness 服务、工具、管理 API、受控进程与 worker adapter；依赖 core contract/应用服务 |
| `src/client/` | 浏览器面板；只用管理 API、client 模块和 `src/core/client-contracts.ts` 的纯类型 |
| `src/i18n/` | 共享纯语言资源；不依赖 I/O、UI 状态或服务端实现 |
| `packages/bot-lifecycle/src/` | 独立 coordinator、升级/排空/回滚和 bundle 入口；不导入根 `src/` |
| `packages/bot-lifecycle/src/contract/` | 双包共享的序列化协议、artifact identity、journal 与完整性契约，只有一份来源 |
| `python/` | 媒体与服务 worker；可复用实现只在 `python/dsh_bot_runtime/`，根脚本只作薄 CLI |
| `skills/` | 说明、references、catalog 与操作声明，不存放 Python 实现 |
| `scripts/` | 显式调用的开发、构建、安装与测试工具；不成为业务实现 |
| `tests/` | 测试与 fixture，不是生产依赖 |

`src/index.ts` 的组装例外不能传递给其他模块，也不能承载可复用业务规则。core 不导入 client、具体渠道、Harness 或 coordinator 实现；只能通过端口接入。client 不导入 Node、数据库和服务端运行时。生产代码不依赖测试、fixture 或临时目录。

只有 `src/infrastructure/sqlite/` 可导入 `node:sqlite`，只有基础设施层可持有数据库句柄、准备 SQL 或访问底层 records。业务层依赖端口，不能直接导入 repository 实现。已经删除的 `src/core/store.ts`、`src/infrastructure/sqlite/store.ts` 与 `src/lifecycle/` 不得重新引入为兼容 facade。

## 跨层数据契约

- channel identity 拥有会话、附件、记忆与输出；模型不能指定可信 identity、scope、文件路径或平台目标。
- 运行任务冻结配置与 Profile revision；排队、执行、结果登记和投递继续检查取消、当前权限与 session generation。
- 私有 Profile、凭据、端点和模型路径不能进入人格公共投影或跨层错误。错误只保留稳定类别及脱敏诊断。
- 未登记能力显示 `missing`/`blocked`，不静默换服务。
- 提交后结果未知不自动重放；恢复复用原 job、Asset 与投递身份。
- Service Adapter 只接收冻结作业、受控输入和分配目录，不持有 Store、Session、渠道身份、delivery 或 Harness Context。内部接口不是第三方 ABI 承诺。

## 扩展步骤

| 新增内容 | 修改位置与必要边界 |
| --- | --- |
| 渠道 | 在 `src/channels/` 实现 `ChannelAdapter`，由 composition root 注册；平台协议不得进入 core |
| Repository | 在 `src/core/ports/` 定义含明确 scope/identity 的窄接口，在 infrastructure 实现并组装；保留原子性与恢复语义 |
| 管理 API | 在 `src/harness/admin-contract.ts` 定义校验，在 `admin.ts` 实现；client 只消费公共 DTO |
| Service Adapter | core 声明纯 contract，Harness/composition root 注入进程实现；输出 handle 由宿主验证和登记 |
| 技能 | 修改 catalog、`operations.json` 和说明，在 `dsh_bot_runtime/skills/` 实现固定 entry；重新生成 registry |
| lifecycle 能力 | 修改独立子包 contract/coordinator 与原生测试；通过窄 runtime port 排空/恢复，版本不兼容时拒绝运行 |

Python 内部使用完整 `dsh_bot_runtime...` 或明确相对 import，不修改 `sys.path`，不以文件路径制造动态模块，不接受模型提供的入口。宿主指定受信包根，以 `-P -m` 启动；不继承调用方 `PYTHONPATH`。import 不得启动网络、线程、子进程、服务器或数据库，也不得写文件、修改 profile；运行入口使用显式 `main`/`execute`。

Repository 扩展在真实临时 SQLite contract 中验证持久化、隔离、revision/CAS、cursor 和事务回滚。生命周期由子包自己的构建脚本生成，prepack 拒绝陈旧 dist；协议、identity 与 hash 算法不得复制到主包。双包设计见 [ADR 0004](adr/0004-lifecycle-bundle-compatibility.md)，Repository 设计见 [ADR 0005](adr/0005-repository-ports.md)。

## 静态门禁

`npm run check:architecture` 重新读取当前源码，不维护固定模块数量或人工审计快照。它检查 TypeScript runtime 循环、跨层 import/export/dynamic import、SQLite 所有权、生产/测试边界、Python 命名空间与 import 副作用，以及包入口、共享 contract 和发布布局。

需要逐模块清单时运行 `node scripts/check-architecture.mjs --inventory`。输出仅包含仓库相对路径；成功为 `status: PASS`，失败包含规则 ID、文件和依赖目标。该检查不代替运行测试、平台投递或外部模型验收。
