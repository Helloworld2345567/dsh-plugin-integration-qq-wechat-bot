# 免登录链接解析

生产入口使用拾光网页当前公开调用的 JSON 接口：`POST https://shiguang.aihub.ren/api/parse`，请求为 `{"url":"公开分享链接"}`，成功响应为 `succ=true`、`data`。读取 `video_id`、`platform`、`video_url`、`image_list`，核对明确指定的作品 ID。图片列表为空时不把 `cover_url` 当作图集。

接口无需登录或密钥。下载地址是临时地址，每次使用重新解析，不持久化为永久资源。下载仍执行 HTTPS、公开地址和每跳重定向校验，文件解码/媒体探测通过后才登记附件。

参考来源：

- [拾光多平台解析](https://shiguang.aihub.ren/)：公开网页支持抖音、B站视频和图集；当前页面客户端使用上述 POST 接口。
- [mubaiqq/dyjx](https://github.com/mubaiqq/dyjx)：提供抖音视频、图集和实况解析示例。
- [kangleizhui/short-videos](https://github.com/kangleizhui/short-videos)：多平台解析实现及接口示例。

后两项仅作为方案研究来源，没有复制或执行其代码。接口字段变化时按实际响应更新固定解析脚本，不在运行时下载并执行外部脚本。
