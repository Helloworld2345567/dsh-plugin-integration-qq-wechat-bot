# 平台链接解析

抖音路径不调用第三方代解析服务。短链由本地 HTTPS 客户端跟随最多 6 跳重定向，最终页面必须仍属于抖音域名；视频交给本地隔离 `yt-dlp` extractor，图文读取抖音分享页中的 JSON-LD、`__UNIVERSAL_DATA_FOR_REHYDRATION__`、`RENDER_DATA`、`_ROUTER_DATA` 或 `_SSR_DATA`，提取图片列表中的最高质量 HTTPS 地址。页面没有可用数据时，使用抖音自己的移动端详情通道作为本地直连降级路径。

下载地址只在当前作业内存中使用，不持久化为永久资源。下载仍执行 HTTPS、公开地址和每跳重定向校验，文件解码通过后才登记附件。默认不读取 Cookie；`DOUYIN_COOKIE_FILE` 可指向本地 Netscape Cookie 文件，解析器只向匹配的抖音网页域名发送 Cookie，不发送到图片 CDN 或其他主机。

当前 B 站图集路径仍使用原有解析实现。抖音图文链接应使用 `kind=image`；将图文链接传给视频下载会返回 `LINK_IS_IMAGE_GALLERY_USE_IMAGE`。

实现参考：

- [yt-dlp](https://github.com/yt-dlp/yt-dlp)：本地 Douyin 视频 extractor，按项目依赖运行，不调用代解析服务。
- [ucmao/media-parser](https://github.com/ucmao/media-parser)：MIT 许可的本地页面/数据解析思路，仅作为研究参考，不作为运行时依赖。
