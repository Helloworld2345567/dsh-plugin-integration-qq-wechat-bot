---
name: voice-generation
description: 根据用户明确要求生成 AI 朗读语音回复，使用人格配置的 Edge TTS 或 GPT-SoVITS。
---

# Voice generation

使用 `bot_voice` 生成并登记可播放的音频附件。只有用户明确要求语音、朗读或口播时才调用。人格开启自动语音后，运行时会为最终正文附加语音，无需模型主动调用；本轮已尝试语音工具时不会再次自动合成。工具成功后音频会自动加入本轮投递，不要输出内部 asset ID、工作目录路径或 `asset://` 地址。

`registeredForDelivery=true`、`deliveryState=registered` 和 `platformSent=false` 表示音频已生成并登记，尚未取得平台发送回执。可以说“音频已生成，已登记发送”，不能说“已送达”或保证用户能收到。只有 `platformSent=true` 才表示平台确认接受，历史记录的 `sent` 标记本身不足以确认回执。用户明确要求重发时，用 `bot_send_file(assetId=原附件ID, resend=true)` 复用已有音频，不重新合成；返回 `pending` 仅表示已排队，失败或 `unknown` 均不能说已发送。

`mode="speak"` 用于普通朗读，省略时也是普通朗读。歌曲下载使用 `bot_music`；用户明确要求当前人格翻唱歌曲时使用 `bot_sing`。语音由 AI 生成，应在自然回复中明确说明这一点。

```json
{
  "mode": "speak",
  "text": "要朗读的内容",
  "speed": 1.0
}
```

省略 `voice`、`format` 时使用本轮人格配置，再使用协议默认值；显式工具参数优先。连接信息来自人格配置，技能调用不接受 API key、URL、模型权重或参考音频路径。

- `edge_tts` 使用 Edge TTS，不需要 API key；音色来自人格配置，可在管理页选择或填写本机保存的 Edge 音色名称，输出 MP3。
- `gpt_sovits` 使用人格配置的模型与参考音频，只支持普通朗读和 WAV。`voice` 只能是当前人格配置的音色标识，省略时自动继承；不要填 `alloy` 等其他提供商音色。显式 MP3 会返回不支持；`style` 会明确降级为普通朗读，不承诺改变风格。

音频输出预算与 QQ 音频硬上限均为 200 MiB。QQ 上传超过 5,000,000 字节时由宿主自动分片，不降低音质或截断内容；超过语音软限制可能按文件展示。微信附件仍限制为 20 MiB。只依据工具真实结果描述完成情况，不伪装成歌曲。
