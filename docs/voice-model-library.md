# 本机音色模型库

在机器人面板打开“人格 → 媒体”。“语音 TTS”和“变声 STS”各自提供音色下拉框；展开“连接”可修改安装级配置：

- **模型目录**：共享 TTS/STS 项目下的 `models` 目录，TTS 与 STS 共用。
- **服务地址**：HTTP 推理服务地址。
- **Breeze TTS 地址**：`breeze-tts-2-cpp` HTTP 服务地址，默认 本机 HTTP 8080 端口。
- **启动目录**：可选的、由运营者明确配置的外部项目目录。填写后面板可以启动 GPT-SoVITS 或 Breeze；插件不会接受任意启动命令。
- **Breeze TTS 音色目录**：保存 `.breeze` 文件的目录，例如外部 Breeze 项目的 `voices` 目录。刷新时自动识别音色；未启动 Breeze 时也能显示模型，合成前仍需启动服务。

点击“保存”。当前内置扫描器把模型根目录的父目录视为运营者外部项目根，并读取该项目管理的 `.codex/venv` Python 环境、`RVC` 和 `GPT-SoVITS` 相对布局；这些目录和其中的权重都不属于主包。Breeze TTS 通过服务地址读取 `/v1/voices`，并在配置的音色目录中扫描 `.breeze` 文件；服务未启动时仍可先识别音色，但健康检查和实际合成仍要求服务运行。面板不会在刷新或合成时自动启动服务；只有填写启动目录并点击对应按钮时，才会执行固定的外部启动器，然后等待健康检查。首次配置也可通过宿主的 `BOT_VOICE_MODELS_ROOT`、`BREEZE_TTS_URL`、`GPT_SOVITS_ROOT`、`BREEZE_TTS_ROOT` 和 `BREEZE_TTS_VOICES_ROOT` 环境变量提供默认值；保存后的面板设置优先。下文文件名和 `<external-project>` 目录仅是脱敏占位示例，不是本机路径，也不代表主包包含这些权重。

## 整理和新增模型

共享项目提供独立 `scripts/model_catalog.py` 入口；bot 调用相同的扫描逻辑。目录按服务、角色 ID、版本组织，例如：

```text
models/
  rvc/character/v2/
    model.pth
    model.index
    model.json
  gpt-sovits/character/v4-zh/
    gpt.ckpt
    sovits.pth
    references/default.wav
    model.json
```

新增模型放入独立目录后，点击“刷新”。扫描器检查文件内容与配套关系，自动生成 `model.json`，保留中文显示名、稳定 ID、版本、文件相对路径和参考文本/语言。说明文件随模型包保存，移动整个库不需要重建 ID。

RVC 的索引可省略，无索引时检索比例为零。GPT-SoVITS 必须提供 GPT、SoVITS 权重和有效参考音频/文本。单组资源可自动配对；多组权重、多个无法确定的参考音频或损坏文件会显示缺项或歧义。可将模型拆成独立目录，或补充生成的 `model.json` 后重新刷新；系统不会猜选另一组资源。

共享 HuBERT、RMVPE、文本编码模型、GPT-SoVITS 基座和声码器继续使用项目的原有布局。它们属于服务环境，不重复复制到每个角色目录。

## 使用音色

在人格的“媒体”分区，分别打开 TTS 的“说话”和 STS 的“唱歌”下拉框选择模型。选择会立即保存对应 Profile、开启能力并补齐工具和技能；GPT-SoVITS 和 Breeze TTS 使用 WAV，其他能力和业务偏好保留。新选择从下一轮生效。

人格存在未保存修改时，先保存或取消修改再选择音色，避免一起提交其他编辑。文件缺失、配置不完整或已停用的 Profile 不可应用。另一页面已经修改人格时，本次保存会报告冲突。

面板仅保留音色选择、业务配置和明确的启动入口。新增模型后，在“连接”中点击“刷新”；刷新不会自动启动服务、自动切换人格，也不会封锁手工登记的其他 Profile。RVC 是按任务启动的 Worker，Music 是按任务执行的工具，两者没有常驻服务按钮。

## 接口与版本

- `service.settings`：读取模型库设置、启动目录、配置 revision 和逐模型诊断。
- `service.settings.save`：保存 `modelsRoot`、服务地址、GPT-SoVITS/Breeze 启动目录、Breeze 音色目录与 `expectedRevision`，并刷新模型目录及 Breeze 音色列表。
- `service.start`：只接受 `gpt-sovits` 或 `breeze-tts`，使用固定启动器启动已配置的外部项目；服务已运行时返回 `already-running`，插件退出不会停止外部进程。
- `service.refresh`：对 `rvc`、`gpt-sovits` 或 `breeze-tts` 刷新服务；RVC 与 GPT-SoVITS 共享一次扫描，Breeze 读取其 HTTP 音色列表。
- `catalog.profiles`、`service.health` 和 `config.save` 继续提供列表、检查与人格应用。

模型资源摘要和发现来源保存在 Profile 私有元数据中，适配器只接收执行配置。相同内容重复刷新不产生新 revision；变更一个角色不影响其他角色，训练日志不参与模型身份。资源原路径被替换并刷新后，旧轮次不能再以旧资源版本执行；后续轮次使用新版本。

## Limitations / Known Issues

模型扫描和 Breeze 音色列表读取都不等于实际推理验收。参考文本从音频文件名推导时，需要运营者核对其与音频内容一致。新增格式不明确、说明文件 ID 重复或配套关系不唯一时，需要先修正模型包。Breeze 服务未启动、音色被删除或服务返回非 WAV 音频时，Profile 会显示不可用；插件不会自动回退到其他提供商。
