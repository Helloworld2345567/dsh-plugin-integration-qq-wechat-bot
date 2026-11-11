# RVC 音色转换（STS）接入与验收

简体中文 | [English](en/singing-conversion-plan.md)

本插件通过受管 RVC Profile（`rvc_cli_v1` 或 `rvc_http_v1`），将用户选定的纯人声音频转换为当前人格配置的 RVC 目标音色。普通 TTS 继续使用 `media.voice` 和 `bot_voice`；STS 使用 `media.singing`、`singing-conversion` 和 `bot_sing`。

## 运行环境与推理入口

适配器使用 RVC 项目当前的 `rvc.vc.engine.VoiceConverter`、`VoiceConversionConfig` 和 checkpoint 公共接口，不依赖 Gradio 页面协议。服务解释器须已安装该 RVC 包和推理依赖；支持独立进程共用已兼容的 RVC/GPT-SoVITS Python 环境。设备由服务启动参数明确选择 `cpu` 或 `cuda`，关闭 CUDA Graph。

服务需要 FFmpeg/ffprobe、匹配 RVC 的 Transformers HuBERT/ContentVec、RMVPE `rmvpe.pt`、RVC 推理 `.pth` 和可选匹配 `.index`。GPT-SoVITS 的角色权重不能用于 RVC。

```powershell
# 在插件目录执行，变量由运营者填写。
& $env:RVC_PYTHON -B python/rvc_service.py --rvc-root $env:RVC_ROOT --data-dir $env:RVC_DATA_DIR --device cuda --port 9881
```

服务仅监听回环地址。每个任务以专用子进程执行 `python/rvc_runner.py`，通过配置父目录及显式文件路径读取资源。runner 校验模型声明版本、`f0=1`、speaker 范围和索引维度（v1 为 256，v2 为 768）；配置了损坏索引即失败，不能悄悄关闭检索。推理采用 RMVPE、`resample_sr=0`、`rms_mix_rate=1.0`、`protect=0.33`，保留 RVC 原生长音频处理。

## 人格与 Profile 配置

V4 人格的 `media.singing` 保存 `enabled`、`profileRef` 和业务偏好。默认关闭，启用后必须选择可用的 RVC Profile。

服务协议、服务地址、Python 解释器、RVC 项目目录、模型版本、`singingWeightsPath`、`singingIndexPath` 和 `separation.modelPath` 均保存在 Profile 私有配置中。CLI Profile 指定 `python`、`rvcRoot`、`device`；HTTP Profile 指定 `baseUrl`。这些参数不能写回人格文件。

目标 Profile 修订版本在转换所属轮次冻结。关闭 STS、撤销工具/技能权限或切换会话，会阻止后续执行和产物投递。模型文件与服务地址不进入模型可见摘要或工具结果。

## HTTP 协议与生命周期

`rvc_http_v1` 是本插件的适配协议。

| 接口 | 行为 |
| --- | --- |
| `GET /health` | 返回协议、服务状态、活动任务和排队数量，不启动推理 |
| `POST /v1/jobs` | multipart 字段 `audio` 上传源音频，`parameters` 传宿主冻结的 JSON 配置 |
| `GET /v1/jobs/{id}` | `queued`、`running`、`succeeded`、`failed`、`cancelled` |
| `GET /v1/jobs/{id}/result` | 成功后返回完整 `audio/wav` 字节 |
| `DELETE /v1/jobs/{id}` | 取消任务，确认进程树退出并清理部分输出后返回 |

JSON 参数包含 `jobId`、`modelVersion`、`singingModelId`、`singingWeightsPath`、可选 `singingIndexPath`、`speakerId`、`pitchShift` 和 `indexRate`。所有字段由宿主从冻结配置生成，聊天模型不能提供路径、身份或服务地址。

服务维护单槽 FIFO，覆盖加载、推理、输出检查和取消清理。同一规范化服务地址也受宿主串行队列约束。相同 job ID 不重复推理；提交响应未知时只查询，不再次提交。取消由宿主直接向服务发出，不依赖可能已经终止的媒体 worker。无法确认停止时记录服务状态未知并阻止后续转换，确认服务空闲后恢复。

## 候选、输入与投递

`bot_sing` 提供三个动作：

- `prepare`：登记当前会话音频附件，或最多五个真实搜索候选；不下载、不推理。空来源表示等待用户上传音频。
- `list`：列出当前候选集、编号、标题和公开来源。
- `convert`：使用候选集 ID、候选编号、声源类型和可选输出格式转换。

