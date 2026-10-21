"""Read public Tieba/Xiaohongshu posts without login cookies or API keys."""
from __future__ import annotations

import asyncio
from html.parser import HTMLParser
import json
import re
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit, urlunsplit

import aiohttp


HOSTS = {"tieba.baidu.com", "www.xiaohongshu.com", "xiaohongshu.com", "xhslink.com", "www.xhslink.com"}
MAX_HTML = 3 * 1024 * 1024


def normalize_post_url(url: str) -> str:
    parsed = urlsplit(url.strip())
    if (parsed.scheme not in {"http", "https"} or parsed.hostname not in HOSTS
            or parsed.username or parsed.password or parsed.port not in {None, 80, 443}):
        raise ValueError("UNSUPPORTED_POST_URL")
    path, query = parsed.path, parsed.query
    if parsed.hostname == "tieba.baidu.com":
        # The mobile share form identifies the thread using kz/tid.
        if not re.fullmatch(r"/p/\d+/?", path):
            values = parse_qs(query)
            thread = (values.get("kz") or values.get("tid") or [""])[0]
            if not thread.isdigit():
                raise ValueError("TIEBA_THREAD_URL_REQUIRED")
            path = f"/p/{thread}"
            query = urlencode({"pn": values["pn"][0]}) if "pn" in values else ""
    elif parsed.hostname not in {"xhslink.com", "www.xhslink.com"}:
        if not re.fullmatch(r"/(?:explore|discovery/item)/[a-fA-F0-9]{24}/?", path):
            raise ValueError("XIAOHONGSHU_NOTE_URL_REQUIRED")
    return urlunsplit(("https", parsed.hostname, path, query, ""))


class _TiebaParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.posts, self.title, self.parts = [], "", []
        self.depth = 0
        self.kind = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()
        if self.depth:
            if tag not in {"br", "img", "hr", "input", "meta", "link", "wbr", "source"}:
                self.depth += 1
            elif tag == "br":
                self.parts.append("\n")
            return
        if "d_post_content" in classes or "core_title_txt" in classes:
            self.kind = "post" if "d_post_content" in classes else "title"
            self.depth, self.parts = 1, []

    def handle_startendtag(self, tag, attrs):
        if tag == "br" and self.depth:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if self.depth:
            self.depth -= 1
            if not self.depth:
                value = " ".join("".join(self.parts).split())
                if self.kind == "post" and value:
                    self.posts.append(value[:8000])
                elif self.kind == "title":
                    self.title = value

    def handle_data(self, data):
        if self.depth:
            self.parts.append(data)


def parse_post(html: str, url: str) -> dict:
    if urlsplit(url).hostname == "tieba.baidu.com":
        parser = _TiebaParser()
        parser.feed(html)
        if not parser.posts:
            raise ValueError("POST_BODY_UNAVAILABLE_LOGIN_OR_BLOCKED")
        return {"site": "tieba", "url": url, "title": parser.title,
                "posts_on_page": parser.posts[:30], "scope": "当前页可见楼层；不含未加载分页和楼中楼"}
    note_id = urlsplit(url).path.rstrip("/").split("/")[-1]
    match = re.search(r"(?:window\.)?__INITIAL_STATE__\s*=\s*", html)
    if not match:
        raise ValueError("POST_BODY_UNAVAILABLE_LOGIN_OR_BLOCKED")
    # XHS embeds JS undefined values. Preserve quoted strings verbatim and
    # decode JSON only; never execute page JavaScript.
    source = re.sub(r'"(?:\\.|[^"\\])*"|\bundefined\b',
                    lambda m: "null" if m[0] == "undefined" else m[0], html[match.end():])
    state, _ = json.JSONDecoder().raw_decode(source)
    notes = state.get("note", {}).get("noteDetailMap", {})
    detail = notes.get(note_id, {})
    note = detail.get("note", {})
    if not note or str(note.get("noteId", note_id)) != note_id:
        raise ValueError("TARGET_NOTE_NOT_FOUND")
    title, body = str(note.get("title", "")), str(note.get("desc", ""))
    if not title.strip() and not body.strip():
        raise ValueError("POST_BODY_UNAVAILABLE_LOGIN_OR_BLOCKED")
    return {"site": "xiaohongshu", "url": url, "title": title[:1000], "body": body[:20000],
            "author": str(note.get("user", {}).get("nickname", "")),
            "type": note.get("type", "unknown"),
            "scope": "笔记标题和正文；未读取图片像素、视频口播或完整评论"}


async def _read_post(url: str) -> dict:
    current = normalize_post_url(url)
    initial = urlsplit(current)
    target_path = initial.path.rstrip("/") if initial.hostname not in {"xhslink.com", "www.xhslink.com"} else None
    # Every redirect is validated before sending the next request. In
    # particular, never follow a platform share URL to an arbitrary host.
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=12), trust_env=True,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "text/html"}) as session:
        for _ in range(5):
            async with session.get(current, allow_redirects=False) as response:
                if response.status in {301, 302, 303, 307, 308}:
                    location = response.headers.get("Location")
                    if not location:
                        raise ValueError("POST_REDIRECT_MISSING")
                    next_url = normalize_post_url(urljoin(current, location))
                    original = urlsplit(current).hostname
                    if original == "tieba.baidu.com" and urlsplit(next_url).hostname != original:
                        raise ValueError("POST_REDIRECT_SITE_CHANGED")
                    if original != "tieba.baidu.com" and urlsplit(next_url).hostname == "tieba.baidu.com":
                        raise ValueError("POST_REDIRECT_SITE_CHANGED")
                    destination = urlsplit(next_url)
                    if target_path and destination.hostname not in {"xhslink.com", "www.xhslink.com"}:
                        # /explore/id and /discovery/item/id can refer to the
                        # same note; the identity itself must never change.
                        if destination.path.rstrip("/").split("/")[-1] != target_path.split("/")[-1]:
                            raise ValueError("POST_REDIRECT_TARGET_CHANGED")
                    current = next_url
                    continue
                if response.status != 200:
                    raise ValueError(f"POST_HTTP_{response.status}")
                data = bytearray()
                async for chunk in response.content.iter_chunked(65536):
                    data.extend(chunk)
                    if len(data) > MAX_HTML:
                        raise ValueError("POST_RESPONSE_TOO_LARGE")
                return parse_post(data.decode(response.charset or "utf-8", errors="replace"), current)
    raise ValueError("POST_TOO_MANY_REDIRECTS")


async def read_post(url: str) -> dict:
    try:
        result = await asyncio.wait_for(_read_post(url), 18)
        return {"status": "ok", "untrusted_page_data": True, **result}
    except (ValueError, TypeError, AttributeError, LookupError) as exc:
        # JSON errors may include fragments of page content; report codes only.
        code = str(exc) if re.fullmatch(r"[A-Z_0-9]+", str(exc)) else "POST_PARSE_FAILED"
    except (aiohttp.ClientError, TimeoutError):
        code = "POST_NETWORK_FAILED_OR_TIMEOUT"
    return {"status": "unavailable", "error": code,
            "next_step": "可用 Tavily 时用 advanced 提取原链接；仍受限则请用户提供正文或截图，不编造帖子内容。"}
