# ADR 0005：Store 到 Repository 端口的全量拆分

## 状态

已接受（阶段 6）。

## 背景

`src/core/store.ts` 曾同时承担 schema 建立、文件人格发布、会话绑定、消息、投递、统计、自动化、Service Profile／验收／健康、runtime 所有权和通用 records 访问。业务模块通过持有同一个 `Store` 对象获得全部能力，导致：

- 任何人可以调用 `store.get('任意 kind')`、`store.db.prepare(...)` 或通用 `put`，绕过业务语义；
- 无法从类型上判断某个服务真正需要哪些持久化能力；
- transaction 边界分散在业务代码中，容易在拆分时被无意破坏；
- Service Adapter、channel、Harness 工具都有机会直接接触数据库。

## 决策

1. 在 `src/core/ports/` 为每个稳定业务边界声明窄 contract（bot、persona config、session／binding、inbox、memory、asset／media job／quota、delivery、automation、stats、service profile／state／acceptance／health、runtime ownership、telemetry、evolution、workspace／history、cursor、交互状态）。
2. 在 `src/infrastructure/sqlite/` 实现 SQLite adapter，在 `src/infrastructure/files/` 实现人格文件与工作区文件 adapter。SQL、migration、事务与 row mapping 只存在于基础设施层。
3. 应用服务改为接收 `RuntimeRepositories` 等显式依赖对象中的窄端口；composition root（`src/index.ts`）是唯一创建 adapter 并注入的位置。
4. 事务边界由 `SqliteDatabase.transaction`／`savepoint` 统一；拆分保持原有原子性，没有把单事务改成多次无保护写入。
5. `src/infrastructure/sqlite/store.ts` 仅保留为基础设施／测试生命周期 facade，业务层不得持有；退出条件是 contract 测试全部改用 adapter 后删除。
6. `check:architecture` 增加 `sqlite-import`、`database-ownership`、`record-access`、`store-facade`、`core-repository`、`channel-repository`、`harness-repository`、`client-repository` 规则，并要求 `src/core/store.ts` 不存在。

## 明确不改变

- SQLite schema、migration 版本、表名、索引与记录含义；
- cursor 编码与 filter fingerprint、revision／CAS、幂等与去重；
- 错误码、delivery 状态机、取消、权限、人格 V4、媒体协议、lifecycle 语义与运行数据目录；
- 公开 Harness 行为。

## 影响

- 新增持久化能力必须先在 `src/core/ports/` 声明 contract，再实现 adapter，最后在 composition root 注入；不允许业务层直接访问 `records` 表或 SQL。
- `tests/repository-contract.test.ts` 对真实临时 SQLite 执行 contract：重开持久化、隔离、revision／CAS、cursor、事务回滚、delivery retry、Profile 不可变、验收绑定与跨 bot 删除隔离。

## 回滚

按提交粒度回退：每个垂直切片（adapter 抽取、业务服务迁移、门禁与文档）都是独立本地提交。若门禁规则误报，只允许精确到文件与职责的例外，不得使用目录级 allowlist。