歌曲名称通过 `bot_sing action=sing` 的 `song/artist` 调用 Music 曲库获取最高匹配；也可使用 `bot_music search` 返回的 `candidateSet/candidate` 保留明确选择。当前会话已获取的同曲源音频直接复用，不重新下载或先压缩原曲。曲库歌曲按混音处理，RVC Profile 须可用，分离配置由适配器验证；成品从最终 WAV 直接编码为完整且严格小于 20,000,000 字节的 MP3。音乐接入配置见 [音乐接入说明](music-integration.md)。

用户明确提供的公开 HTTPS 音频直链、B站和抖音链接继续走 prepare/convert，复用底层下载和音轨提取，不触发视频投递。保留公开来源和可得许可信息；普通 HTML 页面不能冒充音频。

候选保存到 Store records，绑定 scope、session、generation 和独立候选集 ID；旧候选编号不能命中后来替换的来源。附件必须属于当前会话，支持 `audio` 和经 worker 实际解码确认的 `file`。用户正文的明确转换请求、或已登记等待上传状态，可以绕过前置 ASR；引用和网页内容不触发，普通语音继续自动转写。

声源为 `vocals` 时执行 RVC；`unknown` 时询问是否含伴奏；`mixed` 在所选 Profile 未配置分离时拒绝并提示提供纯人声，分离配置完整后由 RVC/PyMSS runner 先提取人声，再按 `instrumentalMix` 和 `volume` 决定混回伴奏。工具同时要求 STS 开启、`bot_sing` 权限和 `singing-conversion` 技能。`bot_media` 拒绝 `singing_convert`。

首次下载/推理前建立当前请求的转换 attempt；重新准备候选不能重置尝试。成功复用已有结果，失败、取消或未知不自动重试，不自动更换候选。用户下一次明确请求才能新建尝试。

服务固定返回 WAV，worker 按选定格式输出 WAV 或 MP3 192 kbps，并检查完整解码、有效采样、非静音、时长匹配和大小。源音频保留 100 MiB 本地处理预算，生成音频和 QQ 音频投递支持到 200 MiB；视频来源沿用已有视频下载限制，提取音频后再检查音频限制。QQ 渠道发送准备会保留原始成品，另生成每段不超过 300 秒的 SILK 语音气泡；超过单条语音长度时分段播放并额外发送完整 MP3，不丢弃歌曲尾部。QQ 直传只用于不超过 5,000,000 字节的文件，更大文件走官方分片上传。

成功只登记一个当前 scope/session 的 audio Asset，沿现有持久投递队列发送。投递失败恢复现有 Asset，不重新推理；保留 `unknown` 投递语义。工具返回安全状态、文件名和格式，不返回内部路径或 Asset ID。本轮 STS 尝试后，不额外自动 TTS 朗读结果说明。

## 管理与验收

“媒体 → 音色转换 STS”卡片提供独立配置。启用时加入所需工具和技能权限；关闭配置可保存未完整草稿。卡片分别显示：

- 配置完整性：字段齐全不等于模型可运行。
- 协议验证：`skill.singing.probe` 读取 `/health` 并登记 `singing_protocol` 状态。
- 真实音色验收：完整转换、检查结果并试听后，通过 `capability.record` 登记 `singing` 状态和依据。
- 分离状态：管理页显示协议、模型 ID、路径是否完整、混音开关和音量；默认关闭，配置完整后允许运行 `mixed`。

验收记录绑定人格 ID 和 revision；配置变化后显示尚未验收。测试应覆盖候选与附件归属、ASR 兼容、三重权限、冻结参数、单次 attempt、输出限制、协议状态、FIFO 取消和投递复用。发包前执行：

```text
npm run typecheck
npm test
npm run test:python
npm run build
npm run check:release
```

协议与 mock 测试只能证明接口和生命周期。真实角色验收另行记录输出时长、转换耗时及试听结果，不将合成模型测试当作真实音色验收。本机服务配置、角色权重、运行记录和生成音频不进入发布包。

## Limitations / Known Issues

- 分离使用当前 RVC/PyMSS runner；模型完整性和实际音频质量仍需在目标设备单独验收。
- 真实模型、HuBERT、RMVPE 及索引需由运营者准备；版本和资源可用性须在目标设备验证。
- 每任务重新加载模型会增加耗时，吞吐和内存需求随设备、模型及音频长度变化。
- 搜索和公开下载来源可能失效，候选存在不代表下载或转换成功。
