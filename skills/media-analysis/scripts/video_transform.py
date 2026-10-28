"""Budgeted segment encoding and GIF block concatenation without re-encoding."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import math
from pathlib import Path
import struct
import tempfile
import time

from transform_common import TransformError, number, result_file, run, source_file

MAX_BYTES = 10_000_000
SPLIT_SECONDS = 30
SEGMENT_SECONDS = 15
LOOP = b'\x21\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00'


def probe(job, source):
    raw = run(job, ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                    'stream=width,height,duration,sample_aspect_ratio:stream_side_data=rotation:format=duration', '-of', 'json', str(source)])
    try:
        value = json.loads(raw)
        stream = value['streams'][0]
        duration = float(stream.get('duration') or value['format']['duration'])
        width, height = int(stream['width']), int(stream['height'])
        sar = stream.get('sample_aspect_ratio', '1:1').split(':')
        if len(sar) == 2 and float(sar[1]) > 0:
            width = round(width * float(sar[0]) / float(sar[1]))
        if any(abs(float(s.get('rotation', 0))) % 180 == 90 for s in stream.get('side_data_list', [])):
            width, height = height, width
        if not math.isfinite(duration) or duration <= 0 or min(width, height) < 1:
            raise ValueError()
        return width, height, duration
    except (ValueError, KeyError, IndexError, TypeError, OverflowError):
        raise TransformError('INVALID_VIDEO_METADATA') from None


def dimensions(width, height, max_width, max_height):
    ratio = min(1, max_width / width, max_height / height)
    return max(1, round(width * ratio)), max(1, round(height * ratio))


def frame_delay(index, total, fps, duration):
    begin = round(index * 100 / fps)
    end = round((index + 1) * 100 / fps) if index + 1 < total else round(duration * 100)
    return max(1, end - begin)


@contextmanager
def gif_blocks(path):
    """Stream only worker-generated GIFs; retain at most one compressed frame."""
    with path.open('rb') as source:
        def read(size):
            value = source.read(size)
            if len(value) != size:
                raise TransformError('INVALID_GIF_SEGMENT')
            return value

        def subblocks():
            blocks = bytearray()
            while True:
                size = read(1)
                blocks.extend(size)
                if size == b'\x00':
                    return bytes(blocks)
                blocks.extend(read(size[0]))

        header = read(13)
        if header[:6] not in (b'GIF87a', b'GIF89a'):
            raise TransformError('INVALID_GIF_SEGMENT')
        width, height = struct.unpack_from('<HH', header, 6)
        if header[10] & 128:
            header += read(3 * 2**((header[10] & 7) + 1))

        def frames():
            gce = None
            first = True
            while True:
                marker = read(1)
                if marker == b'\x3b':
                    if first or source.read(1):
                        raise TransformError('INVALID_GIF_SEGMENT')
                    return
                if marker == b'\x21':
                    label = read(1)
                    extension = subblocks()
                    if label == b'\xf9':
                        if len(extension) != 6 or extension[0] != 4:
                            raise TransformError('INVALID_GIF_SEGMENT')
                        gce = bytearray(marker + label + extension)
                elif marker == b'\x2c':
                    descriptor = read(9)
                    left, top, w, h, packed = struct.unpack('<HHHHB', descriptor)
                    if (gce is None or not packed & 128 or
                            first and ((left, top, w, h) != (0, 0, width, height) or gce[3] & 1)):
                        raise TransformError('INVALID_GIF_SEGMENT')
                    pixels = marker + descriptor + read(3 * 2**((packed & 7) + 1))
                    pixels += read(1) + subblocks()  # LZW code size and compressed blocks.
                    yield gce, pixels
                    first, gce = False, None
                else:
                    raise TransformError('INVALID_GIF_SEGMENT')
        yield header, (width, height), frames()


def merge(parts, target, expected_frames, fps, duration):
    count = 0
    canvas = None
    with target.open('wb') as output:
        for path in parts:
            with gif_blocks(path) as (header, size, frames):
                if canvas is None:
                    canvas = size
                    output.write(b'GIF89a' + header[6:])
                    output.write(LOOP)
                elif size != canvas:
                    raise TransformError('GIF_SEGMENT_SIZE_MISMATCH')
                for gce, pixels in frames:
                    struct.pack_into('<H', gce, 4, frame_delay(count, expected_frames, fps, duration))
                    output.write(gce)
                    output.write(pixels)
                    count += 1
        output.write(b'\x3b')
    if count != expected_frames:
        raise TransformError('GIF_FRAME_COUNT_MISMATCH')


def encode_segment(job, source, path, start, first, count, fps, size, colors):
    # One second of pre-roll keeps fps sampling aligned across non-keyframe/VFR boundaries.
    absolute = start + first / fps
    seek = max(0, absolute - 1)
    offset = seek - absolute
    width, height = size
    filters = (f'setpts=PTS+({offset:.12f})/TB,tpad=stop_mode=clone:stop_duration=1,'
               f'fps={fps}:start_time=0:round=near,trim=end_frame={count},setpts=PTS-STARTPTS,'
               f'scale={width}:{height}:flags=bilinear,setsar=1,format=rgb24,split[a][b];'
               f'[a]palettegen=max_colors={colors}:stats_mode=single:reserve_transparent=0[p];'
               '[b][p]paletteuse=new=1:dither=bayer:bayer_scale=4')
    run(job, ['ffmpeg', '-v', 'error', '-nostdin', '-y', '-threads', '1', '-ss', f'{seek:.12f}',
              '-t', f'{count/fps-offset+1:.12f}', '-i', str(source), '-an', '-sn', '-dn',
              '-filter_complex_threads', '1', '-filter_threads', '1', '-vf', filters,
              '-frames:v', str(count), '-threads', '1', '-global_palette', '0', '-loop', '-1', str(path)])


def execute(job):
    began = time.perf_counter()
    source = source_file(job, 'video')
    params = job['parameters']
    if 'maxBytes' in params:
        raise TransformError('GIF_SIZE_LIMIT_FIXED')
    width, height, video_duration = probe(job, source)
    start = number(params, 'startSeconds', 0, 0, video_duration)
    duration = number(params, 'durationSeconds', video_duration-start, .01, video_duration-start)
    fps = number(params, 'fps', 12, 12, 50, integer=True)
    default_edge = 16384 if 'maxWidth' in params or 'maxHeight' in params else 480
    max_width = number(params, 'maxWidth', default_edge, 1, 16384, integer=True)
    max_height = number(params, 'maxHeight', default_edge, 1, 16384, integer=True)
    size = dimensions(width, height, max_width, max_height)
    minimum = dimensions(*size, 64, 64)
    colors = 128
    slots = number(job, 'processingSlots', 1, 1, 2, integer=True)
    output = Path(job['output']) / 'result.gif'
    success = False
    try:
        with tempfile.TemporaryDirectory(prefix='gif-parts-', dir=job['output']) as temporary:
            root = Path(temporary)
            for attempt in range(1, 5):
                total = max(1, math.ceil(duration * fps - 1e-7))
                step = SEGMENT_SECONDS * fps if duration >= SPLIT_SECONDS and slots > 1 else total
                segments = [(first, min(step, total-first)) for first in range(0, total, step)]
                parts = [root / f'{i}.gif' for i in range(len(segments))]
                with ThreadPoolExecutor(max_workers=min(slots, len(parts))) as pool:
                    futures = [pool.submit(encode_segment, job, source, path, start, first, count, fps, size, colors)
                               for path, (first, count) in zip(parts, segments)]
                    try:
                        for future in futures:
                            future.result()
                    except BaseException:
                        for future in futures:
                            future.cancel()
                        raise
                merge_started = time.perf_counter()
                merge(parts, output, total, fps, duration)
                merge_ms = round((time.perf_counter()-merge_started)*1000)
                byte_count = output.stat().st_size
                for path in parts:
                    path.unlink()
                if byte_count < MAX_BYTES:
                    # Validate every compressed frame, not just the header and first image.
                    run(job, ['ffmpeg', '-v', 'error', '-xerror', '-nostdin', '-threads', '1', '-i', str(output),
                              '-threads', '1', '-f', 'null', '-'])
                    success = True
                    return result_file(output, 'image/gif', dict(format='gif', width=size[0], height=size[1],
                        fps=fps, colors=colors, frames=total, bytes=byte_count, startSeconds=start,
                        endSeconds=start+duration, durationSeconds=duration, attempts=attempt,
                        segments=len(parts), parallelism=min(slots, len(parts)), mergeMs=merge_ms,
                        elapsedMs=round((time.perf_counter()-began)*1000)))
                if attempt == 3:
                    size, fps, colors = minimum, 12, 16
                else:
                    ratio = min(.8, math.sqrt(MAX_BYTES / byte_count) * .85)
                    size = (max(minimum[0], round(size[0]*ratio)), max(minimum[1], round(size[1]*ratio)))
                    colors = max(16, colors//2)
                    fps = max(12, round(fps*.8))
            raise TransformError('GIF_SIZE_LIMIT_UNREACHABLE')
    finally:
        if not success:
            output.unlink(missing_ok=True)
