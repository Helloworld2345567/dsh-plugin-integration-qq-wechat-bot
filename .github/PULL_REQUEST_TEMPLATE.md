## 变更说明 / Changes

<!-- 简述问题、最终行为和范围。Describe the problem, resulting behavior and scope. Do not claim unfinished third-party Adapter ABI or external-service acceptance. 不承诺未完成的第三方 ABI 或外部服务验收。 -->

## 类型 / Type

- [ ] 功能或修复 / Feature or fix
- [ ] 文档 / Documentation
- [ ] 依赖与供应链 / Dependencies and supply chain
- [ ] 安全 / Security
- [ ] 发布与 CI / Release and CI

## 验证证据 / Verification evidence

<!-- 写实际命令/结果，排除凭据、token、ID、路径、数据库和未脱敏日志。Include actual commands/results without credentials, tokens, IDs, paths, databases or unsanitized logs. -->

```text
npm run typecheck
npm test
npm run test:python
npm run build
npm run check:release
npm run verify:release
```

- [ ] 已运行适用的 Harness 原生、生命周期及安装 smoke / Ran applicable native, lifecycle and installation smoke tests
- [ ] 已说明跳过项及剩余风险 / Explained skipped checks and remaining risks
- [ ] 已同步中英文文档/词条，或说明不适用 / Updated both documentation/locale versions, or explained why not applicable
- [ ] 已检查 `git diff --check` / Checked `git diff --check`
- [ ] 未修改、暂存或提交 `fix_plan.md` / Did not change, stage or commit `fix_plan.md`
- [ ] 未加入运行数据、凭据、模型、数据库、日志、归档或临时文件 / Added no runtime data, credentials, models, databases, logs, archives or temporary files
- [ ] 未 push、publish 或发送平台消息 / Did not push, publish or send platform messages

## 依赖和许可证（如适用） / Dependencies and licenses (if applicable)

- 名称、版本范围、运行/开发范围 / Name, range, runtime/development scope:
- 原因及 Node 24 / Harness `0.2.1-rc.5` / Windows 证据 / Reason and compatibility evidence:
- 上游、许可证与第三方声明 / Upstream, license and notices:
- 回滚或暂缓 / Rollback or deferral:

## 风险与回滚 / Risks and rollback

<!-- 说明渠道业务、权限、媒体协议与 Harness 行为影响。Describe impacts on channels, permissions, media protocols and Harness behavior. -->
