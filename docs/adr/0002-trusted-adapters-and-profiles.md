# ADR 0002：仅加载受信适配器并冻结 Profile revision

简体中文 | [English](../en/adr/0002-trusted-adapters-and-profiles.md)

- 状态：已接受
- 日期：2026-11-03

## 背景

媒体服务适配器可以接触本机进程、模型资源和服务端点。若从人格目录、工作区或聊天输入动态加载代码，会绕过渠道身份、作业目录、权限、配额和输出校验边界。

## 决策

1. 当前版本只加载随主包编译并经过代码审查的内置 Service Adapter。
2. 人格只保存业务选择和 `profileRef`；服务端点、本机路径、模型权重和凭据属于 Profile 私有配置。
3. Profile revision 与 content hash 不可变，并在轮次和作业开始时冻结。新增权限和配置从下一轮生效；撤权、禁用和撤销立即阻止后续执行与投递。
4. Adapter 输出必须回到宿主分配的作业目录，并由宿主重新验证后才能登记为 Asset。
5. Health 仅表示当前可探测；真实 TTS、RVC 和完整下载由绑定人格及 Profile revision 的 Acceptance 记录表示。

## 结果

第三方 Adapter 暂不具备稳定运行时 ABI。未来开放时必须另行定义签名、来源、撤销、子进程隔离和兼容性策略，不能把当前内部 TypeScript 接口视为公共承诺。
