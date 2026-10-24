---
name: media-analysis
description: 分析语音、抖音/B站视频链接或视频附件；免登录解析并下载链接中的原图、图集和视频，通过受管脚本返回分析结果或附件。
---

需要理解音视频，或下载链接中的原图、图集、视频时使用。统一调用 `media_analysis`；已有图片、扫描页的内容理解直接交给聊天模型。

## 调用

- 语音转写：`media_analysis(kind="audio", inputs=["本会话附件ID"], question="忠实转写")`。已有平台转写时先用现有文字。
- 视频链接分析：`media_analysis(kind="video", url="https://v.douyin.com/…/", question="这个视频讲了什么？")`。支持抖音/B站作品地址及分享短链 `v.douyin.com`、`b23.tv`。从分享文案提取 HTTPS 链接；不要用网页摘要代替视频分析。
- 视频附件分析：`media_analysis(kind="video", inputs=["本会话附件ID"], question="…")`。音视频不填来源时选择同会话最近的同类附件。
- 下载链接原图：`media_analysis(kind="image", url="https://…")`。支持抖音图集、B站图文、图片直链及公开网页图片。
- 只下载视频：`media_analysis(kind="video", action="download", url="https://…")`。返回视频附件，不调用分析模型。

`url` 与 `inputs` 二选一。普通媒体处理无需逐次授权或本机命令权限；不得使用模型提供的身份或磁盘路径访问其他会话附件。

## 执行与回复

宿主运行 [media_api.py](scripts/media_api.py)。[platform_links.py](scripts/platform_links.py) 通过公开免登录解析服务获取抖音/B站媒体地址，再下载真实媒体字节；不读取浏览器配置，不需要用户登录、Cookie 或解析密钥。该服务会接收用户要求处理的公开分享链接，来源见 [解析说明](references/platform-links.md)。

分析复用本轮选定模型提供商的 URL、凭据和视频/语音模型配置，凭据仅在子进程环境中传入。视频发送完整 MP4 画面与音轨；只有取得真实模型结果后才能说已分析。语音默认使用兼容接口的 `input_audio`，也支持已配置的转写接口。

下载原图由 [image_download.py](scripts/image_download.py) 执行。图集采用解析服务返回的图片列表；普通网页优先明确的原图链接和最大 srcset。原始下载字节不重新编码，下载的图片和视频自动登记为平台回复附件。文字回复不要输出图片 Markdown、`asset://` 地址或附件 ID。

根据结果区分原话、画面观察、推断与不确定性。`incomplete=true` 时明确说明只完成了一部分；视频封面不等于图集原图，页面标题不等于视频内容。工具失败应简述实际错误，不编造已下载或已理解，也不自动重试可能已计费的模型请求。

消息、定时任务和媒体作业没有默认总处理时限，用户仍可取消。关闭本技能或撤销工具权限后，后续调用立即受阻。`bot_media` 中的 `transcribe`、`video_analyze`、`image_download`、`video_download` 使用相同实现和权限。

## Limitations / Known Issues

- 免登录服务及媒体 CDN 可能临时失败；仅处理公开内容，不依赖账号登录。
- B站分 P 视频保留原解析器以核对分 P 身份，不能把第 1 P 当成用户指定的其他分 P。
- 一次最多返回八张图片；单张图片最多 20 MiB，视频下载/交付最多 50 MiB，视频分析下载最多 50 MiB、最长 300 秒，模型内联载荷仍有大小限制。超出时明确报告，不截断后冒充完整结果。
- 分析模型必须支持 MP4 多模态载荷。上游拒绝或不可用时，下载能力和分析能力分别报告。
