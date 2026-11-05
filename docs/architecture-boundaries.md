# 静态架构边界与维护者契约

本页把仓库当前已经存在的运行边界整理为可执行契约。它描述依赖方向，不改变 QQ／微信业务、数据库、权限、凭据、媒体、人格或 lifecycle 语义。维护者在修改生产模块后必须运行 `npm run check:architecture`；发布门禁会重复执行同一检查。

## 模块职责

| 模块 | 唯一职责 | 不拥有的职责 |
| --- | --- | --- |
| `src/index.ts` | **composition root**：打开持久化、创建 adapter 与窄端口、注入应用服务并连接生命周期 | 不定义可复用业务规则；例外只限组装 |
| `src/core/` | 与具体平台无关的领域类型、策略、应用服务和 ports contract | 浏览器 UI、QQ／微信协议、Harness Context、lifecycle 调度、SQLite 实现 |
| `src/core/ports/` | 应用层唯一可见的窄 Repository／Port contract：固定业务语义、强类型请求与 CAS／revision 表达 | 数据库句柄、原始 SQL、generic record kind、平台发送或模型调用 |
| `src/infrastructure/` | 基础设施 adapter 边界：SQLite 与文件持久化的唯一实现位置 | 业务规则、权限判断、平台消息发送 |
| `src/infrastructure/sqlite/` | 连接、schema／migration、事务、row mapping 与各 aggregate 的 SQLite adapter | 被业务层直接导入；业务规则 |
| `src/infrastructure/files/` | 人格草稿文件、工作区历史文件与文件 journal | 数据库记录、业务决策 |
| `src/channels/` | QQ／微信协议、登录、收发和平台格式适配 | Harness 管理 API、人格规则、repository 或 SQLite |
| `src/harness/` | Harness 服务接入、管理 API、工具注册及 Node 进程／worker 端口实现 | 浏览器渲染、渠道业务规则、直接 SQL 或 repository 实现 |
| `src/client/` | 浏览器管理界面，仅消费管理 API 和可共享的纯类型契约 | Node 内建模块、SQLite、渠道、Harness 服务端实现或 repository |
| `packages/bot-lifecycle/src/` | 独立产品的升级、排空、恢复、回退与 bundle 入口；从自己的源码入口独立构建 | 根包 `src/`、QQ／微信业务、真实消息发送、人格实现、业务 repository |
| `packages/bot-lifecycle/src/contract/` | 主包与 coordinator 共用的可序列化协议、artifact identity、journal 与源码完整性单一来源 | Store、Runtime、channel、delivery、persona 或 Harness 管理实现 |
| `packages/bot-lifecycle/` | 可独立安装的 lifecycle bundle 源码、构建脚本与交付物 | 主插件内部实现和渠道实现 |
| `python/` | 媒体 worker、受控服务入口和共享 Python 运行组件 | 宿主身份、权限和投递决策 |
| `skills/` | 技能声明及受控脚本入口 | 宿主 Store、凭据和平台发送 |
| `scripts/` | 开发、构建、安装、测试与发布辅助 | 被 `src/` 生产运行时隐式导入的业务实现 |
| `tests/` | 测试、fixture 和契约验证；不是生产依赖 | 发布运行时入口 |

## 允许的依赖方向

箭头表示“左侧可以依赖右侧”。所有未列出的跨层依赖默认禁止。

```text
src/client       -> 浏览器 API、src/core/client-contracts.ts（仅 type）
src/channels     -> src/core 的渠道 contract、纯策略与端口
src/harness      -> src/core 的 contract、应用服务与端口
packages/bot-lifecycle/src -> 同包 contract、Node 标准库、Cordis Plugin Manager type
src/core         -> Node 标准库、仓库依赖、src/core 内部模块、src/core/ports 与中立 lifecycle contract
src/core/ports   -> src/core 领域类型与 service contract（仅 type）
src/infrastructure -> src/core/ports、src/core 领域类型、Node 标准库（唯一 SQLite／文件持久化实现）
src/index.ts     -> src/core + src/infrastructure + src/channels + src/harness + 中立 lifecycle runtime port
scripts          -> scripts 内部纯 helper；CLI 入口显式调用副作用
Python skills    -> python 共享模块和 vendored 命名空间
```

