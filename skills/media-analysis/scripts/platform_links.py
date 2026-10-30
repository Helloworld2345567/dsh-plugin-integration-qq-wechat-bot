"""Public share-link resolver. No account, browser profile or user cookies."""
import json
import re
from urllib.parse import urlsplit

import aiohttp

from video_understanding_core.models import VideoError
from video_understanding_core.network import PublicResolver, validate_url
from video_understanding_core.sources import SourceResolver, platform_source

# Public website's JSON endpoint; see its frontend and docs/references.md.
MEDIA_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
PARSE_ENDPOINT = 'https://shiguang.aihub.ren/api/parse'
PLATFORM_HOSTS = {'v.douyin.com', 'douyin.com', 'www.douyin.com', 'www.iesdouyin.com',
                  'b23.tv', 'bilibili.com', 'www.bilibili.com', 't.bilibili.com'}


def describe_link(url):
    parsed = validate_url(url)
    try:
        return platform_source(url)
    except VideoError:
        if parsed.hostname in ('douyin.com', 'www.douyin.com', 'www.iesdouyin.com'):
            match = re.fullmatch(r'/(?:share/)?note/(\d+)/?', parsed.path)
            if match:
                return {'kind': 'douyin', 'ref': url, 'work_id': match[1]}
        if parsed.hostname in ('www.bilibili.com', 'bilibili.com', 't.bilibili.com'):
            match = re.fullmatch(r'/(?:opus/|read/cv)?(\d+)/?', parsed.path)
            if match:
                return {'kind': 'bilibili', 'ref': url, 'work_id': match[1]}
        raise VideoError('UNSUPPORTED_SOURCE') from None


def normalize_result(payload, source):
    if not isinstance(payload, dict) or payload.get('succ') is not True or not isinstance(payload.get('data'), dict):
        raise VideoError('PUBLIC_LINK_PARSE_FAILED')
    data = payload['data']
    expected = source.get('work_id')
    actual = str(data.get('video_id', ''))
    if expected and expected != actual:
        raise VideoError('SOURCE_IDENTITY_MISMATCH')
    platform = data.get('platform')
    if platform != ('抖音' if source['kind'] == 'douyin' else '哔哩哔哩'):
        raise VideoError('SOURCE_IDENTITY_MISMATCH')
    images = []
    for item in data.get('image_list') or []:
        url = item if isinstance(item, str) else item.get('url') if isinstance(item, dict) else None
        if url and url not in images:
            validate_url(url)
            images.append(url)
    video = data.get('video_url') or ''
    if video:
        validate_url(video)
    return {'video': video, 'images': images, 'id': actual, 'title': str(data.get('title', ''))[:2000]}


async def resolve_link(url):
    source = describe_link(url)
    connector = aiohttp.TCPConnector(resolver=PublicResolver(), use_dns_cache=False)
    try:
        async with aiohttp.ClientSession(connector=connector, trust_env=False,
                                        timeout=aiohttp.ClientTimeout(total=None)) as client:
            async with client.post(PARSE_ENDPOINT, json={'url': source['ref']}, allow_redirects=False) as response:
                if response.status != 200:
                    raise VideoError('PUBLIC_LINK_SERVICE_UNAVAILABLE')
                raw = bytearray()
                async for chunk in response.content.iter_chunked(65536):
                    raw.extend(chunk)
                    if len(raw) > 1024 * 1024:
                        raise VideoError('RESOLVE_RESPONSE_TOO_LARGE')
                return normalize_result(json.loads(raw), source)
    except (aiohttp.ClientError, ValueError):
        raise VideoError('PUBLIC_LINK_SERVICE_UNAVAILABLE') from None


class PublicLinkResolver(SourceResolver):
    async def resolve(self, source, caller):
        self.describe(source['ref'], caller)
        if source['kind'] == 'attachment' or source.get('page', 1) != 1:
            return await super().resolve(source, caller)
        result = await resolve_link(source['ref'])
        if not result['video']:
            raise VideoError('LINK_IS_IMAGE_GALLERY_USE_IMAGE')
        referer = 'https://www.douyin.com/' if source['kind'] == 'douyin' else 'https://www.bilibili.com/'
        return {'source': source, 'streams': [{'url': result['video'], 'headers': {
            'User-Agent': MEDIA_USER_AGENT, 'Referer': referer}}]}


async def download_video(job):
    from pathlib import Path
    from video_understanding_core.models import Limits, CallerContext
    from video_understanding_core.media import MediaProcessor
    directory = Path(job['output'])
    limits = Limits(max_download_bytes=500 * 1024 * 1024, download_timeout=None, resolve_timeout=None, process_timeout=None)
    resolver = PublicLinkResolver(directory / 'sources', limits)
    caller = CallerContext(job['scope'], job['scope'], job['scope'])
    source = resolver.describe(job['parameters']['url'], caller)
    resolved = await resolver.resolve(source, caller)
    processor = MediaProcessor(limits)
    file = await resolver.fetch(resolved, directory, processor)
    probe = await processor.probe(file)
    if 'mp4' not in probe.container:
        raise VideoError('LINK_VIDEO_FORMAT_UNSUPPORTED')
    target = directory / 'original-video.mp4'
    file.rename(target)
    return {'assets': [{'path': str(target), 'name': target.name, 'kind': 'video', 'mime': 'video/mp4'}],
            'coverage': 'ORIGINAL_VIDEO_BYTES', 'incomplete': False}
