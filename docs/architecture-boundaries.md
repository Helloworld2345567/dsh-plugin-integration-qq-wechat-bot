# 静态架构边界与维护者契约

本页把仓库当前已经存在的运行边界整理为可执行契约。它描述依赖方向，不改变 QQ／微信业务、数据库、权限、凭据、媒体、人格或 lifecycle 语义。维护者在修改生产模块后必须运行 `npm run check:architecture`；发布门禁会重复执行同一检查。

## 模块职责

| 模块 | 唯一职责 | 不拥有的职责 |
| --- | --- | --- |
| `src/index.ts` | **composition root**：创建 Store、渠道、Harness 端口、Service Adapter、lifecycle 端口并连接生命周期 | 不定义可复用业务规则；例外只限组装 |
| `src/core/` | 与具体平台无关的领域类型、策略、应用服务、端口与持久化实现 | 浏览器 UI、QQ／微信协议、Harness Context 和 lifecycle 调度 |
| `src/channels/` | QQ／微信协议、登录、收发和平台格式适配 | Harness 管理 API、人格规则和 lifecycle |
| `src/harness/` | Harness 服务接入、管理 API、工具注册及 Node 进程／worker 端口实现 | 浏览器渲染和渠道业务规则 |
| `src/client/` | 浏览器管理界面，仅消费管理 API 和可共享的纯类型契约 | Node 内建模块、SQLite、渠道或 Harness 服务端实现 |
| `packages/bot-lifecycle/src/` | 独立产品的升级、排空、恢复、回退与 bundle 入口；从自己的源码入口独立构建 | 根包 `src/`、QQ／微信业务、真实消息发送、人格实现 |
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
src/core         -> Node 标准库、仓库依赖、src/core 内部模块和中立 lifecycle contract
src/index.ts     -> src/core + src/channels + src/harness + 中立 lifecycle runtime port
scripts          -> scripts 内部纯 helper；CLI 入口显式调用副作用
Python skills    -> python 共享模块和 vendored 命名空间
```

| 调用方 | 可依赖 | 说明 |
| --- | --- | --- |
| client | client、浏览器 contract | 服务端 DTO 只能以低层纯类型表达，不能拖入实现 |
| core | core | 具体进程、网络或 Harness 能力通过端口注入 |
| channels | core | 只用公开渠道 contract；平台协议留在 adapter |
| harness | core | 实现 core 端口并连接 Harness 服务 |
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
- `packages/bot-lifecycle/` 不得通过越界相对路径依赖根包内部源码；其发布入口必须由声明的构建入口生成。
- Python 模块 import 不得连接外部服务、监听端口、启动长期进程、修改 profile 或写入运行数据；这些行为只能在显式 `main`、`start` 或 `execute` 之后发生。

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

- 放在 `python/` 或对应 `skills/*/scripts/`，通过固定协议和宿主分配目录执行。
- import 必须无网络、server、timer、child process 和写盘副作用；入口使用显式 `main`／`execute`。
- 不得接受模型提供的脚本路径、可信路径或 credential 持久化位置。

### 新增技能

- 修改技能目录的声明、说明和受控脚本，并由既有 operation registry 加载。
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

生产依赖清单由 `scripts/check-architecture.mjs` 使用 TypeScript parser 和 Node 标准库从以下范围即时生成：`src/**/*.ts`、`packages/**/*.{ts,mjs,js}` 与 `scripts/*.mjs`。它记录显式 import、export-from、可确定字符串目标的动态 import；不可静态确定的动态目标只报告文件和相对行号、不猜测目标，并令门禁失败，避免用变量 import／require 绕过边界。Python 显式 import 由审计覆盖 `python/**/*.py` 与 `skills/**/*.py`，且 worker／服务入口必须由 main guard 或显式调用启动。

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
| `python/`、`skills/` | 标准库、已声明 Python 依赖、共享 worker 模块 | 显式 import 有清单；skill manifest 延迟到首次 skill 执行加载 |

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

Python skill 的命名空间重整、数据库 repository 全面拆分和外部 Service Adapter ABI 仍需要独立方案。lifecycle 源码交付布局已由 ADR 0004 单独整改：源码现在位于独立子包，安装和回滚使用显式双包兼容协议，不是阶段 5 静态修复的隐含例外。

## 门禁输出

`npm run check:architecture` 是只读、离线检查；维护者需要逐模块清单时可运行 `node scripts/check-architecture.mjs --inventory`，输出同样只含相对路径。成功输出 `"status": "PASS"`；失败项包含稳定规则 ID、仓库相对路径和目标，不输出本机绝对路径。它至少验证：

- 生产 TypeScript runtime import 无循环；
- client、core、channel、lifecycle、Service Adapter、生产／测试和 package 边界；
- Python 显式 import 清单和 import-time 长期进程／server／数据库启动；
- composition root 例外没有扩散；
- 主包 export 与三个构建入口仍存在，其中 lifecycle 必须由 `packages/bot-lifecycle/src/index.ts` 经子包自己的构建脚本生成；
- lifecycle 子包无越界 import、旧 `src/lifecycle/` 不得复活、共享 contract 只有一个来源；
- 主包/coordinator 的版本化 contract 声明、子包 export/files/dist 清单存在；
- 本页声明的目录与仓库一致，不以 allowlist 隐藏越界依赖。
