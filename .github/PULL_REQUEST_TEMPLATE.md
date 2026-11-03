## 变更说明

<!-- 简述问题、方案和不在范围内的内容。不要承诺未完成的英文 UI、第三方 Adapter ABI 或外部服务验收。 -->

## 类型

- [ ] 功能或修复
- [ ] 文档
- [ ] 依赖/供应链
- [ ] 安全
- [ ] 发布/CI

## 验证证据

<!-- 粘贴实际命令及结果；不要粘贴凭据、平台 token、用户 ID、本机路径、数据库或未脱敏日志。 -->

```text
npm run typecheck
npm test
npm run test:python
npm run build
npm run check:release
npm run verify:release
```

- [ ] 已运行与本变更相关的 Harness 原生测试、生命周期测试和安装 smoke
- [ ] 若跳过某项，已说明原因和剩余风险
- [ ] 已检查 `git diff --check`
- [ ] 未修改、暂存或提交 `fix_plan.md`
- [ ] 未加入运行时数据、凭据、模型权重、数据库、日志、归档或临时文件
- [ ] 未 push、publish 或发送平台消息

## 依赖和许可证（如适用）

- 依赖名称、版本范围、运行时/开发时范围：
- 升级原因和 Node 24 / Harness `0.2.1-rc.2` / Windows 兼容性证据：
- 上游地址、许可证和第三方声明变化：
- 是否需要回滚或暂缓处理：

## 风险与回滚

<!-- 说明 QQ/微信业务逻辑、核心权限模型、媒体协议和 Harness 扩展行为是否保持不变。 -->
