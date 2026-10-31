import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("bot_voice_api", ROOT / "skills/voice-generation/scripts/voice_api.py")
voice_api = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(voice_api)


class VoiceApiTests(unittest.TestCase):
    def job(self, operation="voice_speak", **params):
        root = Path(self.directory.name)
        return {
            "id": "voice-test",
            "scope": "scope",
            "operation": operation,
            "inputs": [],
            "parameters": params,
            "output": str(root),
            "usagePath": str(root / "usage.json"),
            "endpoint": {"protocol": "edge_tts", "voice": "zh-CN-XiaoxiaoNeural"},
            "timeoutMs": 30000,
            "deadline": 4102444800000,
        }

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=ROOT / ".codex")
        self.addCleanup(self.directory.cleanup)

    def test_speak_uses_configured_edge_voice_and_registers_mp3(self):
        job = self.job(mode="speak", text="你好", speed=1.25, format="mp3")
        captured = {}

        async def fake_save(text, voice, target, rate):
            captured.update(text=text, voice=voice, rate=rate)
            Path(target).write_bytes(b"ID3" + b"fixture-audio")

        with patch.object(voice_api, "_edge_tts_save", side_effect=fake_save):
            result = voice_api.execute(job)
        self.assertEqual(captured, {"text": "你好", "voice": "zh-CN-XiaoxiaoNeural", "rate": "+25%"})
        asset = result["assets"][0]
        self.assertEqual(asset["mime"], "audio/mpeg")
        self.assertEqual(Path(asset["path"]).read_bytes(), b"ID3fixture-audio")

    def test_chant_and_style_are_explicitly_degraded(self):
        job = self.job("voice_chant", mode="chant", text="小星星", style="轻快", format="mp3")

        async def fake_save(text, voice, target, rate):
            Path(target).write_bytes(b"ID3" + b"fixture-audio")

        with patch.object(voice_api, "_edge_tts_save", side_effect=fake_save):
            result = voice_api.execute(job)
        self.assertEqual(result["assets"][0]["kind"], "audio")
        self.assertEqual(result["coverage"], "VOICE_SYNTHESIS_DEGRADED")
        self.assertIn("降级", result["text"])

    def test_invalid_parameters_fail_closed(self):
        with self.assertRaisesRegex(voice_api.VoiceError, "VOICE_SPEED_INVALID"):
            voice_api.execute(self.job(mode="speak", text="hello", speed=9, format="mp3"))
        with self.assertRaisesRegex(voice_api.VoiceError, "VOICE_INPUTS_NOT_ALLOWED"):
            bad = self.job(mode="speak", text="hello", format="mp3")
            bad["inputs"] = [{"path": "x"}]
            voice_api.execute(bad)
        with self.assertRaisesRegex(voice_api.VoiceError, "EDGE_TTS_FORMAT_UNSUPPORTED"):
            voice_api.execute(self.job(mode="speak", text="hello", format="wav"))

    def test_non_audio_edge_output_is_rejected(self):
        async def fake_save(text, voice, target, rate):
            Path(target).write_bytes(b"{}")

        with patch.object(voice_api, "_edge_tts_save", side_effect=fake_save):
            with self.assertRaisesRegex(voice_api.VoiceError, "VOICE_OUTPUT_FORMAT_INVALID"):
                voice_api.execute(self.job(mode="speak", text="hello", format="mp3"))

    def test_operation_cannot_be_used_to_change_voice_mode(self):
        job = self.job("voice_speak", mode="chant", text="hello", format="mp3")
        with self.assertRaisesRegex(voice_api.VoiceError, "VOICE_MODE_OPERATION_MISMATCH"):
            voice_api.execute(job)


if __name__ == "__main__":
    unittest.main()
