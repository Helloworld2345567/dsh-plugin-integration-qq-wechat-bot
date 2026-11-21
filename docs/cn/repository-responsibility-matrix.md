# Repository 职责与恢复

简体中文 | [English](../en/repository-responsibility-matrix.md)

应用服务只依赖 `src/core/ports/` 的窄接口，SQLite 与文件实现位于 `src/infrastructure/`。依赖方向见[架构边界](architecture-boundaries.md)。本页保留业务约束；具体方法、表和错误码以对应端口、adapter 与测试为准。

## 责任划分

| 边界 | 主要端口 | 必须保留的约束 |
| --- | --- | --- |
| bot / persona | `BotRepository`、`PersonaConfigRepository` | bot ID 与渠道账号归属；persona revision 单调递增，写入检查 expectedRevision；文件 journal 与生效版本一致 |
| 会话与绑定 | `SessionRepository`、`BindingRepository` | scope 所有权；binding 与 session 原子更新；reset/activate 推进 generation；分页绑定筛选与集合 revision |
| 入站消息与记忆 | `InboxRepository`、`MemoryRepository` | 入站按 scope/message ID 幂等；记忆更正使用 version CAS，forget tombstone 防止旧来源复活 |
| 附件与媒体任务 | `AssetRepository`、`MediaJobRepository` | 附件记录与索引同事务；scope、来源会话与实际路径有明确归属；任务状态持久化 |
| 投递 | `DeliveryRepository`、`DeliveryQueueRepository` | QQ 回复序号与投递记录在同一事务写入。重试复用原记录和序号，结果未知时须人工确认 |
| 自动化 | `AutomationRepository` | schedule/proactive 与运行记录归 scope/bot；启动恢复启用计划，保留中断记录 |
| 统计 | `StatsDataPort`、`StatsProjectionRepository`、`StatsSessionRepository` | 事实幂等、投影可重建；缺少证据时保持 unknown，不伪造统计 |
| 受管服务 | `ProfileRepository`、`CapabilityAcceptanceRepository`、`ServiceHealthRepository`、`ServiceStateRepository` | Profile revision 不可变，content hash 绑定配置/资源；验收绑定修订，health/fence/job 独立持久化 |
| 运行与诊断 | `RuntimeOwnershipRepository`、`EvolutionRepository`、telemetry ports | 单数据目录运行所有权；演进 phase 持久化；指标 ownership 不可变，session action 有显式状态 |
| 工作区与历史 | `HistoryLocationRepository`、`ChatHistoryPort`、`BotHistoryPort`、`WorkspacePort` | 路径由渠道身份推导；历史按需原子导出；删除仅处理该 bot/会话拥有的文件 |
| 渠道与交互状态 | `CursorStore`、`MusicStateRepository`、`SingingStateRepository`、`VoiceLibrarySettingsRepository` | 渠道 cursor 按渠道/bot 隔离；音乐/翻唱候选绑定 scope、session generation，不跨会话复用 |

底层 `records` 没有公开业务端口。其 kind 和读写只由所属基础设施 adapter 控制；需要 legacy 数据或故障注入的测试通过 `tests/sqlite-fixtures.ts`。

## 事务与冲突

`SqlitePersistence` 管理单连接，`UnitOfWork.transaction` 承载多步原子操作，嵌套复合写入使用 savepoint 或复用外层事务。拆分代码不得把原有原子操作改成独立提交。外部文件 journal 与数据库提交按所属 adapter 的恢复顺序处理，不能假定文件 I/O 也受 SQLite 回滚保护。

新端口输入须包含明确 scope/identity，分页使用强类型 request/cursor。保留已有 revision/CAS 和错误类别：例如 `ConflictError`、`SESSION_OWNERSHIP_MISMATCH`、`PAGE_CURSOR_MISMATCH`、`PAGE_STALE`、`PAGE_CURSOR_INVALID` 及 Profile revision/content hash 错误。新增兼容性或 schema 变化应单独说明，不能藏在职责调整里。

## 启动恢复

| 持久状态 | 恢复行为 |
| --- | --- |
| 入站 `processing` | 标记 `interrupted` |
| 投递 `sending` | 标记 `unknown`，不自动重发 |
| pending 进度提醒 | 标记 `cancelled`，不发送陈旧提示 |
| 媒体任务 running/queued | 标记 `interrupted`，不重放；目录清理遵守任务所有权和存活进程保护 |
| session action running | 标记 `interrupted` |
| 人格文件 journal | 先恢复 journal，再读取生效配置 |
| Service fence / job | 保留状态，确认服务状态后显式恢复 |

保留策略不得清除仍在排队、发送或未决操作所需的记录。会话、附件及任务目录清理边界见[架构概览](architecture.md#会话工作区与清理)。

## 验证入口

`npm run check:architecture` 检查 SQL 与 repository 所有权；`tests/repository-contract.test.ts` 在真实临时 SQLite 上验证重开、隔离、CAS、cursor、事务回滚和恢复。相关业务测试验证各边界行为，完整发布使用 `npm run verify:release`。
