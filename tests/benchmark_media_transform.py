"""Local, synthetic serial/parallel comparison; fixtures are removed on exit."""
from concurrent.futures import ThreadPoolExecutor
import argparse
import json
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import time

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'skills/media-analysis/scripts'))
import image_transform
import video_transform


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repeats', type=int, default=3)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='transform-benchmark-', dir=ROOT/'.codex') as folder:
        root = Path(folder)
        source = root/'source.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=s=960x540:r=24:d=32.25',
                        '-c:v','libx264','-g','250','-threads','1',str(source)],check=True,capture_output=True)
        image = root/'source.png'
        Image.effect_noise((2048,1536),80).convert('RGB').save(image)
        sequence = 0

        def job(kind, slots):
            nonlocal sequence
            sequence += 1
            output = root/str(sequence); output.mkdir()
            return dict(operation='convert_gif' if kind=='video' else 'image_compress',
                        inputs=[dict(path=str(source if kind=='video' else image),kind=kind)],
                        parameters={} if kind=='video' else dict(format='webp',maxWidth=1280),
                        output=str(output), timeoutMs=0, deadline=0, processingSlots=slots)

        timings = {key:[] for key in ['gifWhole','gifSegments','twoVideosSerial','twoVideosParallel','eightImagesSerial','eightImagesParallel']}
        details = {}
        def measure(key, fn):
            started=time.perf_counter(); result=fn();timings[key].append(round((time.perf_counter()-started)*1000));return result
        for _ in range(args.repeats):
            for key,slots in [('gifWhole',1),('gifSegments',2)]:
                request=job('video',slots)
                result=measure(key,lambda:video_transform.execute(request))
                details[key]=json.loads(result['text'])
            requests=[job('video',1) for _ in range(2)]
            measure('twoVideosSerial',lambda:[video_transform.execute(request) for request in requests])
            requests=[job('video',2) for _ in range(2)]
            with ThreadPoolExecutor(max_workers=2) as pool:
                measure('twoVideosParallel',lambda:list(pool.map(video_transform.execute,requests)))
            requests=[job('image',1) for _ in range(8)]
            measure('eightImagesSerial',lambda:[image_transform.execute(request) for request in requests])
            requests=[job('image',1) for _ in range(8)]
            with ThreadPoolExecutor(max_workers=4) as pool:
                measure('eightImagesParallel',lambda:list(pool.map(image_transform.execute,requests)))
        print(json.dumps(dict(source=dict(video='testsrc2, 32.25s, 960x540, 24fps, H.264', image='2048x1536 noise to WebP, width 1280'),
                              repeats=args.repeats, timingsMs=timings, medianMs={key:statistics.median(value) for key,value in timings.items()},details=details),indent=2))


if __name__=='__main__':
    main()
