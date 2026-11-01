---
name: singing-conversion
description: 按歌名从音乐曲库获取真实音源，或使用当前会话音频与明确公开来源，通过分离和 RVC 转换为当前人格的 AI 音色。
---

# 歌曲与语音音色转换

只有用户明确要求翻唱、变声、STS 或转换已有音频的音色时，使用 `bot_sing`。普通文本朗读仍使用 `bot_voice`。RVC 权重及服务由运营者配置，工具不能指定或覆盖；不向用户返回服务地址、路径、内部资产编号或 traceback。

1. 当前会话附件：`prepare` 的 `inputs` 填一个音频或普通文件的附件 ID。宿主校验会话归属，worker 探测真实音轨。不要把任意本机路径当作附件。
2. 歌曲名称：直接调用 `sing` 并填写 `song`，已知歌手时填 `artist`。宿主从已启用曲库自动选最高匹配项并复用下载源；曲库混音必须先配置分离。成功只发送当前人格转换后的 MP3，完整时长且严格小于 20,000,000 字节，不发送原曲。不要先调用 `bot_music.download` 再重新按歌名转换，也不要用通用网页搜索代替曲库。用户只想下载或听原曲时使用 `bot_music`。
   用户明确给出单一 HTTPS 地址时，用 `prepare` 传 `url` 与可读的 `title`；保留支持的音频直链、B站/抖音作品地址。用户明确需要比较公开来源时，可用当前获准的 `web_search`、`web_fetch` 查证后登记最多五个 `candidates`，尽可能保留公开来源和许可信息。`convert` 只能使用固定候选，不能覆盖下载地址或传本机路径。搜索命中不代表一定能下载。未获准联网时，请用户上传音频。
3. 无来源时可调用空 `prepare`，登记等待下一条上传音频。`prepare` 不下载、不启动推理。`list` 查看当前候选集与编号，旧候选集不能用于新列表。
4. 用户选择后，用返回的 `candidateSet` 和 `candidate` 调用 `convert`。用户已明确指定单一来源时无需重复询问选择。`sourceType` 为 `vocals`、`mixed` 或 `unknown`；只有用户明确提供纯人声才用 `vocals`。未知时先询问是否包含伴奏，不能凭扩展名猜测。已知混音仅在当前人格配置了 RVC 分离模型时允许 `mixed`；服务会先提取人声，再执行音色转换并混回原伴奏。分离未配置时在下载和推理前以 `SINGING_SEPARATION_UNCONFIGURED` 阻断，请用户提供纯人声。
5. 附件或公开链接的 `convert` 可选 `mp3` 或 `wav`，省略遵循人格设置。MP3 根据完整时长选择 192/160/128/96/64 kbps，使文件严格小于 20,000,000 字节；明确要求 WAV 仍保留 WAV。按歌名的 `sing` 固定发送 MP3。无法在支持码率下容纳完整歌曲时明确失败，不截断歌曲。

成功会自动登记一个音频附件进入现有投递队列，告知用户这是 AI 音色转换。不要再次 `bot_send_file`、重新转换或读取结果路径。转换失败、取消或服务状态未知时，说明稳定错误及所需的用户操作，本轮不得重新 prepare 后重试，也不得自动更换候选。只有用户下一次明确重新请求才可新建尝试。转换说明不会被自动 TTS 再次朗读。

`registeredForDelivery=true` 或 `deliveryState=registered` 只表示转换结果已登记，平台将在本轮结束后尝试投递。`platformSent=false` 时不能说已经发送或保证送达；已有结果的投递失败与转换失败分别说明，明确重发请求复用已有附件。

示例：

按歌名直接翻唱：

```json
{"action":"sing","song":"泡沫","artist":"邓紫棋"}
```

使用当前会话附件：

```json
{"action":"prepare","inputs":["当前会话附件ID"]}
```

取得候选集后：

```json
{"action":"convert","candidateSet":"prepare返回的候选集","candidate":1,"sourceType":"vocals","format":"mp3"}
```

混音歌曲（仅在人格已配置分离模型时）：

```json
{"action":"convert","candidateSet":"prepare返回的候选集","candidate":1,"sourceType":"mixed","format":"mp3"}
```