| 调用方 | 可依赖 | 说明 |
| --- | --- | --- |
| client | client、浏览器 contract | 服务端 DTO 只能以低层纯类型表达，不能拖入实现 |
| core | core、core/ports | 具体进程、网络、Harness 能力或持久化通过端口注入 |
| core/ports | 领域类型、service contract | 只声明业务需要的窄 contract，不出现数据库句柄或原始 SQL |
| infrastructure | core/ports、领域类型 | 实现端口；SQL、migration、事务与 row mapping 只在这里 |
| channels | core | 只用公开渠道 contract；平台协议留在 adapter |
| harness | core、core/ports | 实现 core 端口并连接 Harness 服务；不接触 SQLite 或 repository 实现 |
| lifecycle | lifecycle contract | 协调器只看健康、排空、恢复和产物身份 |
| composition root | 所有生产层 | 仅创建对象、注册 effect 和连接端口 |

### Composition root 的有限例外

`src/index.ts` 可以同时导入 core、channels、harness 和 lifecycle protocol，因为它负责组装。该例外不传递：其他模块不能以“最终会被 index 导入”为由反向跨层；composition root 也不能包含可复用的渠道分支、权限判断或发送规则。

## 禁止的依赖方向

- `src/client/` 不得导入 Node-only 模块、SQLite、`src/channels/`、`src/harness/`、coordinator 或服务端 core 实现。
- `src/core/` 不得依赖 client、具体 QQ／微信 adapter、Harness 实现或 lifecycle coordinator 实现；只允许依赖中立、版本化的 `packages/bot-lifecycle/src/contract/`。
- `packages/bot-lifecycle/src/` 不得通过任何相对路径导入根 `src/`，也不得依赖 QQ／微信业务、真实发送、投递队列、Store、Runtime、channel、delivery 或人格实现。
- Service Adapter 不得拥有或导入 Store、Session、channel identity、delivery 或宿主数据库；它只接收宿主校验并冻结的作业、Profile revision、取消信号和受控端口。
- Channel Adapter 不得绕过公开 core contract 访问数据库或 Harness 内部。渠道特定的格式准备由 composition root 显式注入必要端口。
- 生产代码不得导入 `tests/`、fixture、`.codex/` 或 `.runtime/`。
- 测试 helper、测试 runner 和证据目录不得成为生产运行时的隐式依赖。
- 只有 `src/infrastructure/sqlite/` 可以导入 `node:sqlite` 或引用 `DatabaseSync`；SQL 准备、generic record 表与数据库句柄只在 `src/infrastructure/` 内出现。
- 业务层（`src/core/`、`src/channels/`、`src/harness/`、`src/client/`）不得导入任何 repository 实现或 `src/infrastructure/`；只能依赖 `src/core/ports/` 的窄 contract。
- Store facade 已删除，`src/core/store.ts` 与 `src/infrastructure/sqlite/store.ts` 均不得重新出现；应用和测试直接构造 `SqlitePersistence` 并使用窄 repository。
- Service Adapter、channel 和 lifecycle 不得导入业务 repository；Harness tool／admin 不得执行 SQL。
- `packages/bot-lifecycle/` 不得通过越界相对路径依赖根包内部源码；其发布入口必须由声明的构建入口生成。
- Python 模块 import 不得连接外部服务、监听端口、启动长期进程、修改 profile 或写入运行数据；这些行为只能在显式 `main`、`start` 或 `execute` 之后发生。

## Repository 责任表

每个业务边界只暴露应用实际需要的方法。接口定义在 `src/core/ports/`，实现位于 `src/infrastructure/sqlite/`（文件持久化在 `src/infrastructure/files/`）。contract 不暴露 `DatabaseSync`、SQL statement、generic `get`／`list`／`put` 或可拼装的 record kind。

