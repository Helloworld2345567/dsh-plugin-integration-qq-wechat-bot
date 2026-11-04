# 独立产品生命周期协调器

`dsh-bot-lifecycle` 是本项目独立产品 profile 使用的 Harness bundle。它由当前仓库的产品安装器安装，由 `scripts/start.mjs` 启动器监督；它不是独立的第三方运行时，也不是面向外部 Adapter 的公共插件平台。

## 责任和版本关系

- 只有独立产品路径（`node scripts/install.mjs`）安装和管理该 bundle；“安装到已有 Harness”只安装主插件，不包含 lifecycle coordinator。
- 它随主插件的同一 npm 归档交付，但有独立的 bundle 名称和 package 版本；兼容关系以该项目版本的安装器和原生测试为准，不承诺任意版本交叉组合。产品安装器会把主插件和 `dsh-bot-lifecycle` 都加入隔离的 `bots` profile；不要手工替换其中一个。
- 当前只支持项目已验证的 DeepSeek Harness `0.2.1-rc.2` 运行时范围。不得将当前内部 lifecycle handshake 或 TypeScript 接口当成第三方 Adapter ABI；项目不承诺对外稳定的 Adapter ABI。
- lifecycle 不能脱离主插件的运行数据、安装 journal、受监督 launcher 和当前产品 profile 独立运行。

## 安装、升级、停止和回滚

安装由产品路径完成：

```powershell
node scripts/install.mjs <package-directory-or-tgz>
node scripts/start.mjs --port 3080
```

停止由同一产品 home 的 launcher 完成：

```powershell
node scripts/stop.mjs
```

已有 Harness profile 不应调用这里的 lifecycle 命令。升级前由运营者保留 `BOT_HOME` 和工作区备份。本地源码/本地 `.tgz` 安装会检查归档结构并计算、记录 hash 与安装后包身份，但不证明下载来源；固定 GitHub bootstrap 才会比较运营者提供的预期 SHA-256。受管升级由 lifecycle 校验 journal 中记录的归档 hash、排空当前任务、等待主插件报告健康，再恢复连接。受管升级失败时 launcher/协调器只尝试一次仍能通过哈希验证的上一份归档；离线 `stop → install → start` 没有该自动回滚。无法确认的投递或远程任务不自动重放。

成功升级后的人工回滚通过可信管理员命令 `/evolve rollback <task-id>` 排队，使用历史任务 ID。回滚和升级都保留人格、会话、附件、凭据引用和工作区数据；它们不会把外部平台已经接受但本地状态未知的消息重新发送。安装、升级、停止和回滚的实际状态写入产品 home 的 journal，由运营者依据状态处理，不要直接编辑 journal 或 live `node_modules`。

## 失败和恢复语义

1. 主插件提出 restart/apply 后，协调器先让运行时进入 quiescing，排空可安全排空的任务并停止接受新的生命周期操作。
2. coordinator 与主插件通过版本化 handshake 和 launcher nonce 确认是同一实例；不匹配、缺少主插件或健康检查失败时 fail closed。
3. 子进程退出后由 launcher 负责重新启动；健康超时不会自动无限重启。
4. 安装归档、当前安装记录或上一归档 hash 不匹配时拒绝恢复；恢复失败会保留失败状态，等待运营者提供新的已验证归档或明确的人工回滚。
5. `unknown` 只表示外部提交结果无法确认，不能当成失败后自动重做；恢复入口复用原 Asset/作业身份。

该协调器的失败恢复优先避免重复执行和重复投递，而不是追求表面可用。真实 QQ/微信授权、外部 TTS、Music、RVC、GPT-SoVITS 和模型验收仍由运营者完成。详见 [独立产品部署](../../docs/deploy-product-profile.md)、[ADR 0001](../../docs/adr/0001-delivery-modes.md) 和 [ADR 0003](../../docs/adr/0003-lifecycle-and-uncertain-outcomes.md)。
