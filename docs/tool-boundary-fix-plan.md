# 工具职责修正清单

简体中文 | [English](en/tool-boundary-fix-plan.md)

待实施方案。媒体分享链接必须先下载实际媒体，再使用附件 ID 分析或处理。

| Tool | 修正方式 |
|---|---|
| `media_download`（新增） | 接收 `url` 和 `deliver`（默认 `false`）。识别受支持链接中的图片、图集或视频，下载为本会话附件，返回 `assetId/kind/mime/name`。不分析内容；下载结果可供后续复用。 |
| `media_analysis` | 统一读取图片、文档、音频和视频。只接收必填 `inputs` 与可选 `question`，由宿主按附件类型分派。删除 `url/kind/action/deliver/keepInputs` 及下载路由。 |
| `media_transform` | 只处理已有附件；加入 `convert_mp4`，保留图片转换、压缩、缩放及视频转 GIF。不接受 URL。 |
| `bot_media` | 删除公开工具入口。图片读取、文档提取并入 `media_analysis`；MP4 转换并入 `media_transform`；其余重复入口删除。保留内部操作实现及现有 `bot_media` 权限配置键。 |
| `image_generation` | 删除固定的 GPT Image 2.6 格式承诺。根据当前 OpenAI/ComfyUI 服务提供准确能力说明，ComfyUI 以所选工作流为依据。 |
| `skill` | 读取生图技能时，由宿主附带当前服务对应的说明，避免模型自行猜测服务或读取本机资源路径。 |
| `bot_tools` | 更新目录摘要，明确下载、分析、转换的区别；删除不存在的独立 `image_download` 指引及已移除的 `bot_media` 工具项。 |
| `web_fetch`、`bot_read_social` | 在渠道提示词中明确只按实际获取的网页／帖文正文回答；媒体分享必须走下载流程，不用网页文字替代视频或图集理解。 |
| `bot_session` | 删除 `stop` 动作，即时停止统一由宿主命令处理。说明 `new` 开启新上下文、保留历史；同步澄清 `/reset`，不暗示删除历史。 |
| `bot_skills` | 目录、工具说明和结果明确：启停技能修改共享人格，影响使用该人格的会话。 |
| `bot_model`、`bot_voice_control` | 说明和结果明确：修改当前会话覆盖，保存后下一轮使用，不统一描述成排队执行。 |

共同约束：下载不依赖 ASR／视频分析开关；读图、读文档保留基础媒体权限；音视频分析按操作检查技能、模型及执行时权限。中间下载不自动发送，明确要求原件时才登记交付。

同步更新工具注册、操作声明、权限检查、提示词及技能说明，并重新生成发布操作清单。
