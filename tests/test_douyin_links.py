import json
import asyncio
from urllib.parse import quote
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from dsh_bot_runtime.skills.media_analysis import douyin_links, platform_links
from dsh_bot_runtime.skills.media_analysis.douyin_links import parse_page
from dsh_bot_runtime.video_understanding.models import CallerContext, Limits, VideoError
from dsh_bot_runtime.video_understanding.sources import SourceResolver, platform_source


WORK_ID = "7700530753418923304"


def page_payload():
    return {
        "__DEFAULT_SCOPE__": {
            "webapp.video-detail": {
                "itemInfo": {
                    "itemStruct": {
                        "aweme_id": WORK_ID,
                        "images": [
                            {"url_list": [
                                "https://p3-pc-sign.douyinpic.com/thumb-1.webp",
                                "https://p3-pc-sign.douyinpic.com/original-1.jpeg",
                                "https://p3-pc-sign.douyinpic.com/original-1.png",
                            ]},
                            {"url_list": ["https://p3-pc-sign.douyinpic.com/original-2.jpeg"]},
                            {"url_list": ["https://p3-pc-sign.douyinpic.com/original-2.jpeg"]},
                        ],
                        "video": {"play_addr": {"url_list": [
                            "https://v.douyinstatic.com/live-photo.mp4",
                        ]}},
                    }
                }
            }
        }
    }


