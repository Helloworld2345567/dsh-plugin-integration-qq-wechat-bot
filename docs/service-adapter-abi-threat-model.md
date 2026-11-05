# Service Adapter ABI v1 威胁模型

本文是第三方 Service Adapter ABI v1 的安全审计基线。ABI 是宿主与受控子进程之间的序列化协议；内部 TypeScript `ServiceAdapter` 仍只是宿主实现细节。

## 资产与信任边界

宿主独占 Store/Repository、Session 与 channel identity、permissions、persona、Profile revision、credential service、输入句柄解析、作业与输出目录、配额、并发、取消、Asset 登记、输出验证、delivery、Acceptance 和 public projection。Adapter 只获得当前调用所需的冻结 Profile、受控输入句柄、宿主分配目录、截止时间和显式声明的最小凭据。

信任边界依次为：运营者登记请求 → artifact/package 校验 → immutable manifest/catalog → 受控进程端口 → ABI 请求/响应 → 宿主复查与登记。人格、skills、工作区、聊天输入和模型响应均不属于代码发现或信任来源。

## 威胁与控制

| 威胁 | fail-closed 控制 | 验证证据 |
| --- | --- | --- |
| 恶意或畸形 manifest | 严格 schema、字段/深度/字节限制、manifest/ABI/protocol/host API 版本校验；未知字段拒绝 | manifest conformance |
| traversal、symlink、junction、reparse point | 入口必须为规范化包内相对路径；逐段 `lstat`、`realpath` containment；特殊文件拒绝 | traversal/reparse tests |
| artifact hash 替换、TOCTOU | canonical artifact hash、manifest hash、包 identity 同时绑定；登记与启用时复验；运行入口从已复验根解析 | hash replacement smoke |
| 未知签名 key | 签名存在时只接受运营者 trust store 内的 key；未知 key 拒绝 | signature tests |
| 已撤销 artifact/dependency | 撤销立即阻止新作业；依赖解析检查 required/optional、版本、cycle 与 revocation | revocation tests |
| 恶意 install script | 安装/登记分离；归档检查不运行 install script；已安装 npm 包不自动受信；无自动发现 | archive smoke |
| Adapter 读取宿主环境 | 子进程环境使用最小白名单；不复制完整 `process.env`；HOME/TEMP 指向单作业目录 | environment conformance |
| endpoint/path/credential 泄漏 | stderr 只限量 drain，不进入模型/用户响应；公开 diagnostics/observations 经宿主净化；私有 Profile 不进入 public projection | safe diagnostics tests |
| 输出目录逃逸 | Adapter 只能返回单段相对 output handle；宿主逐段拒绝 reparse point，并做 realpath、大小、magic、格式和完整性复验 | output escape tests |
| 超大 JSON/stdout/stderr/日志 | ABI message、字段深度、stdout、stderr 均有硬上限；超限终止进程并安全分类 | oversized tests |
| 子进程树逃逸、fork 滥用 | 固定 executable/argv；POSIX 独立进程组、Windows tree termination；取消只有在树完整退出后才算 confirmed | teardown tests |
| 监听公共端口 | ABI 不提供监听地址；运行环境不向 Adapter授予宿主网络身份。若部署平台不能实施所需网络策略，运营者必须使用 OS sandbox 并保持 Adapter disabled | operator verification |
| 网络请求状态未知 | 超时/断连/取消无法证明远端停止时返回 UNKNOWN_STATE 并 fence service | unknown fence tests |
| 取消后远端仍执行 | 宿主复查 AbortSignal、authorization、session generation、Profile snapshot；unknown 时不投递、不重放 | cancellation tests |
| job ID 重放 | job ID 与 idempotency key 由宿主生成；已存在 key 拒绝；recover/status 只能查询原 job ID | no replay tests |
| idempotency 冲突 | service ID + idempotency key 唯一；冲突不重新提交 | idempotency tests |
| operation/tool/permission namespace 冲突 | ServiceCatalog 对 service/package/operation/tool/permission 做全局碰撞检查；保留命名空间拒绝 | collision tests |
| Profile revision 漂移 | 作业冻结 revision/content hash；提交前、响应后、每个输出验证前后复查 | profile freeze tests |
| session/authorization 撤销 | Adapter 不接收身份；宿主在执行及输出登记前复查 authorization/session generation | runtime tests |
| Adapter 伪造 delivery/channel identity | ABI 无 delivery/channel/session 字段；Adapter 结果不能触发平台发送 | schema/architecture tests |
| ABI downgrade | manifest 与 envelope 同时声明 ABI/protocol；协商结果必须等于宿主发起版本；major 不匹配拒绝 | negotiation tests |
| host/adapter 版本协商错误 | host API semver range、manifest version、protocol version、required capabilities 全部满足后才能启用 | compatibility tests |
| 依赖缺失、cycle、collision | required 缺失/不兼容/撤销/cycle fail closed；optional 缺失只禁用双方未协商能力 | dependency tests |
| 恢复错误地重提推理 | `recover`/`status` envelope 只有原 job ID，不包含 operation/parameters/input；宿主不自动 execute | recovery tests |

## 运行时复查顺序

1. 宿主验证 artifact 仍受信、未撤销、已启用且版本兼容。
2. 宿主验证 operation/catalog/policy/Profile snapshot/authorization/session generation。
3. 宿主创建独立 job/output/input 目录并解析输入句柄。
4. 受控进程只收到 ABI envelope 和最小凭据。
5. Adapter 返回结果后，宿主再次执行取消、authorization、session generation 与 Profile snapshot 检查。
6. 宿主验证 output handle 所有权、类型、大小、格式和完整性；只有宿主可登记 Asset、Acceptance 或 delivery。
7. 无法确认取消/进程树/远端状态时记录 unknown 并 fence service；不得自动重放。

