"""Parallel GIF encoding with sampled estimates and measured size convergence."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import json
import math
from pathlib import Path
import struct
import tempfile
import time

from dsh_bot_runtime.skills.media_analysis.transform_common import TransformError, number, result_file, run, source_file

MAX_BYTES = 10_000_000
MAX_OUTPUT_BYTES = 50 * 1024 * 1024
TARGET_RATIO = .98
ACCEPT_RATIO = .95
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
                    if (gce is None or not (packed & 128 or header[10] & 128) or
                            first and (left, top, w, h) != (0, 0, width, height)):
                        raise TransformError('INVALID_GIF_SEGMENT')
                    pixels = marker + descriptor
                    if packed & 128:
                        pixels += read(3 * 2**((packed & 7) + 1))
                    pixels += read(1) + subblocks()  # LZW code size and compressed blocks.
                    yield gce, pixels
                    first, gce = False, None
                else:
                    raise TransformError('INVALID_GIF_SEGMENT')
        yield header, (width, height), frames()


def merge(parts, target, expected_frames, fps, duration):
    count = 0
    canvas = None
    shared_header = None
    with target.open('wb') as output:
        for path in parts:
            with gif_blocks(path) as (header, size, frames):
                if canvas is None:
                    canvas = size
                    shared_header = header
                    output.write(b'GIF89a' + header[6:])
                    output.write(LOOP)
                elif size != canvas:
                    raise TransformError('GIF_SEGMENT_SIZE_MISMATCH')
                elif header != shared_header:
                    raise TransformError('INVALID_GIF_SEGMENT')
                for index, (gce, pixels) in enumerate(frames):
                    if index == 0:
                        # Each RGB segment starts with an opaque full canvas; a reserved
                        # transparent palette entry alone does not make that frame transparent.
                        gce[3] &= ~1
                    struct.pack_into('<H', gce, 4, frame_delay(count, expected_frames, fps, duration))
                    output.write(gce)
                    output.write(pixels)
                    count += 1
        output.write(b'\x3b')
    if count != expected_frames:
        raise TransformError('GIF_FRAME_COUNT_MISMATCH')


def frame_filter(start, first, count, fps, size):
    # One second of pre-roll aligns non-keyframe/VFR sampling across segments.
    absolute = start + first / fps
    seek = max(0, absolute - 1)
    offset = seek - absolute
    width, height = size
    filters = (f'setpts=PTS+({offset:.12f})/TB,tpad=stop_mode=clone:stop_duration=1,'
               f'fps={fps}:start_time=0:round=near,trim=end_frame={count},setpts=PTS-STARTPTS,'
               f'scale={width}:{height}:flags=lanczos,setsar=1,format=rgb24')
    return seek, count / fps - offset + 1, filters


def make_palette(job, source, path, start, total, fps, size, colors):
    # A histogram pass covers the whole selection without retaining decoded frames.
    seek, length, filters = frame_filter(start, 0, total, fps, size)
    run(job, ['ffmpeg', '-v', 'error', '-nostdin', '-y', '-threads', '1', '-ss', f'{seek:.12f}',
              '-t', f'{length:.12f}', '-i', str(source), '-an', '-sn', '-dn', '-filter_threads', '1',
              '-vf', filters + f',palettegen=max_colors={colors}:stats_mode=diff:reserve_transparent=1',
              '-frames:v', '1', '-threads', '1', str(path)])


def encode_segment(job, source, path, start, first, count, fps, size, palette):
    seek, length, filters = frame_filter(start, first, count, fps, size)
    run(job, ['ffmpeg', '-v', 'error', '-nostdin', '-y', '-threads', '1', '-ss', f'{seek:.12f}',
              '-t', f'{length:.12f}', '-i', str(source), '-i', str(palette), '-an', '-sn', '-dn',
              '-filter_complex_threads', '1', '-filter_threads', '1', '-filter_complex',
              f'[0:v]{filters}[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
              '-frames:v', str(count), '-threads', '1', '-gifflags', '+offsetting+transdiff',
              '-global_palette', '1', '-loop', '-1', str(path)])


def next_edge(measurements, minimum, maximum, budget):
    """Interpolate measured sizes, keeping the next trial inside untested bounds."""
    fitting = [(edge, size) for edge, size in measurements if size < budget]
    low = max(fitting, default=(minimum - 1, 0))
    high = min(((edge, size) for edge, size in measurements
                if size >= budget and edge > low[0]), default=(maximum + 1, 0))
    left, right = max(minimum, low[0] + 1), min(maximum, high[0] - 1)
    if left > right:
        return None
    edge, size = measurements[-1]
    exponent = 2.0
    if low[1] and high[1]:
        exponent = max(.5, min(4.0, math.log(high[1] / low[1]) / math.log(high[0] / low[0])))
    estimate = round(edge * (budget * TARGET_RATIO / max(1, size)) ** (1 / exponent))
    return max(left, min(right, estimate))


def encode_parts(pool, job, source, root, ranges, start, fps, size, palette):
    paths = [root / f'{index}.gif' for index in range(len(ranges))]
    futures = [pool.submit(encode_segment, job, source, path, start, first, count, fps, size, palette)
               for path, (first, count) in zip(paths, ranges)]
    try:
        for future in futures:
            future.result()
    except BaseException:
        for future in futures:
            future.cancel()
        raise
    return paths


def estimate_edge(pool, job, source, root, start, total, fps, canvas, minimum, budget, palette):
    """Sample the beginning, middle and tail; full encodes remain authoritative."""
    maximum = max(canvas)
    count = min(total, 2 * fps)
    firsts = sorted({round(index * (total - count) / 4) for index in range(5)})
    ranges = [(first, count) for first in firsts]
    edge, measurements = maximum, []
    for _ in range(6):
        paths = encode_parts(pool, job, source, root, ranges, start, fps,
                             dimensions(*canvas, edge, edge), palette)
        estimated = sum(path.stat().st_size for path in paths) * total / (count * len(paths))
        for path in paths:
            path.unlink()
        measurements.append((edge, estimated))
        if estimated < budget and (estimated >= budget * ACCEPT_RATIO or edge == maximum):
            break
        candidate = next_edge(measurements, minimum, maximum, budget)
        if candidate is None:
            break
        edge = candidate
    fitting = [edge for edge, size in measurements if size < budget]
    return max(fitting, default=edge), len(measurements)


def execute(job):
    began = time.perf_counter()
    source = source_file(job, 'video')
    params = job['parameters']
    budget = number(params, 'maxBytes', MAX_BYTES, 1, MAX_OUTPUT_BYTES, integer=True)
    width, height, video_duration = probe(job, source)
    start = number(params, 'startSeconds', 0, 0, video_duration)
    duration = number(params, 'durationSeconds', video_duration-start, .01, video_duration-start)
    fps = number(params, 'fps', 12, 12, 50, integer=True)
    default_edge = 16384 if 'maxWidth' in params or 'maxHeight' in params else 480
    max_width = number(params, 'maxWidth', default_edge, 1, 16384, integer=True)
    max_height = number(params, 'maxHeight', default_edge, 1, 16384, integer=True)
    canvas = dimensions(width, height, max_width, max_height)
    maximum, minimum = max(canvas), min(64, max(canvas))
    slots = number(job, 'processingSlots', 1, 1, 2, integer=True)
    total = max(1, math.ceil(duration * fps - 1e-7))
    step = SEGMENT_SECONDS * fps if duration >= SPLIT_SECONDS and slots > 1 else total
    ranges = [(first, min(step, total-first)) for first in range(0, total, step)]
    output = Path(job['output']) / 'result.gif'
    success = False
    best = None
    samples = 0
    try:
        with tempfile.TemporaryDirectory(prefix='gif-parts-', dir=job['output']) as temporary:
            root = Path(temporary)
            candidate_path = root / 'candidate.gif'
            palette = root / 'palette.png'
            colors = 32
            make_palette(job, source, palette, start, total, fps, canvas, colors)
            with ThreadPoolExecutor(max_workers=slots) as pool:
                edge = maximum
                if duration >= SPLIT_SECONDS:
                    edge, samples = estimate_edge(pool, job, source, root, start, total, fps,
                                                  canvas, minimum, budget, palette)
                measurements = []
                for attempt in range(1, 11):
                    size = dimensions(*canvas, edge, edge)
                    paths = encode_parts(pool, job, source, root, ranges, start, fps, size, palette)
                    merge_started = time.perf_counter()
                    merge(paths, candidate_path, total, fps, duration)
                    merge_ms = round((time.perf_counter()-merge_started)*1000)
                    byte_count = candidate_path.stat().st_size
                    for path in paths:
                        path.unlink()
                    measurements.append((edge, byte_count))
                    if byte_count < budget:
                        if best is None or edge > best['edge']:
                            candidate_path.replace(output)
                            best = dict(edge=edge, width=size[0], height=size[1], colors=colors,
                                        bytes=byte_count, mergeMs=merge_ms)
                        if byte_count >= budget * ACCEPT_RATIO or edge == maximum:
                            break
                    following = next_edge(measurements, minimum, maximum, budget)
                    if following is None:
                        if best is not None or colors == 16:
                            break
                        # Only reduce colors after the smallest canvas is actually too large.
                        colors //= 2
                        make_palette(job, source, palette, start, total, fps, canvas, colors)
                        measurements = []
                        following = minimum
                    edge = following
            if best is None:
                raise TransformError('GIF_SIZE_LIMIT_UNREACHABLE')
            # One final decode of the chosen file; trial files need no repeated validation.
            run(job, ['ffmpeg', '-v', 'error', '-xerror', '-nostdin', '-threads', '1', '-i', str(output),
                      '-threads', '1', '-f', 'null', '-'])
            success = True
            best.pop('edge')
            return result_file(output, 'image/gif', dict(format='gif', **best,
                fps=fps, frames=total, targetBytes=budget, budgetUtilization=best['bytes']/budget,
                startSeconds=start, endSeconds=start+duration, durationSeconds=duration,
                attempts=attempt, sampleAttempts=samples, segments=len(ranges),
                parallelism=min(slots, len(ranges)), elapsedMs=round((time.perf_counter()-began)*1000)))
    finally:
        if not success:
            output.unlink(missing_ok=True)
