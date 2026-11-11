# 独立产品生命周期协调器

简体中文 | [English](README.en.md)

`dsh-bot-lifecycle` 是独立产品 profile 使用的 Harness bundle。它由产品安装器与主插件成对安装，由 `scripts/start.mjs` 监督；它不是主插件内部服务、第三方运行时或外部 Adapter 平台。

## 源码与构建

可构建源码位于本包 `src/`：coordinator、integrity、protocol、bundle entry 和中立 contract 均在包边界内，不导入根包 `src/`。本包 `source` 为 `./src/index.ts`，`npm run build` 生成 `dist/index.js`、可序列化 compatibility export 和 `dist/lifecycle-build.json`。`npm run verify:build`／prepack 会比较源码摘要、文件清单、package version、contract 与输出 hash，陈旧 dist 不能静默打包。

`src/contract/` 是主插件/coordinator 共用的 protocol、artifact identity、journal 和源码完整性单一来源；不得复制两份可漂移的版本范围、hash 或 identity 算法。

## 版本兼容协议

主插件声明 runtime protocol、可接受的 coordinator API range、capabilities 与 required coordinator capabilities；coordinator 声明 coordinator API、可接受的 runtime protocol/main package range、capabilities 与 required main capabilities。bundle package version 与这两个 protocol/API version 相互独立。

运行握手还绑定 instance nonce 和双方 artifact identity。缺失/伪造元数据、protocol major、package range、required capability、instance、hash、版本或 identity 不匹配都以稳定 `LIFECYCLE_*` 错误 fail closed。内部 TypeScript interface 不是公共协议；只承诺显式声明并测试的组合。

## 热更新与离线双包更新

- 当前 coordinator 和 candidate 主包双向声明兼容时，允许 coordinator 排空后只替换主包。
- coordinator API、protocol major、package range 或 required capability 需要变化时，旧 coordinator 不会热替换自己；必须 `stop → install → start`，由监督 launcher 停机后安装两个 bundle。
- 安装器在 profile 修改前验证双包 archive/hash/版本/contract；启动器再验证安装记录与实际文件。
- 双包安装 journal 记录 current/previous 两个 artifact 的 archive hash、identity、package version 与 contract。中途失败只恢复一次 previous main，再恢复 previous coordinator；任一旧 hash 不匹配就停止。

`installation.json` 保持原 schema；新增 `lifecycle-installation.json` 保存双包 current/previous 组合。旧安装缺少该文件时不会静默迁移，必须停机重跑可信安装器。

## 数据与失败语义

排空、unknown、不自动重放、一次回滚、监督重启、取消与服务 fence 语义不变。升级和回滚保留人格、会话、附件、凭据引用和工作区数据；不会把外部平台已经接受但本地状态未知的消息重新发送。coordinator 不导入或发送 QQ／微信消息。

普通已有 Harness profile 只安装主插件，不包含本 coordinator，也不获得受管升级承诺。详见[独立产品部署](../../docs/deploy-product-profile.md)、[ADR 0003](../../docs/adr/0003-lifecycle-and-uncertain-outcomes.md)和[ADR 0004](../../docs/adr/0004-lifecycle-bundle-compatibility.md)。