| 业务边界 | Port（`src/core/ports/`） | SQLite／文件 adapter | 关键不变式 | 必须保留的错误码／测试 |
| --- | --- | --- | --- | --- |
| bot／persona 配置 | `BotRepository`、`PersonaConfigRepository` | `bot-repository.ts`、`persona-repository.ts`、`files/persona-files.ts` | 渠道身份不可改；revision 单向递增；人格文件 journal 先于 SQLite 提交 | `配置不存在或已归档`、`ConflictError`、`机器人不存在`；personas／core 测试 |
| session／binding／generation | `SessionRepository`、`BindingRepository` | `session-repository.ts` | binding 与 session 记录同一次写入；generation 每次重置递增；ownership 键不可伪造 | `SESSION_OWNERSHIP_MISMATCH`、`会话不存在或不属于当前渠道身份`；repository-contract |
| message／inbox | `InboxRepository` | `inbox-repository.ts` | `(scope,id)` 幂等接收；processor 状态只由显式方法推进 | 接收校验错误；core／processing-failures 测试 |
| memory | `MemoryRepository` | `memory-repository.ts` | 记忆必须逐字来自用户原文；删除保留 tombstone | `记忆长度无效`、`ConflictError`；core 测试 |
| asset／media job／quota | `AssetRepository`、`MediaJobRepository`、`MediaQuotaRepository` | `asset-repository.ts`、`media-job-repository.ts` | 附件记录与索引同一事务；quota 先检查后自增 | `MEDIA_DAILY_LIMIT`、`附件不存在或不属于当前会话`；media-assets／media-quota |
| delivery／attempt／recovery | `DeliveryRepository`、`DeliveryQueueRepository` | `delivery-repository.ts` | 同一 turn 的输出按 index 排序；unknown 不自动重放；retry 复用原 intent ID | `PROGRESS_DELIVERY_EXPIRED`；repository-contract、delivery-worker |
| automation／proactive | `AutomationRepository` | `automation-repository.ts` | 计划任务与运行记录分离；禁用后不再触发 | `SCHEDULE_*`、`PROACTIVE_*`；automation 测试 |
| statistics／projection | `StatsDataPort`、`StatsProjectionRepository`、`StatsSessionRepository` | `stats-data.ts`、`stats-projection.ts`、`stats-session-repository.ts` | 原始证据不可改写；投影可重建且缺失保持 `unknown` | stats 测试 |
| service profile／revision／acceptance／health／fence | `ProfileRepository`、`CapabilityAcceptanceRepository`、`ServiceHealthRepository`、`ServiceStateRepository` | `profile-repository.ts`、`capability-repository.ts`、`service-state-repository.ts` | revision 不可变；content hash 绑定；验收绑定 persona 与 profile revision；fence 只能由人工解除 | `PROFILE_REVISION_IMMUTABLE`、`PROFILE_CONTENT_HASH_MISMATCH`；service-contract／service-management |
| evolution／lifecycle journal | `EvolutionRepository` | `evolution-repository.ts` | 候选与安装基线分离；journal 单独持久化 | `LIFECYCLE_*`；evolution 测试 |
| runtime ownership／lock | `RuntimeOwnershipRepository`、`RuntimeLifecyclePort` | `runtime-ownership-repository.ts`、`persistence.ts` | 一个数据目录只有一个消费实例；恢复只做确定性转换 | `此数据目录已有活动 Harness 消费实例`、`STORE_CLOSED`；phase5／lifecycle 测试 |
| telemetry／failure／session action | `TurnMetricRepository`、`TurnSnapshotRepository`、`FailureRepository`、`SessionActionRepository` | `telemetry-repositories.ts` | 指标 ownership 字段不可改；延后操作只由队列推进 | `TURN_METRIC_*`；session-actions／processing-failures |
| workspace／history-location | `HistoryLocationRepository`、`ChatHistoryPort`、`BotHistoryPort`、`WorkspacePort` | `files/workspace-files.ts`、`bot-history.ts`、`session-state-repositories.ts` | 路径由 channel identity 推导；删除只影响该 bot | `BOT_HISTORY_PATH_INVALID`、`SESSION_NOT_FOUND`；workspace-storage／bot-history |
| channel cursor／reply metadata | `CursorStore`（`channel-ports.ts`）、delivery 内的 reply sequence | `channel-cursor-repository.ts`、`delivery-repository.ts` | 新旧 cursor 键双写；QQ reply sequence 单调 | cursor 兼容测试 |
| 交互状态（music／singing／voice library） | `MusicStateRepository`、`SingingStateRepository`、`VoiceLibrarySettingsRepository` | `session-state-repositories.ts` | 状态绑定 session generation；清除写入显式 null | `*_SESSION_CHANGED`；music-host／singing-host |

### 事务与 Unit of Work

