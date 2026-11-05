"""Local transform contract shared by the image and video workers."""
import json
import math
from pathlib import Path
import subprocess
import time


class TransformError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def number(params, key, default, minimum, maximum, *, integer=False):
    value = params.get(key, default)
    if (type(value) not in (int, float) or not math.isfinite(value)
            or not minimum <= value <= maximum or integer and int(value) != value):
        raise TransformError('INVALID_TRANSFORM_PARAMETERS')
    return int(value) if integer else value


def source_file(job, kind):
    inputs = job.get('inputs')
    if not isinstance(inputs, list) or len(inputs) != 1:
        raise TransformError('ONE_MEDIA_INPUT_REQUIRED')
    if inputs[0].get('kind') != kind:
        raise TransformError('MEDIA_INPUT_KIND_INVALID')
    if job['parameters'].get('url') is not None:
        raise TransformError('TRANSFORM_ATTACHMENT_REQUIRED')
    return Path(inputs[0]['path'])


def timeout(job):
    if job.get('timeoutMs') == 0:
        return None
    seconds = (job.get('deadline', 0) - time.time() * 1000) / 1000
    if seconds <= 0:
        raise TransformError('JOB_EXPIRED')
    return seconds


def run(job, command):
    try:
        result = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True,
                                timeout=timeout(job), check=False)
    except FileNotFoundError:
        raise TransformError('FFMPEG_OR_FFPROBE_REQUIRED') from None
    except subprocess.TimeoutExpired:
        raise TransformError('JOB_EXPIRED') from None
    if result.returncode:
        raise TransformError('MEDIA_DECODE_OR_ENCODE_FAILED')
    return result.stdout


def result_file(path, mime, details):
    return {'assets': [{'path': str(path), 'name': path.name, 'mime': mime, 'kind': 'image'}],
            'text': json.dumps(details, ensure_ascii=False), 'coverage': 'LOCAL_MEDIA_TRANSFORM', 'incomplete': False}
