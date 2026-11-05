import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[1]

from dsh_bot_runtime.skills.media_analysis import platform_links
from dsh_bot_runtime.video_understanding import network, sources
from dsh_bot_runtime.video_understanding.media import MediaProcessor
from dsh_bot_runtime.video_understanding.models import AnalysisRequest, CallerContext, Limits, MediaProbe, VideoError
from dsh_bot_runtime.video_understanding.sources import SourceResolver


class VideoLimitTests(unittest.TestCase):
    def setUp(self):
        temporary = Path(os.environ.get('BOT_TEST_TMP', ROOT / '.codex'))
        temporary.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(prefix='video-limits-', dir=temporary)
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_video_download_accepts_500_mib_and_rejects_overflow(self):
        # Virtualize the stream length to exercise the real byte counter without
        # allocating or writing a 500 MiB fixture.
        class Chunk(bytes):
            def __len__(self):
                return reported_bytes

        class Response:
            status = 200
            headers = {}

            def __init__(self):
                self.content = self

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def iter_chunked(self, size):
                yield Chunk(b'video-fixture')

        class Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            def get(self, *args, **kwargs):
                return Response()

        resolved = {'streams': [{'url': 'https://example.com/video.mp4'}]}
        probe = MediaProbe(300, True, True, 13, 'h264', 'aac', 'mp4')
        for reported_bytes in (500 * 1024**2, 500 * 1024**2 + 1):
            with self.subTest(bytes=reported_bytes):
                output = self.root / str(reported_bytes)
                output.mkdir()
                job = {'scope': 'fixture', 'output': str(output), 'parameters': {'url': 'https://www.douyin.com/video/123'}}
                with patch.object(platform_links.PublicLinkResolver, 'resolve', new=AsyncMock(return_value=resolved)), \
                     patch.object(MediaProcessor, 'probe', new=AsyncMock(return_value=probe)), \
                     patch.object(network.aiohttp, 'TCPConnector', return_value=object()), \
                     patch.object(network.aiohttp, 'ClientSession', return_value=Client()):
                    if reported_bytes > 500 * 1024**2:
                        with self.assertRaisesRegex(VideoError, 'MEDIA_TOO_LARGE'):
                            asyncio.run(platform_links.download_video(job))
                        self.assertFalse((output / 'stream-0.media').exists())
                    else:
                        result = asyncio.run(platform_links.download_video(job))
                        self.assertFalse(result['incomplete'])
                        self.assertEqual(Path(result['assets'][0]['path']).read_bytes(), b'video-fixture')

    def test_analysis_attachment_accepts_500_mib_and_rejects_overflow(self):
        source = self.root / 'source.mp4'
        source.write_bytes(b'video-fixture')
        resolver = SourceResolver(self.root / 'attachments', Limits())
        caller = CallerContext('bot', 'user', 'session')
        original_stat = Path.stat

        def stat(path, *args, **kwargs):
            result = original_stat(path, *args, **kwargs)
            if path == source:
                values = {name: getattr(result, name) for name in dir(result) if name.startswith('st_')}
                values['st_size'] = reported_bytes
                return SimpleNamespace(**values)
            return result

        for reported_bytes in (500 * 1024**2, 500 * 1024**2 + 1):
            with self.subTest(bytes=reported_bytes), patch.object(Path, 'stat', stat):
                if reported_bytes > 500 * 1024**2:
                    with self.assertRaisesRegex(VideoError, 'MEDIA_TOO_LARGE'):
                        resolver.register_file(source, caller)
                else:
                    reference = resolver.register_file(source, caller)
                    self.assertEqual(resolver.attachments[reference].path.read_bytes(), b'video-fixture')

    def test_extractor_subprocess_uses_fixed_shim_and_minimal_environment(self):
        resolver = SourceResolver(self.root / 'resolver', Limits())
        caller = CallerContext('bot', 'user', 'session')
        source = resolver.describe('https://www.douyin.com/video/123', caller)
        payload = json.dumps({'source':'https://www.douyin.com/video/123','streams':[{'url':'https://example.com/media.mp4'}]})
        async def run_process(args, timeout, env):
            self.assertEqual(args[:2], [sys.executable, '-B'])
            self.assertEqual(Path(args[2]), ROOT / 'python/extract_worker.py')
            self.assertNotIn('PYTHONPATH', env); self.assertNotIn('PYTHONHOME', env)
            self.assertEqual(env['PYTHONNOUSERSITE'], '1')
            return payload
        with patch.object(sources, 'run_process', side_effect=run_process):
            resolved = asyncio.run(resolver.resolve(source, caller))
        self.assertEqual(resolved['source']['work_id'], '123')

    def test_video_analysis_duration_remains_300_seconds(self):
        processor = MediaProcessor(Limits())
        source = self.root / 'source.mp4'
        request = AnalysisRequest('fixture', 'describe')
        for duration in (300, 300.01):
            probe = MediaProbe(duration, True, True, 13, 'h264', 'aac', 'mp4')
            with self.subTest(duration=duration), patch.object(processor, 'probe', new=AsyncMock(return_value=probe)):
                if duration > 300:
                    with self.assertRaisesRegex(VideoError, 'RANGE_REQUIRED'):
                        asyncio.run(processor.prepare(source, self.root, request))
                else:
                    result = asyncio.run(processor.prepare(source, self.root, request))
                    self.assertEqual(result.end, duration)


if __name__ == '__main__':
    unittest.main()
