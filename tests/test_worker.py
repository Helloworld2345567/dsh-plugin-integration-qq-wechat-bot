import base64
import io
import os
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]


from dsh_bot_runtime import worker
from dsh_bot_runtime.skills.image_generation import image_api
from dsh_bot_runtime.skills.media_analysis import media_api
IMPORTED_SKILL_OPERATIONS = worker.SKILL_OPERATIONS


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=ROOT / '.codex')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def job(self, operation, source=None, **params):
        endpoint = dict(baseUrl='https://example.invalid/v1', model='fixture')
        if operation not in {'image_generate', 'image_edit'}:
            endpoint['keyEnv'] = 'TEST_PROVIDER_KEY'
        return dict(id='test', scope='scope', operation=operation, deadline=time.time()*1000+30000,
                    inputs=[dict(path=str(source), name=source.name, kind='file', mime='application/octet-stream')] if source else [],
                    parameters=params, output=str(self.root), endpoint=endpoint)

    def test_worker_import_does_not_scan_optional_skill_manifests(self):
        self.assertIsNone(IMPORTED_SKILL_OPERATIONS)

    def test_skill_manifest_dispatch_without_worker_switch(self):
        skills = self.root / 'skills'
        folder = skills / 'media-analysis'
        folder.mkdir(parents=True)
        manifest = {'skill': 'media-analysis', 'entry': 'dsh_bot_runtime.skills.media_analysis.media_api',
                    'operations': [{'id': 'fixture_extract'}]}
        (folder / 'operations.json').write_text(json.dumps(manifest), encoding='utf8')
        declarations = worker.load_skill_operations(skills)
        job = self.job('fixture_extract', value='skill-owned-result')
        job['handler'] = 'skill'
        module = Mock(execute=lambda value: {'text': value['parameters']['value'], 'coverage': 'FIXTURE'})
        with patch.object(worker, 'SKILL_OPERATIONS', declarations), patch('importlib.import_module', return_value=module):
            self.assertEqual(worker.execute(job)['text'], 'skill-owned-result')
            with self.assertRaisesRegex(worker.JobError, 'UNKNOWN_MEDIA_OPERATION'):
                worker.execute({**job, 'operation': 'undeclared'})
            with self.assertRaisesRegex(worker.JobError, 'UNKNOWN_MEDIA_OPERATION'):
                worker.execute({**job, 'handler': 'typo'})
            self.assertEqual(worker.execute({**job, 'handler': 'fixture_extract'})['text'], 'skill-owned-result')
        manifest['entry'] = 'outside.worker'
        (folder / 'operations.json').write_text(json.dumps(manifest), encoding='utf8')
        with self.assertRaisesRegex(worker.JobError, 'MANIFEST_INVALID'):
            worker.load_skill_operations(skills)

    def test_broken_optional_skill_is_isolated_and_uses_stable_codes(self):
        skills = self.root / 'skills'
        good = skills / 'media-analysis'; bad = skills / 'broken'
        good.mkdir(parents=True); bad.mkdir(parents=True)
        (good / 'operations.json').write_text(json.dumps({'skill':'media-analysis','entry':'dsh_bot_runtime.skills.media_analysis.media_api','operations':[{'id':'fixture_extract'}]}), encoding='utf8')
        (bad / 'operations.json').write_text(json.dumps({'skill':'broken','entry':'outside.private','operations':[{'id':'fixture_extract'},{'id':'broken_extract'}]}), encoding='utf8')
        declarations = worker.load_skill_operations(skills, tolerate_invalid=True)
        self.assertIn('fixture_extract', declarations); self.assertIn('broken_extract', declarations)
        self.assertEqual(declarations['fixture_extract'][0], 'media-analysis')
        with patch.object(worker, 'SKILL_OPERATIONS', declarations):
            with self.assertRaisesRegex(worker.JobError, '^SKILL_OPERATION_MANIFEST_INVALID$'):
                worker.execute({**self.job('broken_extract'), 'handler':'skill'})
            with patch('importlib.import_module', side_effect=RuntimeError('private E:/machine/endpoint?token=secret')):
                with self.assertRaisesRegex(worker.JobError, '^SKILL_OPERATION_IMPORT_FAILED$'):
                    worker.execute({**self.job('fixture_extract'), 'handler':'skill'})
            missing = ModuleNotFoundError("No module named 'edge_tts'", name='edge_tts')
            with patch('importlib.import_module', side_effect=missing):
                with self.assertRaisesRegex(worker.JobError, '^SKILL_OPTIONAL_DEPENDENCY_MISSING$'):
                    worker.execute({**self.job('fixture_extract'), 'handler':'skill'})
            class ExternalFailure(Exception):
                code = 'LEAK_PRIVATE_PATH'
            module = Mock(execute=Mock(side_effect=ExternalFailure('E:/private')))
            with patch('importlib.import_module', return_value=module):
                with self.assertRaisesRegex(worker.JobError, '^SKILL_OPERATION_FAILED$'):
                    worker.execute({**self.job('fixture_extract'), 'handler':'skill'})
        text = self.root / 'safe.txt'; text.write_text('unrelated capability', encoding='utf8')
        self.assertEqual(worker.execute(self.job('document_read', text))['text'], 'unrelated capability')

    def test_malformed_optional_manifests_are_quarantined(self):
        for index, payload in enumerate(('[]', 'null', '7', '{bad', json.dumps({'skill':'broken','entry':'outside.worker','operations':7}))):
            with self.subTest(payload=payload):
                skills = self.root / f'malformed-{index}'; folder = skills / 'broken'; folder.mkdir(parents=True)
                (folder / 'operations.json').write_text(payload, encoding='utf8')
                self.assertEqual(worker.load_skill_operations(skills, tolerate_invalid=True), {})

    def test_shipped_skill_operations_dispatch_declared_entry(self):
        self.assertEqual(set(worker.skill_operations()), {'transcribe', 'video_analyze', 'image_download', 'video_download', 'voice_speak', 'image_convert', 'image_compress', 'image_resize', 'convert_gif', 'singing_convert', 'music_search', 'music_acquire', 'music_delivery'})
        job = self.job('image_download')
        job['handler'] = 'skill'
        # Real entry import and error translation, without a provider/network call.
        job['inputs'] = [{ 'path': 'unused', 'name': 'unused', 'kind': 'image', 'mime': 'image/png'}] * 2
        with self.assertRaisesRegex(worker.JobError, 'ONE_MEDIA_INPUT_REQUIRED'):
            worker.execute(job)

    def test_music_catalog_operations_require_host_adapter(self):
        for operation in ('music_search', 'music_acquire'):
            job = self.job(operation)
            job['handler'] = 'skill'
            job.pop('endpoint')
            with self.subTest(operation=operation), self.assertRaisesRegex(worker.JobError, 'MUSIC_HOST_ADAPTER_REQUIRED'):
                worker.execute(job)

    def test_unlimited_media_job_and_platform_source_routing(self):
        job = self.job('transcribe')
        job.update(timeoutMs=0, deadline=0)
        worker._validate_protocol(job)
        self.assertIsNone(media_api.remaining(job))
        from dsh_bot_runtime.video_understanding.models import Limits
        self.assertIsNone(Limits(job_timeout=None, model_timeout=None).job_timeout)
        from dsh_bot_runtime.video_understanding.sources import platform_source
        self.assertEqual(platform_source('https://v.douyin.com/34Ae2yNHPXs/')['kind'], 'douyin')
        self.assertEqual(platform_source('https://www.bilibili.com/video/BV1xx411c7mD?p=2')['page'], 2)

    def test_signed_download_preserves_escaped_url(self):
        import asyncio
        from dsh_bot_runtime.video_understanding import network
        url = 'https://example.com/image%2Fname.webp?x-signature=abc%2Fdef%3D'
        class Response:
            status = 200
            headers = {}
            def __init__(self): self.content = self
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def iter_chunked(self, size): yield b'image-bytes'
        class Client:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            def get(client, requested, **kwargs):
                self.assertEqual(str(requested), url)
                self.assertFalse(kwargs['allow_redirects'])
                return Response()
        target = self.root / 'download.bin'
        with patch.object(network.aiohttp, 'TCPConnector', return_value=object()), patch.object(network.aiohttp, 'ClientSession', return_value=Client()):
            self.assertEqual(asyncio.run(network.download(url, target, 100, None)), 11)
        self.assertEqual(target.read_bytes(), b'image-bytes')

    def test_public_link_parser_keeps_identity_and_gallery_originals(self):
        from dsh_bot_runtime.skills.media_analysis.platform_links import describe_link, normalize_result
        from dsh_bot_runtime.video_understanding.models import VideoError
        source = describe_link('https://www.douyin.com/note/7662259898261030499')
        payload = {'succ': True, 'data': {'platform': '抖音', 'video_id': source['work_id'], 'image_list': ['https://example.com/original.webp', {'url': 'https://example.com/second.webp'}]}}
        self.assertEqual(len(normalize_result(payload, source)['images']), 2)
        payload['data']['video_id'] = 'different'
        with self.assertRaisesRegex(VideoError, 'SOURCE_IDENTITY_MISMATCH'):
            normalize_result(payload, source)
        with self.assertRaisesRegex(VideoError, 'PUBLIC_LINK_PARSE_FAILED'):
            normalize_result({'succ': False}, source)
        with self.assertRaises(VideoError):
            describe_link('https://example.com/not-a-platform')

    def test_original_image_selection_and_bytes(self):
        from dsh_bot_runtime.skills.media_analysis.image_download import page_images, image_file
        html = '<img src="thumb.jpg" data-original="full.png"><img srcset="small.jpg 200w, large.jpg 1200w"><a href="original.webp"><img src="preview.jpg"></a>'
        self.assertEqual(page_images(html, 'https://example.com/post/'), ['https://example.com/post/full.png', 'https://example.com/post/large.jpg', 'https://example.com/post/original.webp'])
        from PIL import Image
        file = self.root / 'download.bin'
        Image.new('RGB', (31, 27), 'green').save(file, format='PNG')
        original = file.read_bytes()
        result = image_file(file, 1)
        self.assertEqual(result['mime'], 'image/png')
        self.assertEqual(Path(result['path']).read_bytes(), original)
        file.write_text('<html>not an image</html>')
        self.assertIsNone(image_file(file, 2))

    def test_gallery_download_delivers_100_and_reports_overflow(self):
        from dsh_bot_runtime.skills.media_analysis import image_download
        from PIL import Image
        content = io.BytesIO()
        Image.new('RGB', (3, 2), 'green').save(content, format='PNG')
        original = content.getvalue()
        for count in (100, 101):
            with self.subTest(discovered=count):
                directory = self.root / str(count)
                directory.mkdir()
                urls = [f'https://example.com/image-{index}.png' for index in range(count)]
                downloaded = []
                async def resolve_images(url, cookie_file):
                    return urls
                async def download(url, target, *args, **kwargs):
                    downloaded.append(url)
                    target.write_bytes(original)
                    return len(original)
                job = self.job('image_download', url='https://www.douyin.com/note/fixture')
                job.update(handler='skill', output=str(directory))
                with patch.object(image_download, 'resolve_images', side_effect=resolve_images), patch.object(image_download, 'download', side_effect=download):
                    result = worker.execute(job)
                self.assertEqual(downloaded, urls[:100])
                self.assertEqual(len(result['assets']), 100)
                self.assertEqual(result['incomplete'], count > 100)
                self.assertEqual(json.loads(result['text'])['discovered'], count)
                for asset in result['assets']:
                    self.assertEqual(Path(asset['path']).read_bytes(), original)

    def test_worker_result_protocol_accepts_100_files_and_rejects_101(self):
        files = [dict(path=f'/job/original-{index}.png', name=f'original-{index}.png', mime='image/png', kind='image') for index in range(101)]
        for key in ('assets', 'contextAssets'):
            with self.subTest(field=key):
                result = {key: files[:100]}
                self.assertIs(worker._validate_result(result), result)
                with self.assertRaisesRegex(worker.JobError, 'MEDIA_WORKER_RESULT_INVALID'):
                    worker._validate_result({key: files})

    def test_documents_use_actual_contents_and_preserve_unicode(self):
        from docx import Document
        from openpyxl import Workbook
        text = self.root / 'text.txt'; text.write_text('你好，文档内容', encoding='utf-8')
        self.assertEqual(worker.execute(self.job('document_read', text))['text'], '你好，文档内容')
        csv = self.root / 'data.csv'; csv.write_text('name,value\n猫,7', encoding='utf-8')
        self.assertIn('猫,7', worker.execute(self.job('document_read', csv))['text'])
        doc = Document(); doc.add_paragraph('document fixture 42'); file = self.root / 'document.docx'; doc.save(file)
        self.assertIn('fixture 42', worker.execute(self.job('document_read', file))['text'])
        book = Workbook(); book.active.append(['known cell', 63]); file = self.root / 'sheet.xlsx'; book.save(file); book.close()
        self.assertIn('known cell\t63', worker.execute(self.job('document_read', file))['text'])

    def test_scanned_pdf_returns_pixels_for_native_chat_without_vision_service(self):
        from pypdf import PdfWriter
        file = self.root / 'scan.pdf'; writer = PdfWriter(); writer.add_blank_page(width=200, height=200)
        with file.open('wb') as handle: writer.write(handle)
        job = self.job('document_read', file); job['endpoint'] = None
        with patch('requests.Session') as request:
            result = worker.execute(job); request.assert_not_called()
        self.assertFalse(result['incomplete']); self.assertIn('current chat model', result['text'])
        self.assertEqual(result['coverage'], 'DOCUMENT_TEXT_AND_PAGE_PIXELS')
        from PIL import Image
        with Image.open(result['contextAssets'][0]['path']) as page:
            self.assertEqual(page.format, 'JPEG'); self.assertGreater(page.width, 0)

    def test_scan_render_limit_reports_unread_pages(self):
        from pypdf import PdfWriter
        file=self.root/'many-pages.pdf'; writer=PdfWriter()
        for _ in range(11): writer.add_blank_page(width=200,height=200)
        with file.open('wb') as handle: writer.write(handle)
        job=self.job('document_read',file);job['endpoint']=None
        result=worker.execute(job);self.assertTrue(result['incomplete']);self.assertEqual(len(result['contextAssets']),10)

    def test_reference_edit_requires_real_input_and_canonical_client(self):
        with self.assertRaisesRegex(worker.JobError, 'REFERENCE_IMAGE_REQUIRED'): worker.execute(self.job('image_edit', prompt='edit'))
        from PIL import Image
        file = self.root / 'ref.png'; Image.new('RGB', (20, 20), 'green').save(file)
        job = self.job('image_edit', file, prompt='edit this'); job['inputs'][0]['kind'] = 'image'
        job['endpoint']['keyEnv'] = 'CUSTOM_IMAGE_KEY'
        def fake(command, **kwargs):
            self.assertEqual(command[1:3], ['-B', str(ROOT / 'python/image_api.py')])
            self.assertIn('--image', command); self.assertIn(str(file), command)
            self.assertEqual(command[command.index('--api-key-env') + 1], 'CUSTOM_IMAGE_KEY')
            output = self.root / 'generated.jpg'; Image.new('RGB',(10,10),'blue').save(output)
            (self.root / 'image-result.json').write_text(json.dumps({'outputs':[output.name]}),encoding='utf-8')
            return Mock(returncode=0)
        with patch.object(worker.subprocess, 'run', side_effect=fake): self.assertEqual(len(worker.execute(job)['assets']), 1)

    def test_image_worker_forwards_native_format_options_and_returns_matching_mime(self):
        job = self.job('image_generate', prompt='vector icon', output_format='svg', complexity='medium')
        def fake(command, **kwargs):
            self.assertEqual(command[command.index('--api-key-env') + 1], 'OPENAI_API_KEY')
            self.assertIn('--output-format', command); self.assertEqual(command[command.index('--output-format') + 1], 'svg')
            self.assertIn('--complexity', command); self.assertEqual(command[command.index('--complexity') + 1], 'medium')
            output = self.root / 'generated.svg'; output.write_text('<svg width="8" height="8" xmlns="http://www.w3.org/2000/svg"><circle cx="4" cy="4" r="3"/></svg>', encoding='utf-8')
            (self.root / 'image-result.json').write_text(json.dumps({'outputs': [output.name]}), encoding='utf-8')
            return Mock(returncode=0)
        with patch.object(worker.subprocess, 'run', side_effect=fake):
            result = worker.execute(job)
        self.assertEqual(result['assets'][0]['mime'], 'image/svg+xml')
        self.assertEqual(result['assets'][0]['name'], 'generated.svg')

    def test_comfyui_image_worker_routes_without_provider_key(self):
        job = self.job('image_generate', prompt='local workflow')
        job['endpoint'] = {
            'protocol': 'comfyui', 'baseUrl': 'http://127.0.0.1:8188', 'model': 'comfyui',
            'workflowPath': r'E:\COMFYUI\workflows\infrastructure-smoke-api.json',
        }
        def fake(command, **kwargs):
            self.assertIn('--protocol', command); self.assertEqual(command[command.index('--protocol') + 1], 'comfyui')
            self.assertNotIn('--api-key-env', command)
            self.assertEqual(command[command.index('--workflow') + 1], job['endpoint']['workflowPath'])
            output = self.root / 'generated.png'; output.write_bytes(b'\x89PNG\r\n\x1a\n')
            (self.root / 'image-result.json').write_text(json.dumps({'outputs': [output.name]}), encoding='utf-8')
            return Mock(returncode=0)
        with patch.object(worker.subprocess, 'run', side_effect=fake):
            result = worker.execute(job)
        self.assertEqual(result['assets'][0]['mime'], 'image/png')

    def test_image_requires_exact_output_record_without_directory_scan_fallback(self):
        from PIL import Image
        job = self.job('image_generate', prompt='recorded')
        output = self.root / 'generated.jpg'; Image.new('RGB', (10, 10), 'blue').save(output)
        def fake(command, **kwargs):
            (self.root / 'image-result.json').write_text(json.dumps({'outputs': []}), encoding='utf-8')
            return Mock(returncode=0)
        with patch.object(worker.subprocess, 'run', side_effect=fake):
            with self.assertRaisesRegex(worker.JobError, 'IMAGE_OUTPUT_RECORD_INVALID'): worker.execute(job)
        def missing(command, **kwargs):
            (self.root / 'image-result.json').write_text(json.dumps({'verdict': 'PASS'}), encoding='utf-8')
            return Mock(returncode=0)
        with patch.object(worker.subprocess, 'run', side_effect=missing):
            with self.assertRaisesRegex(worker.JobError, 'IMAGE_OUTPUT_RECORD_MISSING'): worker.execute(job)

    def test_image_cli_failure_stdout_and_record_are_redacted(self):
        import requests
        record = self.root / 'private-record.json'
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'private-secret'}, clear=True), \
                patch('requests.Session', side_effect=requests.Timeout('private-secret')), \
                patch('sys.stdout', new_callable=io.StringIO) as stdout:
            result = image_api.main(['generate', '--prompt', 'private prompt', '--base-url', 'https://private.invalid/v1',
                                     '--output-dir', str(self.root), '--record', str(record)])
        self.assertEqual(result, 1)
        combined = stdout.getvalue() + record.read_text(encoding='utf8')
        self.assertNotIn('private prompt', combined); self.assertNotIn('private.invalid', combined)
        self.assertNotIn('private-secret', combined); self.assertNotIn(str(self.root), combined)
        self.assertEqual(json.loads(stdout.getvalue())['error']['code'], 'IMAGE_PROVIDER_FAILED')

    def test_image_client_normalizes_jpeg_and_does_not_replay_paid_requests(self):
        from PIL import Image
        buf = io.BytesIO(); Image.new('RGBA', (12,12), (0,255,0,100)).save(buf, 'PNG')
        files = image_api.save_images([(buf.getvalue(),'image/png')],self.root,'fixture')
        self.assertEqual(len(files),1)
        with Image.open(files[0]) as result: self.assertEqual(result.format,'JPEG')
        session = Mock(); session.request.side_effect=TimeoutError('uncertain upstream outcome')
        with self.assertRaises(TimeoutError): image_api.request_with_retry(session,'POST','https://example.invalid',headers={},timeout=1)
        self.assertEqual(session.request.call_count,1)

    def test_image_client_preserves_gif_and_svg_and_rejects_provider_format_mismatch(self):
        gif = b'GIF89a' + b'\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff' + b'\x21\xf9\x04\x01\x00\x00\x00\x00' + b'\x2c\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;'
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="red"/></svg>'
        self.assertEqual(image_api.detect_content_type(gif), 'image/gif')
        self.assertEqual(image_api.detect_content_type(svg), 'image/svg+xml')
        gif_path = image_api.save_images([(gif, 'image/gif')], self.root, 'fixture', output_format='gif')[0]
        svg_path = image_api.save_images([(svg, 'image/svg+xml')], self.root, 'fixture-svg', output_format='svg')[0]
        self.assertEqual(gif_path.suffix, '.gif'); self.assertEqual(gif_path.read_bytes(), gif)
        self.assertEqual(svg_path.suffix, '.svg'); self.assertEqual(svg_path.read_bytes(), svg)
        with self.assertRaisesRegex(ValueError, 'provider returned'):
            image_api.save_images([(b'\x89PNG\r\n\x1a\n', 'image/png')], self.root, 'mismatch', output_format='svg')

    def test_image_cli_accepts_native_animation_options(self):
        with patch.object(sys, 'argv', ['image_api.py', 'generate', '--prompt', 'test', '--output-format', 'gif', '--frame-count', '4', '--frame-duration-ms', '120', '--complexity', 'medium', '--dry-run']):
            args = image_api.parse_args()
            self.assertEqual((args.output_format, args.frame_count, args.frame_duration_ms, args.complexity), ('gif', 4, 120, 'medium'))

    def test_image_cli_uses_explicit_configuration_and_selected_api_key(self):
        retired = dict(BOT_IMAGE_BASE_URL='https://ignored.example/v1', BOT_IMAGE_MODEL='ignored-model',
                       BOT_IMAGE_KEY_ENV='CUSTOM_IMAGE_KEY', SAKURA_IMAGE_BASE_URL='https://ignored.example/v1',
                       SAKURA_IMAGE_MODEL='ignored-model', OPENAI_BASE_URL='https://ignored.example/v1',
                       IMAGE_ACCESS_KEY='ignored-key', SAKURA_IMAGE_API_KEY='ignored-key', CUSTOM_IMAGE_KEY='ignored-key')
        with patch.dict(os.environ, retired, clear=True):
            args = image_api.parse_args(['generate', '--prompt', 'test', '--dry-run'])
            self.assertEqual((args.base_url, args.model), (image_api.DEFAULT_BASE_URL, image_api.DEFAULT_MODEL))
            self.assertEqual(args.api_key_env, 'OPENAI_API_KEY')
            args = image_api.parse_args(['generate', '--prompt', 'test', '--base-url', 'https://explicit.example/v1', '--model', 'explicit-model'])
            self.assertEqual((args.base_url, args.model), ('https://explicit.example/v1', 'explicit-model'))
            with self.assertRaisesRegex(ValueError, 'OPENAI_API_KEY is required'):
                image_api.read_api_key()
            with patch.dict(os.environ, {'OPENAI_API_KEY': ' fixture-key '}):
                self.assertEqual(image_api.read_api_key(), 'fixture-key')
                with self.assertRaisesRegex(ValueError, 'MISSING_IMAGE_KEY is required'):
                    image_api.read_api_key('MISSING_IMAGE_KEY')
            args = image_api.parse_args(['generate', '--prompt', 'test', '--api-key-env', 'CUSTOM_IMAGE_KEY'])
            self.assertEqual(args.api_key_env, 'CUSTOM_IMAGE_KEY')
            self.assertEqual(image_api.read_api_key(args.api_key_env), 'ignored-key')

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'ffmpeg not installed')
    def test_audio_analysis_sends_actual_wav_and_detects_missing_media(self):
        import wave
        file=self.root/'audio.wav'
        with wave.open(str(file),'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(b'\0\0'*1600)
        job=self.job('transcribe',file,question='转写');job['endpoint']['protocol']='chat_completions'
        def response(body):return {'choices':[{'finish_reason':'stop','message':{'content':json.dumps(body)}}]}
        value={'received_media':True,'transcript':'known phrase','summary':'测试','uncertainty':[]}
        with patch.object(media_api,'request',return_value=response(value)) as request:
            result=media_api.execute(job);self.assertEqual(json.loads(result['text'])['transcript'],'known phrase')
            payload=request.call_args.kwargs['body'];self.assertEqual(payload['model'],'fixture');self.assertEqual(request.call_args.args[1],'/chat/completions')
            audio=payload['messages'][0]['content'][1]['input_audio'];self.assertEqual(audio['format'],'wav');self.assertEqual(base64.b64decode(audio['data']),(self.root/'analysis-audio.wav').read_bytes())
            self.assertNotIn('TEST_PROVIDER_KEY',json.dumps(payload));self.assertGreater(json.loads(result['text'])['coverage']['endSeconds'],0)
        with patch.object(media_api,'request',return_value=response({'received_media':False})):
            with self.assertRaisesRegex(media_api.AnalysisError,'MEDIA_NOT_RECEIVED'):media_api.execute(job)
        job['endpoint']['protocol']='transcriptions'
        job['endpoint']['model']='google/gemini-asr'
        with patch.object(media_api,'request',return_value={'text':'known phrase'}) as request:
            self.assertEqual(json.loads(media_api.execute(job)['text'])['transcript'],'known phrase');self.assertIn('file',request.call_args.kwargs['files'])
            self.assertEqual(request.call_args.args[1],'/audio/transcriptions');self.assertEqual(request.call_args.kwargs['data']['model'],'google/gemini-asr')
        with patch.object(media_api,'request',return_value={'text':''}):
            with self.assertRaisesRegex(media_api.AnalysisError,'EMPTY_TRANSCRIPT'):media_api.execute(job)

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'ffmpeg not installed')
    def test_gemini_audio_uses_mime_data_url_without_retrying_missing_media(self):
        import wave
        file=self.root/'audio.wav'
        with wave.open(str(file),'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(b'\x10\x00'*1600)
        job=self.job('transcribe',file,question='转写');job['endpoint']['protocol']='chat_completions'
        def response(body):return {'choices':[{'finish_reason':'stop','message':{'content':json.dumps(body)}}]}
        value={'received_media':True,'transcript':'known phrase','summary':'测试','uncertainty':[]}
        for model in ('gemini-3.8-flash-tiered','google/GeMiNi-3.8-flash-tiered'):
            with self.subTest(model=model),patch.object(media_api,'request',return_value=response(value)) as request:
                job['endpoint']['model']=model
                self.assertEqual(json.loads(media_api.execute(job)['text'])['transcript'],'known phrase')
                request.assert_called_once();self.assertEqual(request.call_args.args[1],'/chat/completions')
                payload=request.call_args.kwargs['body'];self.assertEqual(payload['model'],model)
                audio=payload['messages'][0]['content'][1];self.assertEqual(audio['type'],'image_url');self.assertNotIn('input_audio',audio)
                mime,encoded=audio['image_url']['url'].split(',',1);self.assertEqual(mime,'data:audio/wav;base64')
                self.assertEqual(base64.b64decode(encoded),(self.root/'analysis-audio.wav').read_bytes())
        with patch.object(media_api,'request',return_value=response({'received_media':False})) as request:
            with self.assertRaisesRegex(media_api.AnalysisError,'MEDIA_NOT_RECEIVED'):media_api.execute(job)
            request.assert_called_once()

    def test_analysis_http_uses_only_injected_key_and_does_not_retry_uncertain_requests(self):
        import requests
        session=Mock();session.__enter__=Mock(return_value=session);session.__exit__=Mock(return_value=False)
        response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        response.status_code=200;response.iter_content.return_value=[b'{"text":"ok"}'];session.post.return_value=response
        with patch.dict(os.environ,{'TEST_PROVIDER_KEY':'fixture-secret'},clear=True),patch('requests.Session',return_value=session):
            result=media_api.request(self.job('transcribe'),'/chat/completions',body={'model':'fixture'})
            self.assertEqual(result['text'],'ok');self.assertEqual(session.post.call_args.kwargs['headers']['Authorization'],'Bearer fixture-secret')
            self.assertFalse(session.post.call_args.kwargs['allow_redirects']);self.assertFalse(session.trust_env)
            session.post.reset_mock();session.post.side_effect=requests.Timeout('secret must not appear')
            with self.assertRaisesRegex(media_api.AnalysisError,'MODEL_TIMEOUT_MAY_BE_BILLED'):media_api.request(self.job('transcribe'),'/chat/completions')
            self.assertEqual(session.post.call_count,1)

    def test_usage_journal_survives_failure_and_captures_actual_model_without_content(self):
        import requests
        from dsh_bot_runtime.model_usage import journal
        job = self.job('transcribe'); job['usagePath'] = str(self.root/'usage.json')
        session=Mock();session.__enter__=Mock(return_value=session);session.__exit__=Mock(return_value=False)
        session.post.side_effect=requests.Timeout('fixture')
        with patch.dict(os.environ,{'TEST_PROVIDER_KEY':'fixture-secret'},clear=True),patch('requests.Session',return_value=session):
            with self.assertRaises(media_api.AnalysisError): media_api.request(job,'/chat/completions')
        records=json.loads(Path(job['usagePath']).read_text()); self.assertEqual(len(records),1)
        self.assertTrue(records[0]['attempted']);self.assertNotIn('usage',records[0]);self.assertNotIn('fixture-secret',json.dumps(records))
        journal(job, records[0], {'model':'actual-model','usage':{'prompt_tokens':10,'completion_tokens':5,'completion_tokens_details':{'reasoning_tokens':3,'text':'secret'},'content':'secret'},'text':'private'})
        records=json.loads(Path(job['usagePath']).read_text());self.assertEqual(len(records),1);self.assertEqual(records[0]['model'],'actual-model')
        self.assertEqual(records[0]['usage']['completion_tokens_details'],{'reasoning_tokens':3});self.assertNotIn('private',json.dumps(records));self.assertNotIn('secret',json.dumps(records))

    def test_local_processing_and_validation_failures_do_not_claim_model_calls(self):
        file=self.root/'test.txt';file.write_text('fixture')
        job=self.job('document_read',file);job['usagePath']=str(self.root/'usage.json')
        worker.execute(job);self.assertFalse(Path(job['usagePath']).exists())
        with self.assertRaises(worker.JobError):worker.execute(self.job('image_edit'))
        self.assertFalse((self.root/'model-usage.json').exists())

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg not installed')
    def test_video_payload_contains_actual_mp4_and_checks_reported_media(self):
        from dsh_bot_runtime.video_understanding.backend import BackendConfig,ChatCompletionsGemini,validate_result
        from dsh_bot_runtime.video_understanding.models import Limits,MediaProbe,PreparedMedia,VideoError
        source=self.root/'clip.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=red:s=96x96:d=1','-c:v','libx264',str(source)],check=True,capture_output=True)
        prepared=PreparedMedia(source,MediaProbe(1,True,False,source.stat().st_size),1,0,1)
        backend=ChatCompletionsGemini(BackendConfig('https://example.invalid/v1','test-secret','fixture'),Limits())
        payload=json.loads(backend.payload(prepared,'画面是什么？'))
        data=payload['messages'][0]['content'][1]['image_url']['url'];self.assertTrue(data.startswith('data:video/mp4;base64,'));self.assertEqual(base64.b64decode(data.split(',',1)[1]),source.read_bytes())
        with self.assertRaisesRegex(VideoError,'MEDIA_NOT_RECEIVED'):validate_result('{"received_media":false}',prepared)
        value={'received_media':True,'summary':'red','visual_observations':[{'at_seconds':0,'text':'red'}],'audio_observations':[{'at_seconds':0,'text':'fabricated'}],'spoken_quotes':[],'onscreen_text':[],'inferences':[],'uncertainty':[],'warnings':[]}
        self.assertEqual(validate_result(json.dumps(value),prepared)['audio_observations'],[])

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg not installed')
    def test_real_fixed_ffmpeg_conversion(self):
        source=self.root/'clip.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=red:s=96x96:d=1','-c:v','libx264',str(source)],check=True,capture_output=True)
        job=self.job('convert_gif',source,durationSeconds=0.5);job['inputs'][0]['kind']='video'
        result=worker.execute(job)
        from PIL import Image
        with Image.open(result['assets'][0]['path']) as image: self.assertEqual(image.format,'GIF')
        with self.assertRaisesRegex(worker.JobError,'INVALID_MEDIA_RANGE'):worker.execute(self.job('convert_mp4',source,durationSeconds=999))

    def test_worker_protocol_rejects_arbitrary_operation_and_expired_jobs(self):
        for job,code in [(self.job('run_script'),'UNKNOWN_MEDIA_OPERATION'),(self.job('speak'),'UNKNOWN_MEDIA_OPERATION'),({**self.job('transcribe'),'deadline':0},'JOB_EXPIRED')]:
            result=subprocess.run([sys.executable,str(ROOT/'python/worker.py')],input=json.dumps(job),capture_output=True,text=True)
            self.assertEqual(result.returncode,1);self.assertEqual(json.loads(result.stdout)['error']['code'],code)


if __name__ == '__main__': unittest.main()