- `SqlitePersistence` 只创建一条连接；`UnitOfWork.transaction` 是唯一的多步原子边界，`savepoint` 用于已在外层事务内的复合写入（例如 delivery enqueue）。
- 保持原子的多步操作包括：创建／删除 bot、persona revision 发布、session reset／restore／删除、asset 登记与失败回滚、delivery intent／attempt／state／retry、automation 创建与执行、profile revision／acceptance／health fence、bot 删除的跨 aggregate 清理、lifecycle／evolution journal 更新。
- 拆分不得把原有单事务改成多次无保护写入；嵌套调用必须显式使用 savepoint 或复用外层事务。
- 匿名 repository 方法若当前没有 CAS，其现有并发结果保持不变；只有在有明确 bug 证据时才允许单独变更。

### 新增持久化能力的扩展步骤

1. 在 `src/core/ports/` 增加只包含业务需要的方法的 interface，输入带显式 scope／identity，分页使用强类型 request／cursor。
2. 在 `src/infrastructure/sqlite/`（或 `src/infrastructure/files/`）新增 adapter，集中 SQL、row mapping 与事务；复用既有表，不改 schema。
3. 在 `src/infrastructure/sqlite/persistence.ts` 组装 adapter，并在 `repositories()` 暴露窄端口；只有新增聚合才扩展该 bundle。
4. 应用服务通过构造参数接收该窄端口，不接收 `SqlitePersistence`、`Store` 或数据库句柄。
5. 在 `tests/repository-contract.test.ts` 为真实临时 SQLite 增加 contract：重开持久化、隔离、cursor、revision／CAS、回滚与恢复语义。
6. 运行 `npm run check:architecture && npm run typecheck && npm test`；门禁会自动拒绝越界 import 与原始 SQL。

## 边界数据规则

1. **身份所有权**：channel identity 拥有会话、附件、记忆和输出；跨渠道或跨 bot 不能复用该所有权。
2. **不信任模型输入**：模型输入不能成为可信 identity、scope、文件路径、Profile 私有路径或平台目标。
3. **凭据边界**：凭据只通过 Harness credentials 或短生命周期受控注入；不得进入人格、日志、错误或公共投影。
4. **人格版本**：只支持 `schemaVersion: 4`；不读取、迁移或回退 V3。
5. **Profile 隐私**：外部 Service Profile 的私有路径、端点和凭据不进入人格或公共投影；运行作业冻结 profile revision 和 content hash。
6. **执行时复查**：cancellation、authorization、profile revision 和 session generation 必须在排队、执行、结果登记和投递边界重新检查。
7. **安全错误**：跨层错误只携带稳定类别和脱敏诊断，不暴露端点、路径、credential、下载 locator 或 traceback。
8. **未知结果**：提交后结果未知不自动重放；恢复复用原 job／Asset 身份。

## 扩展规则

### 新增渠道

- 修改 `src/channels/` 实现 core `ChannelAdapter` contract，并在 `src/index.ts` 注册。
- 在 core 只增加平台无关 contract 或策略；不得加入 `if (channel === 'qq')` 式业务分支。
- 不得修改 Store 身份所有权、权限复查、凭据模型或其他渠道 adapter。

### 新增 Service Adapter

- 在 core 声明纯作业、Profile、结果和端口 contract；具体进程／worker 实现由 `src/harness/` 或 composition root 注入。
- Adapter 只能接触宿主分配的输入 handle、作业目录和冻结 revision；输出返回相对 handle 并由宿主再验证。
- 不得访问 Store、Session、channel、delivery、人格文件或 Harness Context；当前不承诺第三方 Adapter ABI。

### 新增管理 API

- 在 `src/harness/admin-contract.ts` 定义并校验请求／响应，在 `src/harness/admin.ts` 实现。
- client 只通过 API 消费公共投影；不得直接导入服务端实现或存储。
- 写操作必须保留 revision、authorization 和 session generation 复查。

### 新增 Python worker

- 所有可复用实现只能放在唯一公共包 `python/dsh_bot_runtime/`；`python/*.py` 仅允许架构门禁列出的薄 CLI 入口，`skills/` 不保存 Python 实现。
- 包内 import 使用 `dsh_bot_runtime...` 或明确相对 import；禁止修改 `sys.path`、`PYTHONPATH`、使用裸内部 basename，或用文件路径动态制造 module key。
- import 必须无网络、server、timer、thread、child process、SQLite、目录／文件写入和 profile 修改；入口使用显式 `main`／`execute`，长期任务只在 main guard 后启动。
- 宿主以固定包根设置最小 `PYTHONPATH` 并使用 `-P -m` 启动 worker，不继承调用方的 `PYTHONPATH`，也不从 cwd 推测仓库根。
- 不得接受模型提供的模块、脚本、包、可信资源路径或 credential 持久化位置；异常跨层时只返回稳定、脱敏 code。

