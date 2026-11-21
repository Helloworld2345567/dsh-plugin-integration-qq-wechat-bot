# 第三方 Service Adapter 边界

简体中文 | [English](../en/service-adapter-abi-threat-model.md)

**第三方 Service Adapter ABI 尚未实现或开放。** 内部 TypeScript `ServiceAdapter` 是内置服务实现接口，不是可供第三方包使用的稳定 ABI。本页保留此前方案停止实施的原因，不能当作已部署的安全能力。

## 当前边界

宿主拥有身份、权限、Profile revision、凭据、输入解析、任务目录、取消、Asset 登记、验收和投递。内置 adapter 通过受控端口接收当前作业需要的数据；人格、技能、工作区和模型响应不能发现或加载第三方可执行代码。

当前 Windows 进程端口使用 `taskkill /T /F` 清理子进程树，精简环境并限制 stdout。这足以服务现有受信 worker 的进程管理，但不构成对恶意 adapter 的隔离：进程仍使用宿主用户权限，cwd 不限制文件访问，亦没有受限 token、禁止 breakaway 的 Job Object 或网络沙箱。终止本地进程也不能证明远端请求已停止。

## 重新评估前提

若以后支持第三方 adapter，需先独立设计并验证：

- 明确的 artifact 安装、登记、信任与撤销流程；版本、能力和依赖协商失败时拒绝启用。
- 目标平台的进程、文件、继承句柄和网络隔离；普通 launcher 或运营者声明不能代替隔离证据。
- 有界协议输入输出、最小任务凭据和脱敏诊断；路径/输出验证仍由宿主执行。
- 取消、超时和宿主退出时的子进程终止证明；状态未知时 fence 服务，恢复只查询原 job，不重提推理。
- 可重复的隔离、撤销、重启恢复和发布测试，确保 fixture、私钥、凭据及测试 adapter 不进入生产包。

可以先评审标明 draft 的候选协议；在这些条件满足前，不导出稳定 ABI、不自动信任 npm 包、不新增工作区动态 import 路径。未来 schema、权限、投递或生命周期语义变化需要单独 ADR 与迁移/回滚说明，不能借 ABI 接入隐式改变。

当前受支持的扩展方式仍是[架构边界](architecture-boundaries.md#扩展步骤)中的受审查内置实现。
