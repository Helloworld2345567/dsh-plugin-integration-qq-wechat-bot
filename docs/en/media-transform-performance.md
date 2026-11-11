# Historical Local Media-transform Benchmark (Dated, Non-contract)

[简体中文](../media-transform-performance.md) | English

> **Not a product contract.** This is a sanitized local synthetic-media benchmark for reproducibility reference, not an SLO, throughput/latency guarantee or platform acceptance. Do not promise these figures on other CPUs, codecs, inputs or loads.

Rerun synthetic tests with `python -B tests/benchmark_media_transform.py --repeats 3`. Temporary inputs/outputs are removed at exit. Timing includes probing, encoding, merging and full decode validation of successful GIFs, excluding models, networking, delivery and host Python startup. Machine identifiers, usernames and runtime paths are omitted.

The original sampling date was not retained, so this is historical evidence only. Sanitized environment: Windows, Python 3.13.12, Pillow 12.2.0, FFmpeg 8.1.2. Three-run medians in milliseconds, not a current-version guarantee:

| Scenario | Serial | Concurrent | Speedup |
| --- | ---: | ---: | ---: |
| One video: full encode / two-way segmentation | 3645 | 2299 | 1.59× |
| Two videos: serial full encode / two jobs each split two ways | 7252 | 2415 | 3.00× |
| Eight images: serial / four workers | 762 | 210 | 3.63× |

Video: 32.25-second 960×540, 24 fps H.264 testsrc2. Output: 480×270, 12 fps, 128 colors, 387 frames; full/segmented results both 6,468,839 bytes and one encoding pass. Segments were 15 + 15 + 2.25 seconds. The latest streaming merge took 21 ms, retaining one compressed frame. Images were 2048×1536 noise, converted to WebP with maximum width 1280 and quality 80.

Separate correctness regressions compared full/segmented output frame-by-frame at non-keyframe starts and for variable-frame-rate input: identical pixels, correct boundaries/tail duration, size convergence and failure after four rounds. Runtime concurrency tests cover global budgets, same-session parallelism, FIFO, revocation, cancellation and slot release on errors.

## Limitations

These figures reflect local synthetic input only. Other CPUs/codecs/resolutions/load may differ. Scenarios used 2, 4 and 4 slots, so speedups cannot be compared directly across rows. Very long/detailed inputs may need multiple quality reductions or fail to meet complete duration, minimum 12 fps and 10 MB together. Troubleshooting/acceptance uses current actual results, resource limits and platform receipts.