### 新增技能

- 修改技能目录的 `operations.json` 和说明，在 `python/dsh_bot_runtime/skills/<skill_name>/` 实现受控入口，并由既有 operation registry 加载。
- 不得从技能代码访问 Store、渠道身份、Harness profile 或真实投递；能力缺失继续返回 `missing`／`blocked`。

### 新增 lifecycle 能力

- 只修改 lifecycle contract、协调器、独立 bundle 和对应原生测试。
- 不得调用业务发送、渠道登录、人格或媒体实现；排空与恢复继续通过窄 runtime port。
- 协议版本或组合兼容性发生变化时必须 fail closed，并单独提供迁移方案，不能静默改变运行语义。

## 能力边界

- 当前只支持简体中文，不承诺英文 locale 或英文 UI。
- 当前内部 Service Adapter 接口不是第三方 Adapter ABI 承诺。
- 不承诺 V3 人格迁移或回退。
- 不承诺 QQ／微信外部平台、外部模型、Music、RVC、GPT-SoVITS 或其他外部服务验收。
- 未登记能力继续显示 `missing`／`blocked`，不得静默选择替代服务。
- benchmark 只描述一次受控测量，不是性能、时延或吞吐保证。

## 当前依赖清单与审计基线

生产依赖清单由 `scripts/check-architecture.mjs` 使用 TypeScript parser 和 Node 标准库从以下范围即时生成：`src/**/*.ts`、`packages/**/*.{ts,mjs,js}` 与 `scripts/*.mjs`。它记录显式 import、export-from、可确定字符串目标的动态 import；不可静态确定的动态目标只报告文件和相对行号、不猜测目标，并令门禁失败，避免用变量 import／require 绕过边界。Python 显式 import 由审计覆盖 `python/**/*.py` 与 `skills/**/*.py`，包含绝对和相对 import；门禁同时拒绝路径修改、裸内部 import、文件型动态 module key、skill 脚本副本和无 main guard 的 CLI 入口。

阶段 5 初始基线为 115 个生产 TypeScript 模块、30 个 Python／技能模块、541 条 runtime import 和 286 条 Python import；lifecycle 源码迁移后数量会随中立 contract 与包内构建脚本变化。未发现 TypeScript runtime cycle、不可确定的动态 import 或 import 时启动 server／数据库／child process。门禁每次从工作树重新计算，不把这些数量作为固定阈值。

| 调用层 | 当前直接目标 | 审计结论 |
| --- | --- | --- |
| `src/index.ts` | core、channels、harness、lifecycle protocol | 合法 composition root；例外不向下传递 |
| `src/client/` | client 内部、`src/core/client-contracts.ts` | 仅 type-only contract；无 Node、SQLite 或服务端运行时 |
| `src/core/` | core 内部、Node 标准库、已声明依赖 | 无 client/channel/Harness/lifecycle 反向 import |
| `src/channels/` | core channel contract／策略、平台依赖 | 无 Store、delivery 或 Harness 实现 import |
| `src/harness/` | core contract／应用服务、Harness 包 | Node 进程、worker、credentials 和管理 API 的实现边界 |
| `packages/bot-lifecycle/src/` | 同包内 coordinator、integrity、protocol、bundle entry 与中立 contract | 不导入根 `src/`，也不导入渠道、投递、人格或业务发送实现 |
| `scripts/` | scripts helper、Node 标准库和构建依赖 | `runtime.mjs` import 已只读；start/install 显式准备目录 |
| `python/dsh_bot_runtime/`、`skills/` | 标准库、已声明 Python 依赖、唯一公共命名空间；skills 只含声明／文档 | 显式 import 有清单；Host 使用构建期固定 registry；Python manifest 延迟到首次 skill 执行加载 |

本阶段审计确认的实际层次是 composition → Harness／channel／lifecycle adapters → core contracts／应用服务 → 受控 Node／Python 资源。合法例外只有上述 composition root 和 lifecycle 专用 contract。此前未静态执行的约束包括 client server-import、core 反向依赖、生产对测试目录的依赖、TypeScript runtime cycle、子 bundle 越界和入口漂移；现由 `check:architecture` 执行。

