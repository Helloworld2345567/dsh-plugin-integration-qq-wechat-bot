import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[1]
from dsh_bot_runtime import audio_output
from dsh_bot_runtime.skills.music_download import entry as music_delivery


class AudioOutputTests(unittest.TestCase):
    def setUp(self):
        (ROOT / ".codex").mkdir(exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(prefix="audio-output-", dir=ROOT / ".codex")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "原曲.wav"
        with wave.open(str(self.source), "wb") as output:
            output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            output.writeframes(b"".join(struct.pack("<h", 4000 if i % 64 < 32 else -4000) for i in range(48000)))

    def probe(self, file):
        result = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(file)], capture_output=True, check=True)
        return json.loads(result.stdout)["streams"][0]

    def test_encodes_once_below_budget_without_cutting_full_audio(self):
        target = self.root / "delivery.mp3"
        with patch.object(audio_output, "MAX_DELIVERY_BYTES", 80_000), patch.object(audio_output.subprocess, "run", wraps=subprocess.run) as run:
            audio_output.encode_delivery_mp3(self.source, target)
        encodes = [call.args[0] for call in run.call_args_list if "libmp3lame" in call.args[0]]
        self.assertEqual(len(encodes), 1)
        self.assertNotIn("-t", encodes[0])
        self.assertNotIn("-fs", encodes[0])
        self.assertEqual(encodes[0][encodes[0].index("-b:a") + 1], "160k")
        self.assertLess(target.stat().st_size, 80_000)
        self.assertAlmostEqual(float(self.probe(target)["duration"]), 3, delta=0.1)

    def test_existing_small_mp3_preserves_original_bytes_without_encoding(self):
        original = self.root / "original.mp3"
        audio_output.encode_delivery_mp3(self.source, original)
        target = self.root / "copy.mp3"
        with patch.object(audio_output.subprocess, "run", wraps=subprocess.run) as run:
            audio_output.encode_delivery_mp3(original, target)
        self.assertEqual(target.read_bytes(), original.read_bytes())
        self.assertFalse(any("libmp3lame" in call.args[0] for call in run.call_args_list))

    def test_impossible_size_fails_without_partial_output(self):
        target = self.root / "too-large.mp3"
        with patch.object(audio_output, "MAX_DELIVERY_BYTES", 20_000):
            with self.assertRaisesRegex(audio_output.AudioOutputError, "AUDIO_OUTPUT_TOO_LARGE"):
                audio_output.encode_delivery_mp3(self.source, target)
        self.assertFalse(target.exists())
        self.assertTrue(self.source.exists())

    def test_mp3_stream_in_another_container_is_not_copied_as_mp3(self):
        source = self.root / "audio.mka"
        subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(self.source),
                        "-c:a", "libmp3lame", str(source)], capture_output=True, check=True)
        target = self.root / "delivery.mp3"
        audio_output.encode_delivery_mp3(source, target)
        self.assertNotEqual(target.read_bytes(), source.read_bytes())
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=format_name", "-of", "json", str(target)], capture_output=True, check=True)
        self.assertEqual(json.loads(probe.stdout)["format"]["format_name"], "mp3")

    def test_truncated_audio_and_html_are_rejected(self):
        original = self.root / "original.mp3"
        audio_output.encode_delivery_mp3(self.source, original)
        broken = self.root / "broken.mp3"
        for value in (original.read_bytes()[:original.stat().st_size // 2], b"<html>provider error</html>"):
            broken.write_bytes(value)
            target = self.root / "invalid.mp3"
            with self.subTest(size=len(value)), self.assertRaisesRegex(audio_output.AudioOutputError, "AUDIO_OUTPUT_INVALID"):
                audio_output.encode_delivery_mp3(broken, target)
            self.assertFalse(target.exists())

    def test_music_delivery_accepts_host_audio_and_keeps_readable_filename(self):
        result = music_delivery.execute({"operation": "music_delivery", "timeoutMs": 0, "output": str(self.root / "job"),
                                         "inputs": [{"path": str(self.source), "name": "歌手 - 原曲.wav", "kind": "audio"}]})
        asset = result["assets"][0]
        self.assertEqual(asset["name"], "歌手 - 原曲.mp3")
        self.assertEqual(asset["mime"], "audio/mpeg")
        self.assertLess(Path(asset["path"]).stat().st_size, 20_000_000)
        self.assertAlmostEqual(float(self.probe(asset["path"])["duration"]), 3, delta=0.1)

    def test_music_delivery_rejects_non_audio_and_expired_jobs(self):
        job = {"operation": "music_delivery", "timeoutMs": 0, "output": str(self.root / "job"),
               "inputs": [{"path": str(self.source), "name": self.source.name, "kind": "file"}]}
        with self.assertRaisesRegex(music_delivery.MusicError, "MUSIC_AUDIO_REQUIRED"):
            music_delivery.execute(job)
        job["inputs"][0]["kind"] = "audio"
        job.update(timeoutMs=1000, deadline=1)
        with self.assertRaisesRegex(music_delivery.MusicError, "MUSIC_TIMEOUT"):
            music_delivery.execute(job)

    def test_music_delivery_runs_through_versioned_process_worker(self):
        directory = self.root / "process-job"
        job = {"protocol": "dsh.media-worker", "protocolVersion": 1, "id": "music-delivery-test", "scope": "scope",
               "operation": "music_delivery", "handler": "skill", "timeoutMs": 0, "deadline": 0, "quotaUnits": 50,
               "parameters": {}, "output": str(directory), "usagePath": str(directory / "model-usage.json"),
               "inputs": [{"path": str(self.source), "name": self.source.name, "mime": "audio/wav", "kind": "audio"}]}
        process = subprocess.run([sys.executable, "-X", "utf8", "-B", str(ROOT / "python/worker.py")], input=json.dumps(job).encode(),
                                 capture_output=True, timeout=30, check=False)
        self.assertEqual(process.returncode, 0, process.stdout.decode())
        response = json.loads(process.stdout)
        self.assertEqual(response["protocolVersion"], 1)
        self.assertEqual(response["result"]["coverage"], "MUSIC_DELIVERY_AUDIO")
        self.assertTrue(Path(response["result"]["assets"][0]["path"]).is_relative_to(directory))


if __name__ == "__main__":
    unittest.main()
