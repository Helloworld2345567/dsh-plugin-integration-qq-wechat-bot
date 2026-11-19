# RVC 音色转换（STS）

简体中文 | [English](en/singing-conversion.md)

STS 将选定音频转换为机器人所选 RVC 音色，使用 `bot_sing` 和 `singing-conversion`。文字朗读使用独立的 TTS 能力，见[音色与模型库](voice-model-library.md)。

## 环境与配置

运营者需准备 RVC Python 环境、FFmpeg/ffprobe、HuBERT/ContentVec、RMVPE、RVC v1/v2 的 F0 权重及可选匹配索引。GPT-SoVITS 权重不能用于 RVC；无索引时检索比例须为零，损坏索引会报错。

在“机器人 → 媒体 → 音色转换 STS”开启能力并选择可用 Profile。说话人、音高（半音）和检索比例均可留空以继承 Profile。填写 `0` 会覆盖对应的 Profile 值。CLI 和 HTTP 服务都使用轮次开始时的机器人设置。模型路径、版本、解释器、设备、分离器和服务地址由 Profile 管理。默认输出 MP3 192 kbps，也支持 WAV。

模型库登记的 `rvc_cli_v1` Profile 按任务运行，无需常驻服务。使用 `rvc_http_v1` 时，在插件目录启动适配服务（变量填写实际路径）：

```powershell
& $env:RVC_PYTHON -B python/rvc_service.py --rvc-root $env:RVC_ROOT --data-dir $env:RVC_DATA_DIR --device cuda --port 9881
```

无 CUDA 时使用 `--device cpu`。服务只监听回环地址，与 GPT-SoVITS 分开运行；兼容时可共享 Python 环境。推理使用 RVC 的 `VoiceConverter` 接口，每个任务独立加载模型。

## 选择来源

| 操作 | 用途 |
| --- | --- |
| `prepare` | 登记当前会话音频附件或真实公开候选，不开始下载或推理 |
| `list` | 查看当前候选集与编号 |
| `convert` | 按候选集、编号、声源类型和可选格式转换 |
| `sing` | 按歌名/歌手或 Music 搜索候选翻唱，见[音乐接入](music-integration.md) |

可上传音频（含实际可解码的普通文件），或提供公开 HTTPS 音频、B站和抖音链接。附件和候选必须属于当前会话；旧候选编号不能指向后来替换的来源。明确的转换请求或等待上传状态可绕过前置 ASR，普通语音仍自动转写。

纯人声使用 `vocals`；不确定时先确认是否含伴奏。`mixed` 需要在 RVC Profile 私有配置中启用分离，设置 `vocals` 或 `vocals-aggressive` 模型及权重，并选择是否混回伴奏和音量。默认分离关闭，此时请提供纯人声；曲库歌曲按混音处理。

## 输出、取消与恢复

本地音频输入预算为 **100 MiB**，生成音频上限为 **200 MiB**。按歌名翻唱输出完整且严格小于 20,000,000 字节的 MP3；显式上传转换可保留 WAV。超限会失败，不截短或暗中换格式。QQ 语音分段、完整文件和上传限制见 [QQ 媒体投递](qq-media-delivery.md)。

本轮使用冻结的机器人与 Profile 配置；撤销权限、关闭 STS 或切换会话会阻止后续执行和投递。每次显式转换建立独立任务，同一轮可多次调用；失败不自动重跑或换源。取消会停止受控进程，服务端是否停止不明确时阻止后续转换，确认空闲后恢复。

转换成功只登记当前会话附件，实际发送由持久投递队列处理。投递恢复复用原附件，不重新推理；提交结果未知时不盲目重发。本轮尝试 STS 后不再自动 TTS 朗读结果说明。

## HTTP 适配协议

| 接口 | 行为 |
| --- | --- |
| `GET /health` | 协议、状态、活动任务和队列信息，不启动推理 |
| `POST /v1/jobs` | multipart `audio` 与宿主冻结的 JSON `parameters` |
| `GET /v1/jobs/{id}` | 查询 `queued/running/succeeded/failed/cancelled` |
| `GET /v1/jobs/{id}/result` | 读取成功任务的完整 WAV |
| `DELETE /v1/jobs/{id}` | 取消进程树并清理部分输出 |

服务采用单槽 FIFO；同一 job ID 不重复推理，提交响应未知时只查询。路径、身份和模型参数由宿主生成，模型不能覆盖。协议实现见 [rvc_service.py](../python/dsh_bot_runtime/rvc_service.py)。

## 验收与限制

配置完整和 health 可用均不代表真实音色验收。完整转换并试听目标角色后，登记当前配置版本的验收；配置变化后重新验收。自动测试不能证明真实模型音色或平台送达，开发检查见[测试指南](testing.md)。

外部来源可能失效；模型、分离质量、内存和推理耗时取决于目标设备及音频长度。模型权重、服务私有配置、验收音频和运行记录不进入发布包。
