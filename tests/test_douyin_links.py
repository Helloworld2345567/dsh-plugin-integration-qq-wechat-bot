import json
import asyncio
from urllib.parse import quote
import unittest
from unittest.mock import AsyncMock, patch

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
            "https://p3-pc-sign.douyinpic.com/original-1.jpeg",
            "https://p3-pc-sign.douyinpic.com/original-2.jpeg",
        ])
        self.assertEqual(result["video"], "https://v.douyinstatic.com/live-photo.mp4")

    def test_parse_render_data_and_router_data(self):
        encoded = quote(json.dumps(page_payload()), safe="")
        render_html = f'<script id="RENDER_DATA" type="application/json">{encoded}</script>'
        self.assertEqual(len(parse_page(render_html, WORK_ID)["images"]), 2)
        router_html = f"window._ROUTER_DATA = {json.dumps(page_payload())};"
        self.assertEqual(len(parse_page(router_html, WORK_ID)["images"]), 2)

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
            with patch.object(platform_links, "resolve_reference", new=AsyncMock(return_value=source)) as reference, \
                    patch.object(platform_links, "resolve_link", new=AsyncMock(side_effect=AssertionError("public parser called"))), \
                    patch.object(SourceResolver, "resolve", new=AsyncMock(return_value=result)):
                resolved = asyncio.run(resolver.resolve(source, caller))
            self.assertEqual(resolved, result)
            reference.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
