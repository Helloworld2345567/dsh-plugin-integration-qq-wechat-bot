"""Download original image bytes from direct links or public page image references."""
from html.parser import HTMLParser
from pathlib import Path
import json
import re
import aiohttp
from urllib.parse import urljoin, urlsplit

from PIL import Image, UnidentifiedImageError
from video_understanding_core.network import download
from video_understanding_core.models import VideoError
from platform_links import PLATFORM_HOSTS, resolve_link, MEDIA_USER_AGENT

MAX_IMAGES = 8
MAX_BYTES = 20 * 1024 * 1024


class PageImages(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.images, self.fallback = [], []
        self.anchor = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'a':
            href = a.get('href', '')
            self.anchor = href if re.search(r'\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)', href, re.I) else None
        elif tag == 'img':
            original = self.anchor or next((a[k] for k in ('data-original', 'data-original-src', 'data-full') if a.get(k)), None)
            candidates = []
            for entry in a.get('srcset', '').split(','):
                parts = entry.strip().split()
                if parts:
                    try:
                        score = float(parts[1][:-1]) if len(parts) > 1 else 1
                    except ValueError:
                        score = 0
                    candidates.append((score, parts[0]))
            value = original or (max(candidates)[1] if candidates else a.get('data-src') or a.get('src'))
            if value:
                self.images.append(value)
        elif tag == 'meta' and a.get('property', a.get('name', '')) in ('og:image', 'og:image:secure_url', 'twitter:image'):
            if a.get('content'):
                self.fallback.append(a['content'])

    def handle_endtag(self, tag):
        if tag == 'a':
            self.anchor = None


def page_images(html, base):
    parser = PageImages()
    parser.feed(html)
    # Read XHS's selected note only; never evaluate page JavaScript.
    match = re.search(r'(?:window\.)?__INITIAL_STATE__\s*=\s*', html)
    originals = []
    if match and urlsplit(base).hostname in ('www.xiaohongshu.com', 'xiaohongshu.com'):
        raw = re.sub(r'"(?:\\.|[^"\\])*"|\bundefined\b', lambda m: 'null' if m[0] == 'undefined' else m[0], html[match.end():])
        try:
            state, _ = json.JSONDecoder().raw_decode(raw)
            note_id = urlsplit(base).path.rstrip('/').split('/')[-1]
            note = state.get('note', {}).get('noteDetailMap', {}).get(note_id, {}).get('note', {})
            for item in note.get('imageList', []):
                url = item.get('urlDefault') or item.get('url')
                if url:
                    originals.append(url)
        except (ValueError, TypeError, AttributeError):
            pass
    urls = []
    for value in originals or parser.images or parser.fallback:
        url = urljoin(base, value).split('#', 1)[0]
        if url.startswith('https://') and url not in urls:
            urls.append(url)
    return urls


def image_file(path, index):
    try:
        with Image.open(path) as img:
            fmt = img.format
            img.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return None
    extension = {'JPEG': 'jpg', 'PNG': 'png', 'WEBP': 'webp', 'GIF': 'gif', 'AVIF': 'avif'}.get(fmt)
    if not extension:
        return None
    target = path.with_name(f'original-{index}.{extension}')
    path.rename(target)
    return {'path': str(target), 'name': target.name, 'mime': Image.MIME[fmt], 'kind': 'image'}


async def execute(job):
    directory = Path(job['output'])
    url = job['parameters']['url']
    if urlsplit(url).hostname in PLATFORM_HOSTS:
        result = await resolve_link(url)
        if not result['images']:
            raise VideoError('LINK_HAS_NO_IMAGE_GALLERY')
        return await download_images(result['images'], url, directory, 'PLATFORM_ORIGINAL_IMAGES')
    source = directory / 'image-source.bin'
    info = await download(job['parameters']['url'], source, MAX_BYTES, None,
                          {'User-Agent': MEDIA_USER_AGENT}, metadata=True)
    direct = image_file(source, 1)
    if direct:
        return {'assets': [direct], 'coverage': 'ORIGINAL_IMAGE_BYTES', 'incomplete': False}
    try:
        if source.stat().st_size > 3 * 1024 * 1024 or 'html' not in info['content_type'].lower():
            raise VideoError('NOT_AN_IMAGE_OR_HTML_PAGE')
        urls = page_images(source.read_text(encoding='utf-8', errors='replace'), info['url'])
    finally:
        source.unlink(missing_ok=True)
    if not urls:
        raise VideoError('PAGE_IMAGES_UNAVAILABLE_LOGIN_OR_BLOCKED')
    return await download_images(urls, info['url'], directory, 'PAGE_IMAGE_BYTES')


async def download_images(urls, referer, directory, coverage):
    assets, failures, budget = [], 0, 50 * 1024 * 1024
    for index, url in enumerate(urls[:MAX_IMAGES], 1):
        target = directory / f'download-{index}.bin'
        try:
            size = await download(url, target, min(MAX_BYTES, budget), None,
                                  {'User-Agent': MEDIA_USER_AGENT, 'Referer': referer})
            budget -= size
            asset = image_file(target, index)
            if asset:
                assets.append(asset)
            else:
                failures += 1
        except (VideoError, OSError, aiohttp.ClientError, TimeoutError):
            failures += 1
        finally:
            target.unlink(missing_ok=True)
        if budget <= 0:
            break
    if not assets:
        raise VideoError('PAGE_IMAGE_DOWNLOAD_FAILED')
    return {'assets': assets, 'coverage': coverage, 'incomplete': len(assets) < len(urls),
            'text': json.dumps({'downloaded': len(assets), 'discovered': len(urls), 'failed': failures,
                                'note': '保留下载字节；优先页面提供的原图地址，未声明原图时使用最高可用尺寸。'}, ensure_ascii=False)}
