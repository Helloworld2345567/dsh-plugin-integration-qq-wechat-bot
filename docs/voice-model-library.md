# 语音与本机音色模型库

简体中文 | [English](en/voice-model-library.md)

在“服务”配置安装级模型与推理服务，再到“机器人 → 媒体”分别选择 TTS 说话音色和 STS 唱歌音色。服务、权重和本机路径由运营者维护；机器人只保存 Profile 引用与业务偏好。

## 配置模型库

服务栏填写共享项目的 `models` 目录、GPT-SoVITS 地址及所需的 Breeze 地址、音色目录和启动目录。GPT-SoVITS 默认使用本机 9880 端口，Breeze 默认使用 8080。首次配置可由[配置参考](configuration.md)中的环境变量提供默认值，保存后的面板设置优先。

当前扫描器以模型根目录的父目录作为外部项目根，读取该项目的 `.codex/venv`、`RVC` 和 `GPT-SoVITS` 布局。模型按服务、角色和版本分目录：

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

新增后点击“刷新”。扫描器生成或更新 `model.json`，保留稳定 ID、名称、版本、相对路径和参考文本/语言；移动整个库不需重建 ID。RVC 索引可省略，此时检索比例为零。GPT-SoVITS 需要配套 GPT/SoVITS 权重及有效参考音频和文字；多组资源无法确定配对、损坏或 ID 重复时，拆分目录或修正 `model.json` 后重试，不会自动猜选。

HuBERT、RMVPE、文本编码模型和基座仍使用外部项目原有布局，不复制到每个角色目录。保存设置立即返回，相关扫描在后台完成。相同资源重复刷新不改变 Profile 版本；资源替换并刷新后，旧轮次不能继续使用旧资源版本。

Breeze 从 `/v1/voices` 和配置目录的 `.breeze` 文件发现音色。离线扫描可以先显示音色，实际合成仍需服务在线。刷新不会自动启动服务；填写受信项目启动目录后，点击启动按钮才执行固定启动器并等待健康检查。Windows 启动的长期服务脱离 DSH/Harness 直接子进程树，插件退出不自动停止它们。RVC 和 Music 按任务运行，没有常驻服务按钮。

## 选择音色与回复方式

在机器人媒体页选择音色会更新草稿、开启对应能力并补齐工具和技能，点击“保存”后从下一轮生效。缺失、已停用或配置不完整的 Profile 不可应用；不会静默换用其他模型。

TTS 提供两种回复方式：

- **按需语音**：用户请求朗读时调用 `bot_voice`。
- **文字加自动语音**：为聊天、定时任务和主动会话的最终正文追加音频。本轮已尝试显式语音或 STS 时不重复朗读。跳过代码块和裸链接，保留链接文字；文本过长、无可读内容或合成失败时保留文字。

| 提供方 | 配置与输出 | 限制 |
| --- | --- | --- |
| Edge TTS | 安装[可选语音依赖](python-dependencies.md)，无需 API key，输出 MP3 | 使用内置 `edge_tts` 协议 |
| GPT-SoVITS | Profile 保存服务、配套权重和 3～10 秒参考音频；参考文字须与音频一致。非流式 WAV，支持语速 | 风格请求降级为普通朗读，不支持 `chant` 或显式 MP3 |
| Breeze TTS | `breeze-tts-2-cpp` 的已保存音色，JSON `response_format=wav`；输出 24 kHz 单声道 WAV | 中文、英文为官方支持范围，日语仅实验；语速参数不生效并记录降级信息 |

GPT-SoVITS 支持 v1、v2、v2Pro、v2ProPlus、v3、v4、v5dev、v5turbo，所填版本必须匹配实际权重。每次按队列完整加载 SoVITS、GPT 和参考音频，不缓存当前角色。一个实例由一个机器人进程独占，任务期间不要人工切模型或重启。首次接入，以及改变相同参考文本的语言或 v1/非 v1 文本前端家族时，先重启服务清除旧缓存；相同参考文本应使用一致语言和前端家族。客户端取消不保证服务端计算立即停止。

QQ 语音和长音频规则见 [QQ 媒体投递](qq-media-delivery.md)；微信以可播放音频文件发送。RVC 环境及人声分离见 [STS 接入](singing-conversion.md)。

## 临时切换会话音色

可信私聊先 `list`，再用返回的准确 ID `set`；`reset` 恢复机器人默认值：

```text
/tts list
/tts set edge/zh-CN-XiaoxiaoNeural
/tts set gpt-sovits/<profileId>
/tts set breeze-tts/<profileId>
/tts reset
/sts list
/sts set rvc/<profileId>
/sts reset
```

切换只保存会话覆盖，从下一轮生效；新会话、恢复历史会话和切换人格时保留覆盖。Profile 须为 `ready`，机器人须已开启对应能力，命令不能代为开启。自然语言切换通过 `bot_voice_control` 使用同样的 list/set/reset 流程。

## 验收

模型扫描、配置完整与 health 成功都不等于音色可用。检查完整音频并试听目标角色后，登记当前配置版本的合成验收，版本变化后重新验收。尤其需核对从文件名推导的参考文字是否与音频一致。缺失音色、服务不可用或格式错误会明确报告，不自动回退提供方。