## 停止条件与部署前提

若目标平台不能证明受控子进程树终止、最小环境或 job directory containment，第三方 Adapter 必须保持 disabled；不得退回宿主进程内 `import`、`require`、`eval` 或回调对象。若需要修改数据库 schema、delivery、lifecycle、权限或 session generation 语义，必须另行 ADR、迁移/回滚设计与测试环境，本 ABI v1 不实施该变化。

ABI v1 的进程边界不是通用容器安全声明。需要阻断任意网络、系统调用或文件读取的生产环境，应由运营者在本 ABI 外叠加低权限 OS 账户、作业对象/sandbox 和出站网络策略；能力不足时保持禁用。

## 当前实现审计结论（停止）

本次审计在进入生产实现前停止，原因是当前 Windows `NodeControlledProcessPort` 只能调用 `taskkill /T /F` 尝试结束进程树：

- 没有 Windows Job Object 的 `KILL_ON_JOB_CLOSE`、禁止 breakaway 或进程数量限制，因此不能证明恶意后代无法脱离宿主跟踪。
- 子进程沿用宿主用户访问令牌；`cwd` 和精简环境变量不构成文件系统隔离，Adapter 仍可读取该用户可读的 Store、Profile、工作区和其他凭据文件。
- 没有 AppContainer/restricted token、ACL 沙箱或等价边界，不能证明 Adapter 只能访问 artifact、输入与当前 job 目录。
- 没有网络 namespace/WFP/AppContainer capability 等出站和监听控制，不能证明 Adapter 不会监听公共端口或任意访问网络。
- `taskkill` 的成功只能证明已观察到的树被请求终止，不能证明先前脱离的进程、远端请求或系统副作用已停止。
- 现有进程端口会丢弃 stderr，且有 stdout 上限，但尚未提供独立 stderr 字节上限、受限继承句柄清单和一次任务一条的短生命周期凭据管道。

这些缺口直接命中“无法证明进程隔离或子进程树终止时停止，不得回退到宿主进程内动态 import”的停止条件。因此：

1. 不接入第三方 Adapter；现有内置 Adapter 行为保持不变。
2. 不修改“当前不承诺第三方 Adapter ABI”的公开声明。
3. 不新增动态 `import`/`require`、npm 自动信任、install script 或数据库迁移。
4. 未完成的 ABI/registry 生产源码草案已移除，只保留本威胁模型与审计结论。

## 可接受的替代方案

### 方案 A：先实现原生隔离 broker（建议）

在 Harness/infrastructure 边界增加小型、可审计的原生 broker，而不是大型插件或容器框架：

- Windows：使用 restricted token 或 AppContainer；用 `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` 限制继承句柄；创建不可 breakaway 且 `KILL_ON_JOB_CLOSE` 的 Job Object；将 artifact 设为只读，仅给当前 job/input/output 目录最小 ACL；用 WFP/AppContainer 网络能力默认拒绝监听和出站。
- Linux（若支持）：专用 UID、mount/user/pid/network namespace、`no_new_privs`、seccomp 和 cgroup v2；只读挂载 artifact，读写挂载单个 job 目录。
- 不满足经验证的隔离能力时，平台探测必须返回 unsupported，第三方 Adapter 保持 disabled。

### 方案 B：运营者提供已验证的外部 sandbox launcher

允许登记固定 launcher 和固定参数，但宿主必须验证 launcher identity/hash、隔离能力报告和 conformance 证据；不能把“运营者说可信”或普通命令包装器等同于隔离证明。此方案仍不能自动信任 npm 包，也不能从人格、工作区或模型响应发现代码。

### 方案 C：仅发布候选规范，不发布运行时承诺

可以先评审 JSON Schema、协议和 conformance 设计，但必须标记为 draft；在 broker 和安装/撤销 smoke 完成前，不导出稳定 ABI、不启用第三方包、不修改现有“不承诺”声明。

## 迁移与回滚设计

- 迁移：保持现有 `createBuiltin` 路径不变；未来第三方路径通过新的进程 port 注入，core 只依赖序列化 ABI port。登记状态存储必须经过独立 Repository port，不修改现有 Profile/Acceptance 历史。
- 启用：artifact install、register、enable 分开；enable 前再次验证 hash、签名/显式信任、ABI、依赖、entry containment 和 broker capability。
- 撤销：先原子阻止新作业，再要求 broker 取消运行中树；无法确认时写 unknown fence。删除登记不删除 Profile revision、job record 或 Acceptance evidence。
- 回滚：禁用第三方 registry composition 即回到仅内置 Adapter；不改变 QQ/微信、delivery、permission、session generation、数据库 schema 或 lifecycle。

## 继续所需测试环境

至少需要一个可在 CI 和目标 Windows 版本重复运行的原生隔离 fixture，并证明：

1. Adapter 无法读取宿主数据库、Profile、工作区秘密和非当前任务凭据。
2. Adapter 无法写 artifact/root 外路径，无法通过 symlink/junction/reparse point 逃逸。
3. fork/spawn 后代不能 break away；取消、超时、宿主崩溃或关闭 broker handle 后完整进程树消失。
4. 默认无法监听公共端口或发起未授权网络连接。
5. 只有显式句柄被继承；每任务凭据 channel 关闭后不可复用，且不出现在环境、argv、stdout、stderr 或诊断中。
6. 超大 stdin/stdout/stderr、深层 JSON、慢读、拒绝退出和并发取消均有确定上限。
7. broker 无法证明终止时返回 unknown，并在宿主中持久化 service fence；recover 只查询原 job ID，不重提 operation。
8. 归档安装、撤销、重启恢复和 release pack 证明 fixture、私钥、凭据及测试 Adapter 不进入生产包。
