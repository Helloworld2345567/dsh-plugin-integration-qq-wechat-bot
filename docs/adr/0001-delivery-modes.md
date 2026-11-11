# ADR 0001：区分已有 Harness 安装与独立产品 profile

简体中文 | [English](../en/adr/0001-delivery-modes.md)

- 状态：已接受
- 日期：2026-11-03

## 背景

项目既可以作为普通 Harness bundle 加入已有 profile，也包含安装器、工作区和生命周期协调器，可部署隔离的机器人产品 profile。过去两种流程混在同一安装章节，用户无法判断各自会修改什么、获得哪些生命周期能力。

## 决策

保留两种交付方式，但文档和职责严格分开：

1. **已有 Harness 安装**只通过 `dsh plugin --profile <profile> add <package>` 安装主 bundle，不手工改写用户 profile，不自动安装生命周期协调器。
2. **独立产品 profile**由 `scripts/install.mjs` 创建和管理隔离的 `bots` profile、产品数据目录、工作区、主 bundle 与 `dsh-bot-lifecycle`。
3. 主包继续内置 `bot-unified-chat` Agent preset；不再发布重复的 `packages/bot-unified-chat` 子 bundle。
4. 文档和管理 UI 支持简体中文与英文；两种交付方式共享相同语言资源和语言规则。

## 结果

普通 Harness 用户获得最小侵入安装路径；产品运营者保留受监督启动、升级和回滚。两种模式共享主插件代码和发布归档，但生命周期能力边界必须在各自文档中明确。
