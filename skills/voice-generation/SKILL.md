---
name: voice-generation
description: 根据用户明确要求生成 AI 语音回复，支持普通朗读和轻量旋律化表达；不承诺完整歌曲、伴奏、翻唱或稳定音准。
---

# Voice generation

使用 `bot_voice` 生成并登记可播放的音频附件。只有用户明确要求语音、朗读、口播或轻量哼唱时才调用；普通文字对话不要主动生成语音。工具成功后音频会自动加入本轮投递，不要输出内部 asset ID、工作目录路径或 `asset://` 地址。

`mode="speak"` 用于普通朗读，`mode="chant"` 用于轻快、旋律化或哼唱感的短句。`chant` 是表达性 TTS，不能宣称生成完整歌曲、伴奏、翻唱或稳定音准。语音由 AI 生成，应在自然回复中明确说明这一点。

```json
{
  "mode": "speak",
  "text": "要朗读的内容",
  "voice": "alloy",
  "style": "温柔、清晰",
  "speed": 1.0,
  "format": "mp3"
}
```

默认使用已配置的 OpenAI-compatible speech provider、模型和 voice。凭据由 Harness 注入，技能调用不接受 API key、URL 或本地路径。音频输出限制为 20 MiB；provider 不支持风格 instructions 时会返回明确的降级结果，不伪装成歌曲。