class DouyinLinkTests(unittest.TestCase):
    def test_platform_source_accepts_note_as_image_source(self):
        source = platform_source(f"https://www.douyin.com/note/{WORK_ID}")
        self.assertEqual(source["kind"], "douyin")
        self.assertEqual(source["media"], "image")
        self.assertEqual(source["work_id"], WORK_ID)

    def test_parse_universal_data_extracts_highest_quality_unique_images(self):
        html = (
            '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">'
            + json.dumps(page_payload())
            + "</script>"
        )
        result = parse_page(html, WORK_ID)
        self.assertEqual(result["id"], WORK_ID)
        self.assertEqual(result["images"], [
            "https://p3-pc-sign.douyinpic.com/original-1.png",
            "https://p3-pc-sign.douyinpic.com/original-2.jpeg",
        ])
        self.assertEqual(result["video"], "https://v.douyinstatic.com/live-photo.mp4")

    def test_quality_hints_choose_original_png_and_keep_non_png_fallback(self):
        urls = [
            "https://cdn.example/thumb.webp",
            "https://cdn.example/full.jpeg?width=2048&height=2731",
            "https://cdn.example/preview.png?width=320&height=427",
            "https://cdn.example/original.png?width=2048&height=2731",
        ]
        self.assertEqual(douyin_links._select_preferred_url(urls), urls[-1])
        self.assertEqual(douyin_links._select_preferred_url(urls[:2]), urls[1])

    def test_parse_render_data_and_router_data(self):
        encoded = quote(json.dumps(page_payload()), safe="")
        render_html = f'<script id="RENDER_DATA" type="application/json">{encoded}</script>'
        self.assertEqual(len(parse_page(render_html, WORK_ID)["images"]), 2)
        router_html = f"window._ROUTER_DATA = {json.dumps(page_payload())};"
        self.assertEqual(len(parse_page(router_html, WORK_ID)["images"]), 2)

    def test_work_media_is_not_shadowed_by_statistics_or_status(self):
        payload = page_payload()
        item = payload['__DEFAULT_SCOPE__']['webapp.video-detail']['itemInfo']['itemStruct']
        item['statistics'] = {'aweme_id': WORK_ID, 'play_count': 10}
        item['status'] = {'aweme_id': WORK_ID, 'is_private': False}
        html = f'window._ROUTER_DATA = {json.dumps(payload)};'
        self.assertEqual(parse_page(html, WORK_ID)['video'], 'https://v.douyinstatic.com/live-photo.mp4')

    def test_video_resolution_uses_feed_and_rejects_galleries(self):
        source = {'kind': 'douyin', 'media': 'video', 'ref': f'https://www.douyin.com/video/{WORK_ID}', 'work_id': WORK_ID}
        with patch.object(douyin_links, 'resolve_reference', new=AsyncMock(return_value=source)), \
                patch.object(douyin_links, '_fetch_feed', new=AsyncMock(return_value={
                    'id': WORK_ID, 'video': 'https://cdn.example/video.mp4', 'images': []})) as feed:
            resolved = asyncio.run(douyin_links.resolve_video('https://v.douyin.com/example/'))
            self.assertEqual(resolved['streams'][0]['url'], 'https://cdn.example/video.mp4')
            feed.assert_awaited_once_with(WORK_ID)
            feed.return_value['images'] = ['https://cdn.example/photo.jpg']
            with self.assertRaisesRegex(VideoError, 'LINK_IS_IMAGE_GALLERY_USE_IMAGE'):
                asyncio.run(douyin_links.resolve_video(source['ref']))

    def test_feed_skips_unrelated_works_and_empty_media(self):
        item = {'aweme_id': WORK_ID, 'video': {'play_addr': {'url_list': ['https://cdn.example/right.mp4']}},
                'status': {'aweme_id': WORK_ID}}
        unrelated = {'aweme_id': '999', 'video': {'play_addr': {'url_list': ['https://cdn.example/wrong.mp4']}}}

        async def chunks(payload):
            yield json.dumps(payload).encode()

        for first in ({'aweme_list': [unrelated]}, {'aweme_list': [{'aweme_id': WORK_ID}]}, []):
            with self.subTest(first=first):
                responses = []
                for payload in (first, {'aweme_list': [item, unrelated]}):
                    response = MagicMock(status=200)
                    response.content.iter_chunked.return_value = chunks(payload)
                    context = MagicMock()
                    context.__aenter__ = AsyncMock(return_value=response)
                    responses.append(context)
                client = MagicMock()
                client.get.side_effect = responses
                session = MagicMock()
                session.__aenter__ = AsyncMock(return_value=client)
                with patch.object(douyin_links.aiohttp, 'TCPConnector'), \
                        patch.object(douyin_links.aiohttp, 'ClientSession', return_value=session):
                    result = asyncio.run(douyin_links._fetch_feed(WORK_ID))
                self.assertEqual(result['video'], 'https://cdn.example/right.mp4')
                self.assertEqual(client.get.call_count, 2)

    def test_parse_json_ld_image_gallery(self):
        payload = {
            "@type": "Article",
            "url": f"https://www.iesdouyin.com/share/note/{WORK_ID}/",
            "image": [
                "https://p3-pc-sign.douyinpic.com/original-1.jpeg",
                "https://p3-pc-sign.douyinpic.com/original-2.jpeg",
            ],
        }
        html = '<script type="application/ld+json">' + json.dumps(payload) + "</script>"
        self.assertEqual(len(parse_page(html, WORK_ID)["images"]), 2)

    def test_parse_rejects_missing_or_non_https_media(self):
        bad = {"__DEFAULT_SCOPE__": {"item": {"aweme_id": "different", "images": [{"url_list": ["http://example.com/a.jpg"]}]}}}
        html = f'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{json.dumps(bad)}</script>'
        with self.assertRaisesRegex(VideoError, "RESOLVE_FAILED"):
            parse_page(html, WORK_ID)

    def test_image_resolution_uses_local_page_parser(self):
        final = {"kind": "douyin", "media": "image", "ref": f"https://www.iesdouyin.com/share/note/{WORK_ID}", "work_id": WORK_ID}
        html = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">' + json.dumps(page_payload()) + "</script>"
        with patch.object(douyin_links, "_fetch_page", new=AsyncMock(return_value=(final, html))):
            images = asyncio.run(douyin_links.resolve_images(f"https://v.douyin.com/example/"))
        self.assertEqual(len(images), 2)

    def test_video_resolution_does_not_call_public_parser(self):
        source = {"kind": "douyin", "media": "video", "ref": f"https://www.douyin.com/video/{WORK_ID}", "work_id": WORK_ID}
        result = {"source": source, "streams": [{"url": "https://cdn.example/video.mp4"}]}
        import tempfile
        with tempfile.TemporaryDirectory() as root:
            resolver = platform_links.PublicLinkResolver(root, Limits())
            caller = CallerContext("scope", "user", "session")
            with patch.object(platform_links, "resolve_video", new=AsyncMock(return_value=result)) as video, \
                    patch.object(platform_links, "resolve_link", new=AsyncMock(side_effect=AssertionError("public parser called"))), \
                    patch.object(SourceResolver, "resolve", new=AsyncMock(side_effect=AssertionError("yt-dlp called"))):
                resolved = asyncio.run(resolver.resolve(source, caller))
            self.assertEqual(resolved, result)
            video.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
