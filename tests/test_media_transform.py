import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from PIL import Image, features

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'skills/media-analysis/scripts'))
import image_transform
import video_transform
from transform_common import TransformError


class TransformFixture(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='media-transform-test-', dir=ROOT / '.codex')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def job(self, source, operation='convert_gif', **parameters):
        return dict(operation=operation, inputs=[dict(path=str(source), kind='video' if operation == 'convert_gif' else 'image')],
                    output=str(self.root), parameters=parameters, timeoutMs=0, deadline=0, processingSlots=2)

class TransformTests(TransformFixture):
    def test_image_formats_alpha_orientation_and_no_upscale(self):
        source = self.root / 'image.png'
        image = Image.new('RGBA', (40, 20), (255, 0, 0, 0))
        image.putpixel((10, 10), (255, 0, 0, 255))
        image.save(source)
        for fmt in ['jpeg', 'png', 'webp', 'avif']:
            if fmt in ('webp', 'avif') and not features.check(fmt):
                continue
            with self.subTest(fmt=fmt):
                result = image_transform.execute(self.job(source, 'image_convert', format=fmt, maxWidth=400))
                detail = json.loads(result['text'])
                with Image.open(result['assets'][0]['path']) as actual:
                    self.assertEqual(actual.format, fmt.upper())
                    self.assertEqual(actual.size, (40, 20))
                    if fmt == 'jpeg':
                        self.assertGreater(min(actual.convert('RGB').getpixel((0, 0))), 240)
                    else:
                        self.assertLessEqual(actual.convert('RGBA').getpixel((0, 0))[3], 3 if fmt == 'avif' else 0)
                self.assertEqual(detail['attempts'], 1)
        exif = Image.Exif(); exif[274] = 6
        Image.new('RGB', (40, 20), 'red').save(source, 'JPEG', exif=exif)
        result = image_transform.execute(self.job(source, 'image_resize', maxHeight=20, format='png'))
        with Image.open(result['assets'][0]['path']) as actual:
            self.assertEqual(actual.size, (10, 20))

    def test_image_target_size_and_failure_cleanup(self):
        source = self.root / 'noise.png'
        Image.effect_noise((700, 500), 100).convert('RGB').save(source)
        result = image_transform.execute(self.job(source, 'image_compress', format='jpeg', maxBytes=12000))
        detail = json.loads(result['text'])
        self.assertLessEqual(detail['bytes'], 12000)
        self.assertLessEqual(detail['attempts'], 4)
        self.assertFalse((self.root / 'image-candidate.tmp').exists())
        with self.assertRaisesRegex(TransformError, 'IMAGE_SIZE_LIMIT_UNREACHABLE'):
            image_transform.execute(self.job(source, 'image_compress', maxBytes=1))
        self.assertFalse((self.root / 'image-candidate.tmp').exists())

    def test_image_rejects_animated_corrupt_and_bad_parameters(self):
        source = self.root / 'animated.gif'
        Image.new('RGB', (20, 20), 'red').save(source, save_all=True, append_images=[Image.new('RGB', (20, 20), 'blue')], duration=80)
        with self.assertRaisesRegex(TransformError, 'ANIMATED_IMAGE_NOT_SUPPORTED'):
            image_transform.execute(self.job(source, 'image_convert'))
        for params in [dict(quality=True), dict(maxWidth=0), dict(maxBytes=float('nan'))]:
            with self.subTest(params=params), self.assertRaises(TransformError):
                image_transform.execute(self.job(source, 'image_compress', **params))
        source.write_bytes(b'not an image')
        with self.assertRaisesRegex(TransformError, 'IMAGE_DECODE_OR_ENCODE_FAILED'):
            image_transform.execute(self.job(source, 'image_convert'))

    def test_unavailable_avif_reports_codec(self):
        source = self.root / 'image.png'; Image.new('RGB', (10, 10)).save(source)
        with patch.object(image_transform.features, 'check', return_value=False):
            with self.assertRaisesRegex(TransformError, 'AVIF_CODEC_UNAVAILABLE'):
                image_transform.execute(self.job(source, 'image_convert', format='avif'))

    def test_worker_protocol_routes_transform_and_bounds_host_budget(self):
        source = self.root / 'image.png'; Image.new('RGB', (10, 10)).save(source)
        job = self.job(source, 'image_convert', format='webp')
        job.update(id='test', scope='test', inputs=[dict(path=str(source), name=source.name, mime='image/png', kind='image')])
        completed = subprocess.run([sys.executable, '-B', str(ROOT / 'python/worker.py')], input=json.dumps(job), text=True, capture_output=True)
        self.assertEqual(completed.returncode, 0, completed.stdout)
        self.assertEqual(json.loads(completed.stdout)['result']['assets'][0]['mime'], 'image/webp')
        job['processingSlots'] = 3
        completed = subprocess.run([sys.executable, '-B', str(ROOT / 'python/worker.py')], input=json.dumps(job), text=True, capture_output=True)
        self.assertEqual(json.loads(completed.stdout)['error']['code'], 'MEDIA_WORKER_SLOTS_INVALID')


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
class VideoTransformTests(TransformFixture):
    def clip(self, seconds=3.25, size='96x64', filters=None):
        source = self.root / f'clip-{time.monotonic_ns()}.mp4'
        args = ['ffmpeg', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', f'testsrc2=s={size}:r=24:d={seconds}']
        if filters:
            args += ['-vf', filters, '-fps_mode', 'vfr']
        subprocess.run([*args, '-c:v', 'libx264', '-g', '250', '-threads', '1', str(source)], check=True, capture_output=True)
        return source

    def frames(self, path):
        pixels, duration = [], 0
        with Image.open(path) as image:
            self.assertEqual(image.info.get('loop'), 0)
            for i in range(image.n_frames):
                image.seek(i)
                pixels.append(image.convert('RGB').tobytes())
                duration += image.info.get('duration', 0)
        return pixels, duration

    def test_full_duration_and_long_parallel_nonkeyframe_boundaries(self):
        source = self.clip(32.25)
        job = self.job(source, startSeconds=.375, durationSeconds=31.125)
        parallel = video_transform.execute(job)
        detail = json.loads(parallel['text'])
        parallel_frames, parallel_duration = self.frames(parallel['assets'][0]['path'])
        self.assertEqual(detail['segments'], 3)
        self.assertEqual(detail['parallelism'], 2)
        self.assertLess(detail['bytes'], 10_000_000)
        job['processingSlots'] = 1
        serial = video_transform.execute(job)
        serial_frames, serial_duration = self.frames(serial['assets'][0]['path'])
        self.assertEqual(len(parallel_frames), 374)
        self.assertEqual(parallel_frames, serial_frames)
        self.assertLessEqual(abs(parallel_duration - 31125), 10)
        self.assertEqual(parallel_duration, serial_duration)
        self.assertFalse(list(self.root.glob('gif-parts-*')))
        full = video_transform.execute(self.job(source))
        self.assertEqual(json.loads(full['text'])['durationSeconds'], 32.25)

    def test_vfr_segment_grid_matches_serial_and_keeps_tail(self):
        source = self.clip(5.25, filters="setpts='if(lt(N,48),N/24/TB,(2+(N-48)/12)/TB)'")
        job = self.job(source, startSeconds=.375, durationSeconds=6.125)
        with patch.object(video_transform, 'SPLIT_SECONDS', 3), patch.object(video_transform, 'SEGMENT_SECONDS', 2):
            parallel = video_transform.execute(job)
        frames, duration = self.frames(parallel['assets'][0]['path'])
        job['processingSlots'] = 1
        serial = video_transform.execute(job)
        self.assertEqual((frames, duration), self.frames(serial['assets'][0]['path']))
        self.assertLessEqual(abs(duration - 6125), 10)

    def test_portrait_sar_and_minimum_fps(self):
        source = self.clip(size='64x96', filters='setsar=2/1')
        result = video_transform.execute(self.job(source, maxWidth=100, maxHeight=100, fps=24))
        detail = json.loads(result['text'])
        self.assertEqual((detail['width'], detail['height']), (100, 75))
        self.assertEqual(detail['fps'], 24)
        with self.assertRaisesRegex(TransformError, 'INVALID_TRANSFORM_PARAMETERS'):
            video_transform.execute(self.job(source, fps=11))
        portrait = self.clip(size='64x96')
        result = video_transform.execute(self.job(portrait))
        detail = json.loads(result['text'])
        self.assertEqual((detail['width'], detail['height']), (64, 96))
        rotated = self.root/'rotated.mp4'
        subprocess.run(['ffmpeg','-v','error','-display_rotation:v:0','90','-i',str(portrait),'-c','copy',str(rotated)],check=True,capture_output=True)
        result = video_transform.execute(self.job(rotated))
        detail = json.loads(result['text'])
        self.assertEqual((detail['width'], detail['height']), (96, 64))

    def test_actual_ten_mb_limit_on_detailed_video(self):
        source = self.clip(32.25, size='960x540')
        result = video_transform.execute(self.job(source, fps=24))
        detail = json.loads(result['text'])
        self.assertGreater(detail['attempts'], 1)
        self.assertLess(Path(result['assets'][0]['path']).stat().st_size, 10_000_000)
        self.assertEqual(detail['durationSeconds'], 32.25)
        self.assertGreaterEqual(detail['fps'], 12)
        _, duration = self.frames(result['assets'][0]['path'])
        self.assertEqual(duration, 32250)

    def test_oversize_converges_without_changing_duration(self):
        source = self.clip()
        first = video_transform.execute(self.job(source, fps=24))
        initial = json.loads(first['text'])
        with patch.object(video_transform, 'MAX_BYTES', initial['bytes']//2):
            result = video_transform.execute(self.job(source, fps=24))
        detail = json.loads(result['text'])
        self.assertGreater(detail['attempts'], 1)
        self.assertLess(detail['bytes'], initial['bytes']//2)
        self.assertGreaterEqual(detail['fps'], 12)
        self.assertEqual(detail['durationSeconds'], initial['durationSeconds'])
        with patch.object(video_transform, 'MAX_BYTES', 1):
            with self.assertRaisesRegex(TransformError, 'GIF_SIZE_LIMIT_UNREACHABLE'):
                video_transform.execute(self.job(source))
        self.assertFalse((self.root/'result.gif').exists())
        self.assertFalse(list(self.root.glob('gif-parts-*')))

    def test_failed_segment_does_not_leave_outputs(self):
        source = self.clip()
        with patch.object(video_transform, 'encode_segment', side_effect=TransformError('ENCODING_FAILED')):
            with self.assertRaisesRegex(TransformError, 'ENCODING_FAILED'):
                video_transform.execute(self.job(source))
        self.assertFalse(list(self.root.glob('gif-parts-*')))
        self.assertFalse((self.root/'result.gif').exists())

    def test_merger_rejects_corrupt_parts_and_dimension_mismatch(self):
        source = self.clip()
        first, second = self.root/'a.gif', self.root/'b.gif'
        job = self.job(source)
        video_transform.encode_segment(job, source, first, 0, 0, 12, 12, (96,64), 128)
        video_transform.encode_segment(job, source, second, 0, 12, 12, 12, (48,32), 128)
        with self.assertRaisesRegex(TransformError, 'GIF_SEGMENT_SIZE_MISMATCH'):
            video_transform.merge([first,second], self.root/'merged.gif',24,12,2)
        first.write_bytes(first.read_bytes()[:-4])
        with self.assertRaisesRegex(TransformError, 'INVALID_GIF_SEGMENT'):
            with video_transform.gif_blocks(first) as (_, _, frames):
                list(frames)


if __name__ == '__main__':
    unittest.main()
