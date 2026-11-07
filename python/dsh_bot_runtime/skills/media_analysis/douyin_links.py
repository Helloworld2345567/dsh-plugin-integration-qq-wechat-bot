"""Direct Douyin share-page resolution without a third-party parser service."""
from html import unescape
import json
import os
from pathlib import Path
import re
from urllib.parse import unquote, urljoin, urlsplit

import aiohttp

from dsh_bot_runtime.video_understanding.models import VideoError
from dsh_bot_runtime.video_understanding.network import PublicResolver, validate_url

DOUYIN_HOSTS = frozenset({
    "douyin.com", "www.douyin.com", "www.iesdouyin.com", "iesdouyin.com", "v.douyin.com",
})
DOUYIN_PAGE_HOSTS = DOUYIN_HOSTS - {"v.douyin.com"}
DOUYIN_FEED_HOSTS = ("api5-normal-c-hl.amemv.com", "aweme.snssdk.com")
DOUYIN_FEED_USER_AGENT = (
    "com.ss.android.ugc.aweme/290101 (Linux; U; Android 10; zh_CN; Pixel 4 "
    "Build/QQ3A.200805.001)"
)
MEDIA_USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
)
SSR_USER_AGENT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
MAX_REDIRECTS = 6
MAX_PAGE_BYTES = 8 * 1024 * 1024
_ID_PATH = re.compile(r"/(?:video|share/video|note|share/note|slides|share/slides)/(\d+)/?$")


def _cookie_header(cookie_file, host):
    """Read only matching secure Netscape cookies; never send them to a CDN."""
    if not cookie_file:
        return ""
    host = (host or "").lower()
    if host not in DOUYIN_HOSTS:
        return ""
    path = Path(cookie_file)
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    values = []
    for line in lines:
        if not line or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) < 7:
            continue
        domain, include_subdomains, cookie_path, secure, _expires, name, value = fields[:7]
        domain = domain.lstrip(".").lower()
        if host != domain and not host.endswith("." + domain):
            continue
        if secure.upper() == "TRUE" and cookie_path and not cookie_path.startswith("/"):
            continue
        if name:
            values.append(f"{name}={value}")
    return "; ".join(values)


def _source_from_url(url):
    part = validate_url(url)
    host = part.hostname.lower()
    if host not in DOUYIN_HOSTS:
        raise VideoError("UNSUPPORTED_SOURCE")
    if host == "v.douyin.com":
        if not re.fullmatch(r"/[A-Za-z0-9_-]+/?", part.path):
            raise VideoError("UNSUPPORTED_SOURCE")
        return {"kind": "douyin", "media": "unknown", "ref": f"https://{host}{part.path}"}
    match = _ID_PATH.fullmatch(part.path)
    if not match:
        raise VideoError("UNSUPPORTED_SOURCE")
    media = "image" if "/note/" in part.path or "/slides/" in part.path else "video"
    return {"kind": "douyin", "media": media, "ref": url, "work_id": match.group(1)}


def _final_source(url):
    part = validate_url(url)
    match = _ID_PATH.fullmatch(part.path)
    if not match or part.hostname.lower() not in DOUYIN_PAGE_HOSTS:
        raise VideoError("UNSUPPORTED_SOURCE")
    media = "image" if "/note/" in part.path or "/slides/" in part.path else "video"
    return {"kind": "douyin", "media": media, "ref": url, "work_id": match.group(1)}


def _extract_json_after(text, marker_end):
    start = marker_end
    while start < len(text) and text[start].isspace():
        start += 1
    if start < len(text) and text[start] == "=":
        start += 1
        while start < len(text) and text[start].isspace():
            start += 1
    if start >= len(text) or text[start] not in "[{":
        return None
    opener, closer = text[start], "]" if text[start] == "[" else "}"
    depth, quote, escaped = 0, None, False
    for index in range(start, len(text)):
        char = text[index]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in "\"'":
            quote = char
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
    return None


