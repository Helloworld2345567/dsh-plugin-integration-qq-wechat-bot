# 歌曲音色转换实施计划：RVC

日期：2026-10-31

状态：计划，尚未实施

## 1. 目标与调查结论

在机器人中增加独立歌曲音色转换能力：取得用户选定的纯人声音频，使用当前人格配置的 RVC 模型转换，作为音频附件发送。输入支持当前会话附件，以及由歌曲名称搜索、选择后取得的音频。

本次交付仅为计划文档。以下新增配置、接口、代码、测试和部署动作均属于后续实施工作。

已确认的技术结论：

- 当前 GPT-SoVITS 没有可调用的原生 STS；`/tts` 接收文本，不能替代歌曲转换。官方调查基线中的变声页面仍为[“施工中”](https://github.com/RVC-Boss/GPT-SoVITS/blob/b4570b876f5c086819ba84e3215472733c6a7b70/webui.py#L1974)。
- 转换后端采用用户指定的 [RVC 官方仓库](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI)，调查与首次接入基线固定为 `81eed5e8f68b6bed1789f682fe78cdd324495afc`。
- 小樱现有可莉 v4 属于 GPT-SoVITS TTS 权重，与 RVC 模型结构不兼容。歌声转换必须配置独立 RVC `.pth`，可选配套 `.index`。
- 已检查的本机模型目录中未发现 RVC 角色权重；本机无可用 CUDA。首次部署采用独立 Python 3.12、CPU FP32 环境。
- 保留现有 `media.voice`、`voice-generation`、`bot_voice` 及小樱普通 TTS 配置和行为。歌曲转换不扩展普通 `bot_voice` 的 `speak` 或 `chant` 语义。

## 2. RVC 服务与人格配置

### 2.1 原生入口与模型要求

使用薄 runner 调用[官方推理入口](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/blob/81eed5e8f68b6bed1789f682fe78cdd324495afc/infer/vc/modules.py#L226)，不修改推理算法：

```python
vc = VC(config)
vc.get_vc(model_filename)
status, (sample_rate, audio) = vc.vc_single(
    speaker_id,
    input_audio_path,
    pitch_shift,
    "rmvpe",
    index_path,
    index_rate,
    0,
    1.0,
    0.33,
)
```

`get_vc` 从受控的 `weight_root` 加载角色模型；runner 将运营配置中的权重父目录和文件名分别映射到该目录和 `model_filename`。配置路径不由聊天模型提供。

| 原生参数 | 首版取值 |
| --- | --- |
| `sid` | 人格的 `speakerId`，默认 `0` |
| `input_audio_path` | 本任务已解码的源音频路径 |
| `f0_up_key` | 人格的 `pitchShift`，默认 `0` 半音 |
| `f0_method` | `rmvpe` |
| `file_index` | 人格明确配置的索引路径；未配置时为空 |
| `index_rate` | 有索引默认 `0.75`；未配置索引时为 `0` |
| `resample_sr` | `0`，保留模型采样率 |
| `rms_mix_rate` | `1.0` |
| `protect` | `0.33` |

原生加载器将输入解码为 16 kHz 单声道浮点；成功返回模型采样率及单声道 `int16` PCM。长音频使用原生分段、补边和拼接，不另做切片算法。

推理前检查角色 checkpoint 的版本、音高条件 `f0=1` 和 speaker 范围。支持 RVC v1/v2，优先配置 v2 F0 模型；实际版本必须与人格声明一致。配置了索引时，检查其可读取且特征维度匹配：v1 为 256 维，v2 为 768 维。损坏索引不得静默退回无检索推理。

原生 `vc_single` 可能捕获异常并返回 `(None, None)`，因此适配器必须验证实际音频，不能仅依据调用完成判定成功。原生状态文字可能包含工作路径和 traceback，只用于内部诊断，不进入工具结果或用户回复。

### 2.2 独立运行环境

按固定提交的[官方依赖清单](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/blob/81eed5e8f68b6bed1789f682fe78cdd324495afc/requirments_cpu_py312.txt)建立独立环境，不修改机器人或 GPT-SoVITS 的现有依赖。该版本采用 Python 3.12 和 Transformers HuBERT，不能套用旧版 fairseq 安装方案。

公共推理资源使用[当前官方资源清单](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI/blob/81eed5e8f68b6bed1789f682fe78cdd324495afc/docs/en/README.en.md#L133)：

- HuBERT 的 `config.json`、`preprocessor_config.json`、`pytorch_model.bin`。
- RMVPE 的 `rmvpe.pt`。
- 独立 RVC 角色 `.pth`，以及可选的匹配 `.index`。

官方 CLI 已存在，但没有 `--device` 参数。薄 runner 复用其配置构造方式，在创建 `VC` 前明确设置 CPU、FP32、关闭半精度、DirectML 和 CUDA Graph，避免自动设备选择改变本机验证路径。

### 2.3 最小 HTTP 适配协议

实现独立 HTTP 控制服务，每个转换任务启动一个专用 RVC 子进程。服务维护单槽 FIFO 队列，覆盖模型加载、推理、输出检查和取消清理。默认仅在本机提供服务。

协议标识为 `rvc_http_v1`，属于本项目适配协议，不称为 RVC 原生 HTTP API，也不依赖 Gradio 页面协议。

| 接口 | 请求与响应 |
| --- | --- |
| `POST /v1/jobs` | multipart 字段 `audio` 上传源音频，`parameters` 携带 JSON；包含宿主生成的 `jobId` 和冻结模型配置，返回任务 ID 与状态 |
| `GET /v1/jobs/{id}` | 返回 `queued`、`running`、`succeeded`、`failed` 或 `cancelled`；失败提供稳定错误码 |
| `GET /v1/jobs/{id}/result` | 成功后返回完整 `audio/wav` 字节，不返回服务端文件路径 |
| `DELETE /v1/jobs/{id}` | 取消排队或运行任务；确认子进程退出后返回 `cancelled` |

JSON 参数包含 `jobId`、`modelVersion`、`singingModelId`、`singingWeightsPath`、可选 `singingIndexPath`、`speakerId`、`pitchShift` 和 `indexRate`。这些模型参数由宿主从冻结人格配置生成，不接受模型工具参数覆盖。输出 WAV 固定由服务生成，最终 MP3 编码由机器人媒体 worker 完成。

同一 `jobId` 重复提交复用已有任务。提交结果未知时查询状态，不自动重新提交推理；服务重启导致任务状态无法确认时记录中断或未知，不重放任务。

排队取消直接移除作业。推理取消终止该任务及 FFmpeg 子进程树，等待退出、删除部分输出后释放队列。仅断开 HTTP 请求不视为服务端推理已停止。

机器人宿主保留任务 ID 并负责发起服务端取消，不能依赖已被终止的媒体 worker 自行通知服务。无法确认服务状态时停止向该服务提交后续转换，待确认服务空闲或重新启动后恢复。

错误分为配置/模型不兼容、来源不可用、下载失败、音频无效、分离未配置、推理失败、结果超限、取消和服务状态未知。对外只返回稳定错误码和可读说明；日志中的内部路径及原生 traceback 不透传。

### 2.4 人格配置

新增可选的 `media.singing`，与普通 `media.voice` 独立：

| 字段 | 默认或约束 |
| --- | --- |
| `enabled` | `false` |
| `protocol` | `rvc_http_v1` |
| `serviceUrl` | 独立 RVC 适配服务地址，由运营者填写 |
| `modelVersion` | `v1` 或 `v2`，与实际 checkpoint 一致 |
| `singingModelId` | 运营者指定的模型名称 |
| `singingWeightsPath` | RVC 服务端的独立角色 `.pth` 路径 |
| `singingIndexPath` | 可选、与模型匹配的 `.index` 路径 |
| `speakerId` | `0`；必须在模型 speaker 范围内 |
| `pitchShift` | `0` 半音 |
| `indexRate` | 有索引默认 `0.75`；无索引固定为 `0` |
| `defaultOutput` | `mp3`，192 kbps；可选 `wav` |
| `separation` | `{ "status": "unconfigured" }` |

旧人格无需迁移，也不自动开启。小樱的歌声配置保持未配置，等待提供 RVC 角色模型；不从普通 TTS 配置推导权重、参考音频或服务设置。RVC 的目标音色由角色模型决定，不需要继承 TTS 参考语音。

## 3. 机器人处理流程

### 3.1 独立工具与候选选择

新增 `singing-conversion` skill、`bot_sing` 工具及 `singing_convert` 媒体操作。skill 通过项目既有声明和打包机制分发。

`bot_sing` 提供三个动作：

- `prepare`：登记当前会话附件，或最多五个真实搜索候选；不下载或启动转换。无来源时可登记等待上传音频的状态。
- `list`：返回当前会话候选编号、标题和公开来源。
- `convert`：使用选定候选、声源类型及输出格式启动转换。

歌曲名通过现有 `web_search`、`web_fetch` 发现候选，再由用户选择；用户已明确指定单一来源时直接继续。联网权限或搜索能力不可用时明确说明，并允许改用当前会话附件。

候选及选择状态保存到现有 Store records，绑定 scope、session、generation 和候选集。每个 scope 只保留当前候选集，旧编号不能指向后来替换的来源。不增加数据库迁移框架。

转换目标在 `convert` 所属轮次冻结，符合人格切换从下一轮生效的规则。候选准备时不提前固定目标人格。

### 3.2 搜索与下载来源

首版支持公开 HTTPS 音频直链，以及现有 B站、抖音解析链路。复用底层有界下载和音轨提取，不调用会自动投递原视频的 `video_download`。普通 HTML 页面不能被保存并冒充音频。

来源调研结论：

| 来源 | 可用材料与首版处理 |
| --- | --- |
| [ccMixter](https://ccmixter.org/view/media/pells) | 提供部分人声和分轨素材；[查询 API](https://ccmixter.org/query-api)可返回文件下载链接，需核对具体轨道与作品来源 |
| [Karaoke Version](https://www.karaoke-version.com/custombackingtrack/) | 提供可定制伴奏，部分内容需购买；记录为人工素材来源，不接入购买流程 |
| B站、抖音 | 复用已支持的作品解析，下载后提取音轨；不假定作品一定是纯人声 |
| 公开音频直链 | 下载后检查真实音频内容、大小和可解码性 |

保留候选的标题、公开来源及可取得的许可信息；不承诺任意歌曲都有可下载的独立人声，也不把搜索命中视为下载成功。

### 3.3 附件与 ASR 兼容

允许当前会话的 `audio` 附件，以及经实际音轨探测确认的 `file` 附件，覆盖微信以普通文件上传歌曲的情况。宿主解析附件引用，校验 scope 与 session 后才向 worker 提供文件路径。

显式歌曲转换请求携带的音频，以及已登记的“等待上传转换音频”状态，允许绕过前置 ASR。当前用户正文明确提出歌曲转换时触发该处理，引用或网页内容不触发。普通语音仍按原有流程自动转写。

等待上传状态随取消、会话切换或请求结束清除。历史附件显式选择仍须属于当前会话，不能仅因 scope 相同就放行；最近附件的现有时间窗口不作为显式选择的全部能力。

### 3.4 分离、权限与取消

声源类型为 `vocals`、`mixed` 或 `unknown`：

- 用户明确提供纯人声时进入 RVC。
- 类型未知时询问是否包含伴奏，不凭文件扩展名判断。
- 已知混音歌曲在分离模型未配置时，于下载和推理前明确阻断，提示提供纯人声。

工具权限同时要求：启用 `singing-conversion`、允许 `bot_sing`、`media.singing.enabled=true`。模型参数不接受身份、工作路径、服务地址或角色权重路径。

排队、执行及登记结果前，重新核对当前权限与冻结权限的交集，以及会话身份。关闭歌声能力、撤销工具或 skill 权限、取消请求和切换会话时，取消相关任务并禁止后续产物投递。

同一规范化服务地址共享串行执行边界，完整覆盖模型加载和推理。歌声使用独立配置解析与 worker endpoint，不标为现有 TTS role。

从兼容工具 `bot_media` 的可调用集合中排除并拒绝 `singing_convert`，避免绕过专用候选、输入和尝试状态处理。

### 3.5 输出、去重与投递

RVC 内部固定输出 WAV，机器人按人格配置或本次明确格式选择编码为 WAV/MP3。默认 MP3 192 kbps，更适合歌曲长度的音频附件。

完整解码最终文件，检查有效采样、非静音、容器完整性以及与源音频相符的时长，拒绝空文件、错误页面和截断音频。沿用当前音频限制：源音频不超过 50 MiB，最终附件不超过 20 MiB；不套用视频的 200 MiB 限额。超限明确失败，不静默截短或更换输出格式。

下载的视频来源沿用已有视频下载上限；提取后的歌曲源音频再按音频输入限制检查。中间文件受现有存储预算约束。

首次下载或推理前登记独立转换 attempt，并绑定当前请求与选定来源；同轮重新 `prepare` 不能重置转换尝试。成功后复用结果，失败、取消或状态未知后不自动重新生成，也不自动更换候选。用户下一次明确重新请求时才建立新 attempt。

成功后仅登记一个当前 scope/session 的 audio Asset，使用现有持久投递队列。投递失败只处理已有 Asset，不重新运行 RVC；继续保留现有 `unknown` 投递语义。

工具结果和用户回复只返回安全状态、文件名及格式，不返回内部 Asset ID、工作路径或服务路径。本轮已有歌曲转换尝试时，不再自动 TTS 朗读结果说明；普通聊天的自动语音规则保持原样。

## 4. 实施顺序与验收

### 4.1 实施阶段

1. **服务适配**：形成独立环境说明、RVC runner、HTTP 协议、FIFO 队列、取消及错误映射，先用可控子进程验证生命周期。
2. **机器人接入**：新增独立配置、权限、skill/tool、候选状态、附件入口、媒体 worker、attempt 与投递接入。
3. **管理与文档**：增加独立歌声配置卡片，更新 skill、README、架构文档和发布文件检查。
4. **验证**：先运行 mock 协议与专项测试，再完成全量回归；具备目标模型时增加真实本机转换。

管理页分别展示配置完整性、协议验证、真实歌声模型验收及分离未配置状态。验收记录绑定人格和配置修订版本，编辑配置后不复用旧版本验收。

服务地址和权重路径仅属于运营配置，不进入聊天可见配置摘要，也不将本机配置、模型或运行数据加入发布包。新增 worker 实现遵循项目现有目录分工，技能入口保持薄封装。

### 4.2 专项测试

| 范围 | 必须验证的场景 |
| --- | --- |
| 输入 | 当前会话音频、微信文件音频、旧会话和跨 scope 拒绝、明确转换请求绕过 ASR、普通语音 ASR 兼容 |
| 候选 | 歌曲名搜索、跨轮选择、旧候选集拒绝、搜索不可用、下载失败、混音未配置分离时阻断 |
| 协议与模型 | multipart 参数、冻结人格映射、角色版本/F0/speaker/index 校验、RVC 原生返回空音频 |
| 输出 | WAV/MP3 完整解码、有效帧、非静音、时长、超限、错误响应与内部信息隐藏 |
| 生命周期 | 多人格同服务串行、排队取消、推理进程树取消、权限撤销、会话切换、服务状态无法确认 |
| 去重与投递 | 失败后不重复推理、重复 jobId、成功结果复用、unknown/failed 投递不重新生成 |
| 兼容 | 现有 TypeScript、Python、TTS、自动语音、GPT-SoVITS、管理页与发布检查保持通过 |

mock RVC 服务负责确定性协议测试，包括错误状态、超限响应、断连和取消。使用可控子进程单独验证运行中取消确实结束进程树，并且下一人格只在前一任务终止后运行。

完整执行：

```text
npm run typecheck
npm test
npm run test:python
npm run build
npm run check:release
```

上述检查用于后续实施验收，本次计划文档交付不执行构建、推理或平台投递。

有可用目标 RVC 权重时，增加一次本机纯人声转换，检查输出并试听目标音色、音高和完整性。若只有 mock 与 worker 测试通过，则结论限于“接口和 worker 已验证，真实歌声模型未验收”，不能宣称角色歌声已可用。

## 5. Limitations / Known Issues

- 当前缺少 RVC 版目标角色模型。模型获取或训练需另行完成，现有可莉 TTS 权重不能直接替代。
- 人声/伴奏分离模型仍待定。首版对已知完整混音歌曲明确阻断，默认交付转换后的人声，不混回伴奏。
- CPU 路径尚未实测歌曲转换耗时和音色质量。每任务重新加载模型会增加耗时，换取明确的取消和人格隔离。
- 搜索站点、公开链接和下载可用性可能变化；候选列表不构成下载或转换成功保证。
- 本文中的新增接口、配置、worker、管理页和测试均尚未实施，本轮没有真实歌声验收结果。
- 后续实施期的临时项目副本、环境、缓存和测试材料集中放在项目 `.codex/` 下。完成后只清理本次创建的非交付内容；长期保留的运行依赖应明确登记用途，清理受阻时报告具体路径和原因。
