---
name: media-analysis
description: 分析和下载音视频及图片；快速并发转换、压缩、缩小图片，将完整视频分段并发转为10MB以下GIF，通过受管脚本交付附件。
---

需要理解音视频，或下载链接中的原图、图集、视频时使用。统一调用 `media_analysis`；已有图片、扫描页的内容理解直接交给聊天模型。

已有附件的转换、压缩和缩放调用独立的 `media_transform`，无需模型服务或密钥。每次处理一个附件，可同时发起多个调用；工具根据机器 CPU 分配执行槽位并排队，勿为提高并发绕过工具自行启动脚本。

## 本地转换

- 转换格式：`media_transform(operation="image_convert", inputs=["附件ID"], format="webp")`。支持 `jpeg`、`png`、`webp`、`avif`。
- 压缩图片：`media_transform(operation="image_compress", inputs=["附件ID"], format="jpeg", quality=70, maxBytes=1000000)`。
- 缩小尺寸：`media_transform(operation="image_resize", inputs=["附件ID"], maxWidth=1280, maxHeight=1280, format="webp")`。
- 完整视频转 GIF：`media_transform(operation="convert_gif", inputs=["视频附件ID"])`。
- 明确指定的片段：`media_transform(operation="convert_gif", inputs=["视频附件ID"], startSeconds=10, durationSeconds=20, fps=15, maxWidth=640)`。

图片操作可组合格式、质量和尺寸参数，一次解码完成；默认质量 80，保持比例且不放大。`image_resize` 必须提供至少一个尺寸；未选输出格式时保留受支持的源格式，其余静态格式转 JPEG。PNG 使用快速无损编码；JPEG 使用白底，其他格式保留透明度。`maxBytes` 是图片成品上限，最多尝试四次；降质量后仍超限会缩小尺寸，未达到则失败。

GIF 默认保留整段视频，12 fps、最长边 480 像素。只有用户明确指定片段时才传起点或时长。长视频在至少两个可用槽位且时长达到 30 秒时，约每 15 秒分段并发编码，随后复制 GIF 帧块合并，无完整二次编码。最终文件严格小于 **10,000,000 字节**；超限最多四轮降低尺寸、颜色数和高于 12 的帧率，始终保留所选时长，最低 12 fps。GIF 不接受 `maxBytes`。音轨不属于 GIF 内容。

结果报告实际格式、尺寸、体积、尝试次数和耗时；GIF 另报时段范围、帧率、颜色数、分段数、实际并发和合并耗时。成功会自动登记附件；无需再次登记同一文件。兼容入口 `bot_media(operation="convert_gif", ...)` 使用相同限制和完整时长默认值。

## 调用

- 语音转写：`media_analysis(kind="audio", inputs=["本会话附件ID"], question="忠实转写")`。已有平台转写时先用现有文字。
- 视频链接分析：`media_analysis(kind="video", url="https://v.douyin.com/…/", question="这个视频讲了什么？")`。支持抖音/B站作品地址及分享短链 `v.douyin.com`、`b23.tv`。从分享文案提取 HTTPS 链接；不要用网页摘要代替视频分析。
- 视频附件分析：`media_analysis(kind="video", inputs=["本会话附件ID"], question="…")`。音视频不填来源时选择同会话最近的同类附件。
- 下载链接原图：`media_analysis(kind="image", url="https://…")`。支持抖音图集、B站图文、图片直链及公开网页图片。
- 只下载视频：`media_analysis(kind="video", action="download", url="https://…")`。返回视频附件，不调用分析模型。

`url` 与 `inputs` 二选一。普通媒体处理无需逐次授权或本机命令权限；不得使用模型提供的身份或磁盘路径访问其他会话附件。

## 执行与回复

宿主运行 [media_api.py](scripts/media_api.py)。[platform_links.py](scripts/platform_links.py) 通过公开免登录解析服务获取抖音/B站媒体地址，再下载真实媒体字节；不读取浏览器配置，不需要用户登录、Cookie 或解析密钥。该服务会接收用户要求处理的公开分享链接，来源见 [解析说明](references/platform-links.md)。

工具参数、操作路由、模型角色和附件交付由技能内的 [operations.json](operations.json) 声明。`tools` 分别声明分析、转换工具；新增操作在该声明和脚本中实现，宿主据此注册和执行。

分析复用本轮选定模型提供商的 URL、凭据和视频/语音模型配置，凭据仅在子进程环境中传入。视频发送完整 MP4 画面与音轨；只有取得真实模型结果后才能说已分析。语音默认使用兼容接口的 `input_audio`，也支持已配置的转写接口。

下载原图由 [image_download.py](scripts/image_download.py) 执行。图集采用解析服务返回的图片列表；普通网页优先明确的原图链接和最大 srcset。原始下载字节不重新编码，下载的图片和视频自动登记为平台回复附件。文字回复不要输出图片 Markdown、`asset://` 地址或附件 ID。

根据结果区分原话、画面观察、推断与不确定性。`incomplete=true` 时明确说明只完成了一部分；视频封面不等于图集原图，页面标题不等于视频内容。工具失败应简述实际错误，不编造已下载或已理解，也不自动重试可能已计费的模型请求。

消息、定时任务和媒体作业没有默认总处理时限，用户仍可取消。关闭本技能或撤销工具权限后，后续调用立即受阻。`bot_media` 中的 `transcribe`、`video_analyze`、`image_download`、`video_download` 使用相同实现和权限。

可信私聊用户不受每日媒体调用次数或每日视频分析累计时长限制，宿主依据本轮冻结的身份和执行时的信任状态判定；工具参数不能声明可信身份。单次大小、分析时长、并发和存储限制仍适用。

## Limitations / Known Issues

- 免登录服务及媒体 CDN 可能临时失败；仅处理公开内容，不依赖账号登录。
- B站分 P 视频保留原解析器以核对分 P 身份，不能把第 1 P 当成用户指定的其他分 P。
- 一次最多返回 100 张图片；单张图片最多 20 MiB，整批图片下载最多 50 MiB。视频下载和分析源文件最多 500 MiB，发送到 QQ／微信的单个视频最多 200 MiB；视频分析每次一个、最长 300 秒，分析前按需转码，模型内联视频最多 8 MiB、请求载荷最多 12 MiB。超出时明确报告，不截断后冒充完整结果。
- 累计附件存储仍受当前聊天作用域 512 MiB、全局 2 GiB 配额约束；已有附件占用可能使新视频登记失败。
- 分析模型必须支持 MP4 多模态载荷。上游拒绝或不可用时，下载能力和分析能力分别报告。
- 图片转换暂不接受动画图片；AVIF/WebP 需要 Pillow 对应编解码支持，缺失时明确报错。AVIF 有损透明通道可能出现微小精度差异。
- GIF 的完整时长、最低 12 fps 和 10 MB 上限可能无法同时满足，尤其是极长视频；降至最长边 64、16 色后仍超限会失败。视频转 GIF 不沿用分析的 300 秒限制，时间按 GIF 百分之一秒精度量化。速度随 CPU、素材和并发负载变化。
