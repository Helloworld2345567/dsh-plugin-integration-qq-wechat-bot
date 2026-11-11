# Platform-link parsing

Douyin processing does not call third-party parsing services. The local HTTPS client follows at most six redirects for a short link; the final page must remain on a Douyin domain. Videos go through the locally isolated `yt-dlp` extractor. Image posts read JSON-LD, `__UNIVERSAL_DATA_FOR_REHYDRATION__`, `RENDER_DATA`, `_ROUTER_DATA` or `_SSR_DATA` embedded in Douyin share pages and extract the highest-quality HTTPS addresses from their image lists. Prefer PNG when the same `url_list` declares PNG, and rank candidates using original-image and dimension hints. When no usable page data is available, a direct connection to Douyin's own mobile detail endpoint is the fallback.

Download addresses exist only in the current job's memory, not as permanent resources. Downloads retain HTTPS, public-address and per-redirect checks; files become attachments only after decoding succeeds. Cookies are not read by default. `DOUYIN_COOKIE_FILE` can identify a local Netscape cookie file; the parser sends cookies only to matching Douyin page domains, never image CDNs or other hosts.

Bilibili galleries retain the existing parser. Douyin image-post links require `kind=image`; passing one to video download returns `LINK_IS_IMAGE_GALLERY_USE_IMAGE`.

Implementation references:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp): the local Douyin video extractor, run through project dependencies without a remote parsing service.
- [ucmao/media-parser](https://github.com/ucmao/media-parser): MIT-licensed local page/data parsing ideas, used only as a research reference, not a runtime dependency.