def _embedded_payloads(html):
    payloads = []
    for marker in ("__UNIVERSAL_DATA_FOR_REHYDRATION__", "RENDER_DATA"):
        pattern = rf"<script[^>]*\bid=[\"']{re.escape(marker)}[\"'][^>]*>(.*?)</script>"
        for match in re.finditer(pattern, html, re.I | re.S):
            raw = unescape(match.group(1).strip())
            if marker == "RENDER_DATA":
                raw = unquote(raw.strip('"\''))
            try:
                payloads.append(json.loads(raw))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
    for match in re.finditer(r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", html, re.I | re.S):
        try:
            payloads.append(json.loads(unescape(match.group(1).strip())))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
    for marker in ("_ROUTER_DATA", "_SSR_DATA"):
        for match in re.finditer(rf"(?:window\.)?{re.escape(marker)}\s*=", html):
            raw = _extract_json_after(html, match.end())
            if not raw:
                continue
            try:
                payloads.append(json.loads(unescape(raw)))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
    return payloads


def _dicts(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _dicts(child)


def _find_item(payloads, work_id):
    identified, fallback = [], []
    for payload in payloads:
        for item in _dicts(payload):
            ids = {str(item.get(key)) for key in ("aweme_id", "awemeId", "item_id", "itemId", "id") if item.get(key) is not None}
            if work_id in ids:
                identified.insert(0, item)
            elif item.get("images") or item.get("image_list") or item.get("image") or item.get("video"):
                if not ids:
                    fallback.append(item)
    return identified[0] if identified else (fallback[0] if fallback else None)


def _url_list(value):
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        for key in ("url_list", "urlList", "urls"):
            if isinstance(value.get(key), list):
                return [item for item in value[key] if isinstance(item, str)]
        for key in ("url", "uri"):
            if isinstance(value.get(key), str):
                return [value[key]]
    return []


def _https_urls(values):
    result = []
    for value in values:
        try:
            validate_url(value)
        except VideoError:
            continue
        if value not in result:
            result.append(value)
    return result


def _parse_payloads(payloads, work_id):
    item = _find_item(payloads, work_id)
    if not item:
        raise VideoError("RESOLVE_FAILED")
    images = []
    image_entries = item.get("images") or item.get("image_list") or item.get("image") or []
    if isinstance(image_entries, str):
        image_entries = [image_entries]
    for entry in image_entries:
        urls = _https_urls(_url_list(entry))
        if urls and urls[-1] not in images:
            images.append(urls[-1])
    video = ""
    video_info = item.get("video") if isinstance(item.get("video"), dict) else {}
    for key in ("play_addr", "download_addr", "playAddr"):
        urls = _https_urls(_url_list(video_info.get(key)))
        if urls:
            video = urls[-1]
            break
    return {"id": str(work_id), "images": images, "video": video}


def parse_page(html, work_id):
    """Extract static images and a direct video URL from embedded page data."""
    return _parse_payloads(_embedded_payloads(html), work_id)


async def _fetch_page(url, cookie_file="", *, read_page=True, user_agent=MEDIA_USER_AGENT):
    source = _source_from_url(url)
    current = source["ref"]
    connector = aiohttp.TCPConnector(resolver=PublicResolver(), use_dns_cache=False)
    try:
        async with aiohttp.ClientSession(connector=connector, trust_env=False,
                                         timeout=aiohttp.ClientTimeout(total=20)) as client:
            for _ in range(MAX_REDIRECTS + 1):
                part = validate_url(current)
                if part.hostname.lower() not in DOUYIN_HOSTS:
                    raise VideoError("SOURCE_ACCESS_RESTRICTED")
                headers = {"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml"}
                cookie = _cookie_header(cookie_file, part.hostname)
                if cookie:
                    headers["Cookie"] = cookie
                async with client.get(current, headers=headers, allow_redirects=False) as response:
                    if response.status in (301, 302, 303, 307, 308):
                        location = response.headers.get("Location")
                        if not location:
                            raise VideoError("RESOLVE_FAILED")
                        current = urljoin(current, location)
                        continue
                    if response.status in (401, 403, 429):
                        raise VideoError("SOURCE_ACCESS_RESTRICTED")
                    if response.status == 404:
                        raise VideoError("SOURCE_UNAVAILABLE")
                    if response.status != 200:
                        raise VideoError("RESOLVE_FAILED")
                    final = _final_source(str(response.url))
                    if not read_page:
                        return final, ""
                    raw = bytearray()
                    async for chunk in response.content.iter_chunked(65536):
                        raw.extend(chunk)
                        if len(raw) > MAX_PAGE_BYTES:
                            raise VideoError("RESOLVE_RESPONSE_TOO_LARGE")
                    return final, raw.decode("utf-8", errors="replace")
            raise VideoError("TOO_MANY_REDIRECTS")
    except VideoError:
        raise
    except (aiohttp.ClientError, UnicodeError):
        raise VideoError("RESOLVE_CONNECTION_FAILED") from None


async def _fetch_feed(work_id):
    connector = aiohttp.TCPConnector(resolver=PublicResolver(), use_dns_cache=False)
    async with aiohttp.ClientSession(connector=connector, trust_env=False,
                                     timeout=aiohttp.ClientTimeout(total=20)) as client:
        for host in DOUYIN_FEED_HOSTS:
            url = f"https://{host}/aweme/v1/feed/?aweme_id={work_id}&aid=1128"
            try:
                async with client.get(url, headers={
                    "User-Agent": DOUYIN_FEED_USER_AGENT,
                    "Accept": "application/json",
                }, allow_redirects=False) as response:
                    if response.status in (401, 403, 429):
                        continue
                    if response.status == 404:
                        continue
                    if response.status != 200:
                        continue
                    raw = bytearray()
                    async for chunk in response.content.iter_chunked(65536):
                        raw.extend(chunk)
                        if len(raw) > MAX_PAGE_BYTES:
                            raise VideoError("RESOLVE_RESPONSE_TOO_LARGE")
                    try:
                        payload = json.loads(raw)
                    except (TypeError, ValueError, json.JSONDecodeError):
                        continue
                    try:
                        return _parse_payloads([payload], str(work_id))
                    except VideoError:
                        continue
            except VideoError:
                raise
            except aiohttp.ClientError:
                continue
    raise VideoError("SOURCE_ACCESS_RESTRICTED")


async def resolve_reference(url, cookie_file=""):
    source = _source_from_url(url)
    if source["media"] != "unknown":
        return source
    final, _html = await _fetch_page(source["ref"], cookie_file, read_page=False)
    return final


async def resolve_images(url, cookie_file=""):
    final, html = await _fetch_page(url, cookie_file, user_agent=SSR_USER_AGENT)
    if final["media"] != "image":
        raise VideoError("LINK_HAS_NO_IMAGE_GALLERY")
    try:
        result = parse_page(html, final["work_id"])
    except VideoError:
        result = await _fetch_feed(final["work_id"])
    if not result["images"]:
        result = await _fetch_feed(final["work_id"])
    if result["id"] != final["work_id"]:
        raise VideoError("SOURCE_IDENTITY_MISMATCH")
    return result["images"]


def configured_cookie_file():
    return os.environ.get("DOUYIN_COOKIE_FILE", "")