### 有明确证据且可行为保持修复的问题

- core Service Adapter 曾直接导入 Harness 的进程／worker 实现，违反端口方向；本阶段把进程 contract 放回低层并在 composition root 注入实现。
- 浏览器模块曾从多个服务端实现文件导入纯类型；本阶段收敛为 `src/core/client-contracts.ts` 的 type-only contract。
- `scripts/runtime.mjs` 曾在 import 时创建运行目录；本阶段改为纯配置解析加显式目录准备，`stop` 保持只读。
- Python worker 曾在 import 时扫描全部 skill manifest；本阶段延迟到首次 skill operation，并把模块 import 异常纳入稳定错误归类，不改变实际作业路由。
- 安装与 GitHub bootstrap 曾分别维护无重试、无 finally 清理的异步原子 JSON；本阶段统一到 `scripts/durable-json.mjs`，保留同步 lifecycle journal 的独立实现，并补充 Windows 短暂占用与临时文件清理回归。
- source snapshot 曾遗漏可选／CI requirements；两条现有快照路径同步纳入全部 requirements，并由一致性测试锁定。
- 既有测试只对固定 adapter 文件做文本匹配，不能发现新增文件、export-from、动态 import 或循环；本阶段以全树 AST 模块图替代该缺口。

### 未混入本阶段的语义性问题

外部 Service Adapter ABI 仍需要独立方案。Python skill 已在本次独立整改中迁入 `dsh_bot_runtime`，不是上述边界的例外。lifecycle 源码交付布局已由 ADR 0004 单独整改：源码现在位于独立子包，安装和回滚使用显式双包兼容协议，不是阶段 5 静态修复的隐含例外。数据库 repository 拆分已由 ADR 0005 完成，见下节；该整改未修改 schema、migration、cursor、错误码、delivery／权限／session generation／取消或 lifecycle 语义。

## Repository 拆分结果（ADR 0005）

- schema、migration 版本、表名、索引、记录含义、cursor 编码、错误码和运行数据目录均未改变；拆分只改变代码归属与依赖方向。
- `src/core/store.ts` 的单体实现已拆为 `src/infrastructure/sqlite/` 下的 aggregate adapter；业务代码不再持有 Store 或数据库句柄。
- 迁移期 `src/infrastructure/sqlite/store.ts` facade 已删除；contract 与集成测试直接构造 `SqlitePersistence`，普通断言使用命名 repository，只有明确的 legacy／故障注入夹具可访问底层记录。
- `check:architecture` 使用 `sqlite-import`、`database-ownership`、`record-access`、`core-repository`、`channel-repository`、`harness-repository`、`client-repository` 规则，并禁止两个历史 Store facade 路径重新出现；例外只精确到 `src/index.ts` 与 `src/infrastructure/` 自身。

## 门禁输出

`npm run check:architecture` 是只读、离线检查；维护者需要逐模块清单时可运行 `node scripts/check-architecture.mjs --inventory`，输出同样只含相对路径。成功输出 `"status": "PASS"`；失败项包含稳定规则 ID、仓库相对路径和目标，不输出本机绝对路径。它至少验证：

- 生产 TypeScript runtime import 无循环；
- client、core、channel、lifecycle、Service Adapter、生产／测试和 package 边界；
- SQLite 与 generic record 的所有权：只有 `src/infrastructure/sqlite/` 可导入 `node:sqlite`，只有 `src/infrastructure/` 可准备 SQL、访问 `records` 表或持有数据库句柄；
- 业务层不导入 repository 实现、`src/infrastructure/` 或 Store facade，composition root 例外不传递；
- Python 绝对／相对 import 清单、单一命名空间、内部 import 解析、固定 skill entry，以及 import-time 网络／线程／进程／server／数据库／写盘副作用；
- composition root 例外没有扩散；
- 主包 export 与三个构建入口仍存在，其中 lifecycle 必须由 `packages/bot-lifecycle/src/index.ts` 经子包自己的构建脚本生成；
- lifecycle 子包无越界 import、旧 `src/lifecycle/` 不得复活、共享 contract 只有一个来源；
- 主包/coordinator 的版本化 contract 声明、子包 export/files/dist 清单存在；
- 本页声明的目录与仓库一致，不以 allowlist 隐藏越界依赖。
