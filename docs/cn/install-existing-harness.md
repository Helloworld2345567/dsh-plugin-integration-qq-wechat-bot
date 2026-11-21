# 安装到已有 DeepSeek Harness

简体中文 | [English](../en/install-existing-harness.md)

本方式只向已有 profile 添加主插件，不安装独立生命周期协调器。环境要求和首次配置见[快速开始](getting-started.md)；需要受监督启动与受管升级时，选择[独立产品部署](deploy-product-profile.md)。

## 从源码安装

先停止使用目标 profile 的 Harness，再在项目根目录执行。将 `my-profile` 替换为已有 profile 名称：

```powershell
$profileName = 'my-profile'
npm ci
python -m pip install -r requirements.txt
npm run verify:release
dsh plugin --profile $profileName add .
dsh --profile $profileName --no-open
```

`verify:release` 已包含构建。安装通过 Harness 插件命令完成，不手工修改 profile 的 `package.json` 或复制 `cordis.patch.yml`。

媒体 worker 默认使用 `python`。若使用其他解释器，在启动 Harness 前设置 `BOT_PYTHON`，并用该 Python 3.12/3.13 解释器安装上述依赖。需要 Edge TTS 时，再向同一环境安装：

```powershell
python -m pip install -r requirements-voice-generation.txt
```

打开 Harness 设置，确认“机器人面板”出现，然后按[首次配置与验证](getting-started.md)创建人格、授权渠道并测试文本。面板缺失时，检查目标 profile 是否加载 `dsh-plugin-integration-qq-wechat-bot`，以及 Harness 是否为 `0.2.1-rc.5`。

## 更新、回滚与移除

由运营者按现有 Harness profile 的维护流程停止进程、备份数据并替换主包。源码版本先通过 `npm run verify:release`；保留上一版可信源码或归档，以便需要时停机恢复。此模式不提供项目的热升级、监督重启或自动回滚，也不承诺未声明的跨版本组合兼容。

移除插件使用该 Harness 版本的 Plugin Manager/设置页面移除动作；不要手工删除依赖或 profile 文件。移除插件与清除运行数据是不同操作，先备份需要保留的人格、会话、附件和凭据。

GPT-SoVITS、Music、RVC、CUDA 与模型权重须另行部署。变量与路径见[配置参考](configuration.md)，故障处理见[排障](troubleshooting.md)。
