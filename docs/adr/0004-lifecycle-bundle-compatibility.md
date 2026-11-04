# ADR 0004：主插件与生命周期协调器使用版本化兼容协议

- 状态：已接受
- 日期：2026-11-04

## 背景

主插件可以被 lifecycle coordinator 排空和替换，但 coordinator 自身拥有这次替换事务、Plugin Manager 调用、一次回滚和监督重启。正在协调主包升级的 coordinator 不能热替换自己；旧实现只比较一个整数握手版本，也没有把主包版本、coordinator API、双方兼容范围、能力和双包 artifact identity 绑定起来。任意新旧组合因此不能靠猜测继续运行。

## 决策

### 1. 三类版本相互独立

- **bundle/package version**：npm 包版本，用于标识某一发布产物；主包当前为 `0.2.x`，coordinator 有自己的包版本。
- **runtime protocol version**：主插件声明的可序列化运行握手协议，使用 `major.minor.patch`。major 不同不兼容；是否接受 minor/patch 由 coordinator 的显式范围决定。
- **coordinator API version**：coordinator 对排空、健康、热替换与监督能力的版本，也使用 `major.minor.patch`；是否接受由主插件的显式范围决定。

内部 TypeScript interface 不是公共协议。机器判定只读取两个 `package.json` 的 `dshLifecycle` 声明和运行时可序列化字段。

### 2. 双向声明

主插件声明：

- `schemaVersion`、`role: main`；
- `runtimeProtocol`；
- `coordinatorApiRange`；
- 自身 capabilities；
- 必须由 coordinator 提供的 capabilities。

coordinator 声明：

- `schemaVersion`、`role: coordinator`；
- `coordinatorApi`；
- `runtimeProtocolRange`；
- `mainPackageRange`；
- 自身 capabilities；
- 必须由主插件提供的 capabilities。

范围语法只允许可静态解释的 `=、<、<=、>、>=` 数值三段版本，不支持 `*`、tag 或隐式猜测。

### 3. 握手、能力和实例身份

运行握手包含：协议名、contract schema、角色、package 名称/版本、runtime protocol 或 coordinator API、兼容范围、capabilities、required capabilities、launcher 进程内 instance nonce 和当前已加载 artifact identity。双方声明必须双向满足；required capability 必须全部存在；instance 必须完全相等。coordinator 卸载后 `active` 立即变为 false。

缺字段、伪造结构、版本范围不满足、能力缺失、instance 或 artifact identity 不一致都 fail closed。稳定错误码包括：

- `LIFECYCLE_METADATA_MISSING`
- `LIFECYCLE_METADATA_INVALID`
- `LIFECYCLE_PROTOCOL_INCOMPATIBLE`
- `LIFECYCLE_COORDINATOR_TOO_OLD`
- `LIFECYCLE_COORDINATOR_API_INCOMPATIBLE`
- `LIFECYCLE_MAIN_TOO_OLD`
- `LIFECYCLE_MAIN_VERSION_INCOMPATIBLE`
- `LIFECYCLE_CAPABILITY_MISSING`
- `LIFECYCLE_IDENTITY_MISMATCH`
- `LIFECYCLE_ARTIFACT_MISMATCH`
- `LIFECYCLE_OFFLINE_PAIR_REQUIRED`

诊断只说明类别和安全恢复动作，不输出凭据、平台身份或业务数据。

### 4. 新旧组合与更新模式

- 旧 coordinator 遇到声明更高 coordinator API 下限的新主包：拒绝热更新，返回 `LIFECYCLE_COORDINATOR_TOO_OLD`／`LIFECYCLE_OFFLINE_PAIR_REQUIRED`。
- 新 coordinator 遇到低于 `mainPackageRange` 的旧主包：启动握手拒绝，返回 `LIFECYCLE_MAIN_TOO_OLD`。
- protocol major 不匹配：无论包版本看起来多接近都拒绝。
- compatible minor 只有在双方版本范围与 required capabilities 同时满足时才协商成功。

只替换主包必须满足：当前 coordinator 明确接受 candidate 的 runtime protocol、主包 package version 和全部 capabilities；candidate 也明确接受当前 coordinator API 和 capabilities。否则必须停止受监督 launcher，由 `scripts/install.mjs` 离线安装两个 bundle。旧 coordinator 绝不尝试热替换自己。

### 5. 检查时点

1. **构建/打包前**：coordinator 必须从 `packages/bot-lifecycle/src/index.ts` 构建；`dist/lifecycle-build.json` 的源码摘要、文件清单、package version、contract 与输出 hash 必须匹配。
2. **安装前、修改 profile 前**：验证两个 archive 的安全性、hash、package name、版本声明和双向兼容性；launcher 必须已停止。
3. **启动时**：验证 `installation.json` 与独立 `lifecycle-installation.json`、两份归档 hash、实际安装 identity/package version/contract 和双向兼容性。
4. **排空前**：candidate 与 previous 主包都必须能由当前 coordinator 热管理；否则拒绝，不进入排空。
5. **激活后**：监督 launcher 验证 ready IPC 中的主包 identity、protocol、两个 package version、coordinator API 与 coordinator identity。

### 6. 离线双包事务与回滚

安装器在停机状态先完整预检，再记录 `lifecycle-installations/<id>.json`：candidate/previous 双包各自的 archive path、SHA-256、package version、identity 和 contract。离线安装顺序为 coordinator 后 main，使任何中间组合都不被运行进程观察。验证或元数据提交失败时只回滚一次，顺序为 previous main 后 previous coordinator；这样恢复动作自身仍由 launcher 外部拥有。恢复后再次验证双包身份。任一旧 archive hash 不匹配时停止，不猜测恢复。

`installation.json` 继续使用既有 schemaVersion 1；新增 `lifecycle-installation.json` 保存 current/previous 双包组合，不静默迁移旧文件。旧安装缺少该文件时启动 fail closed，运营者必须停机运行可信安装器。evolution journal 的 phase、unknown、不自动重放、一次回滚、服务 fence、取消和监督重启语义不变。

## 结果

普通已有 Harness profile 只安装主插件，不获得受管 lifecycle 承诺。独立产品 profile 才使用 coordinator、双包安装状态和监督 launcher。项目只承诺显式声明且测试覆盖的组合，不承诺任意跨版本兼容。
