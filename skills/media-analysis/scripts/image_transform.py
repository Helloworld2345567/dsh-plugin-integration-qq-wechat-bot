"""Single-decode image conversion, resizing and bounded-size compression."""
import math
from pathlib import Path
import time

from PIL import Image, ImageOps, UnidentifiedImageError, features

from transform_common import TransformError, number, result_file, source_file

FORMATS = {'jpeg': ('JPEG', 'image/jpeg', 'jpg'), 'png': ('PNG', 'image/png', 'png'),
           'webp': ('WEBP', 'image/webp', 'webp'), 'avif': ('AVIF', 'image/avif', 'avif')}


def encode(image, path, fmt, quality):
    options = {'JPEG': {'quality': quality, 'optimize': False},
               'PNG': {'compress_level': 1, 'optimize': False},
               'WEBP': {'quality': quality, 'method': 0},
               'AVIF': {'quality': quality, 'speed': 10, 'max_threads': 1}}
    image.save(path, fmt, **options[fmt])


def execute(job):
    started = time.perf_counter()
    source = source_file(job, 'image')
    params = job['parameters']
    quality = number(params, 'quality', 80, 1, 100, integer=True)
    width = number(params, 'maxWidth', 16384, 1, 16384, integer=True)
    height = number(params, 'maxHeight', 16384, 1, 16384, integer=True)
    maximum = number(params, 'maxBytes', 20 * 1024**2, 1, 20 * 1024**2, integer=True)
    if job['operation'] == 'image_resize' and not any(k in params for k in ('maxWidth', 'maxHeight')):
        raise TransformError('IMAGE_SIZE_REQUIRED')
    target = Path(job['output']) / 'image-candidate.tmp'
    try:
        with Image.open(source) as opened:
            if getattr(opened, 'is_animated', False):
                raise TransformError('ANIMATED_IMAGE_NOT_SUPPORTED')
            fmt = params.get('format', (opened.format or '').lower())
            if 'format' not in params and fmt not in FORMATS:
                fmt = 'jpeg'
            if fmt not in FORMATS:
                raise TransformError('UNSUPPORTED_IMAGE_FORMAT')
            if fmt in ('webp', 'avif') and not features.check(fmt):
                raise TransformError(f'{fmt.upper()}_CODEC_UNAVAILABLE')
            opened.load()
            corrected = ImageOps.exif_transpose(opened)
            image = corrected.convert('RGBA' if 'A' in corrected.getbands() or 'transparency' in corrected.info else 'RGB')
            corrected.close()
        with image:
            image.thumbnail((width, height), Image.Resampling.BILINEAR, reducing_gap=2.0)
            if fmt == 'jpeg' and image.mode == 'RGBA':
                background = Image.new('RGB', image.size, 'white')
                background.paste(image, mask=image.getchannel('A'))
                image.close()
                image = background
            try:
                for attempt in range(1, 5):
                    if attempt > 1:
                        if attempt == 2 and fmt != 'png':
                            quality = max(1, min(quality - 1, int(quality * .6)))
                        else:
                            ratio = min(.75, math.sqrt(maximum / target.stat().st_size) * .85)
                            image.thumbnail((max(1, int(image.width * ratio)), max(1, int(image.height * ratio))),
                                            Image.Resampling.BILINEAR, reducing_gap=2.0)
                            if fmt != 'png':
                                quality = max(1, int(quality * .65))
                    encode(image, target, FORMATS[fmt][0], quality)
                    if target.stat().st_size <= maximum:
                        output = target.with_name('result.' + FORMATS[fmt][2])
                        target.replace(output)
                        return result_file(output, FORMATS[fmt][1], dict(format=fmt, width=image.width, height=image.height,
                            bytes=output.stat().st_size, quality=None if fmt == 'png' else quality,
                            attempts=attempt, elapsedMs=round((time.perf_counter()-started)*1000)))
                raise TransformError('IMAGE_SIZE_LIMIT_UNREACHABLE')
            finally:
                image.close()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise TransformError('IMAGE_DECODE_OR_ENCODE_FAILED') from None
    finally:
        target.unlink(missing_ok=True)
