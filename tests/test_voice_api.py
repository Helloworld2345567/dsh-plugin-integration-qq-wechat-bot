import importlib.util
import json
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
            "endpoint": {
                "baseUrl": "https://example.invalid/v1",
                "model": "tts-fixture",
                "keyEnv": "VOICE_TEST_KEY",
                "protocol": "speech",
            },
            "timeoutMs": 30000,
            "deadline": 4102444800000,
        }

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=ROOT / ".codex")
        self.addCleanup(self.directory.cleanup)

    def test_speak_builds_openai_speech_payload_and_registers_mp3(self):
        job = self.job(mode="speak", text="你好", voice="alloy", speed=1.25, format="mp3")
        captured = {}

        def fake_request(current, body):
            captured.update(body)
            return b"ID3" + b"fixture-audio"

        with patch.object(voice_api, "_request_audio", side_effect=fake_request):
            result = voice_api.execute(job)
        self.assertEqual(captured, {"model": "tts-fixture", "input": "你好", "voice": "alloy", "response_format": "mp3", "speed": 1.25})
        asset = result["assets"][0]
        self.assertEqual(asset["mime"], "audio/mpeg")
        self.assertEqual(Path(asset["path"]).read_bytes(), b"ID3fixture-audio")
        self.assertNotIn("VOICE_TEST_KEY", json.dumps(result))

    def test_chant_adds_style_instructions_without_claiming_song(self):
        job = self.job("voice_chant", mode="chant", text="小星星", style="轻快", format="wav")
        captured = {}

        def fake_request(current, body):
            captured.update(body)
            return b"RIFF" + b"\x00" * 4 + b"WAVE" + b"fixture"

        with patch.object(voice_api, "_request_audio", side_effect=fake_request):
            result = voice_api.execute(job)
        self.assertIn("instructions", captured)
        self.assertIn("轻快", captured["instructions"])
        self.assertIn("not a full song", captured["instructions"])
        self.assertEqual(result["assets"][0]["kind"], "audio")

    def test_pcm_response_is_wrapped_as_wav(self):
        job = self.job(mode="speak", text="pcm", format="wav")
        pcm = b"\x00\x00" * 160
        with patch.object(voice_api, "_request_audio", return_value=(pcm, "audio/pcm")):
            result = voice_api.execute(job)
        data = Path(result["assets"][0]["path"]).read_bytes()
        self.assertTrue(data.startswith(b"RIFF"))
        self.assertEqual(data[8:12], b"WAVE")
        self.assertEqual(data[-len(pcm):], pcm)

    def test_chant_downgrades_only_on_known_instruction_rejection(self):
        job = self.job("voice_chant", mode="chant", text="旋律", format="mp3")
        bodies = []

        def fake_request(current, route, *, body):
            bodies.append(body)
            if len(bodies) == 1:
                raise voice_api.VoiceError("VOICE_PROVIDER_HTTP_400")
            return b"ID3fallback"

        with patch.object(voice_api, "request", side_effect=fake_request):
            result = voice_api.execute(job)
        self.assertNotIn("instructions", bodies[1])
        self.assertEqual(result["coverage"], "VOICE_SYNTHESIS_DEGRADED")
        self.assertIn("降级", result["text"])

    def test_invalid_parameters_fail_closed(self):
        with self.assertRaisesRegex(voice_api.VoiceError, "VOICE_SPEED_INVALID"):
            voice_api.execute(self.job(mode="speak", text="hello", speed=9, format="mp3"))
        with self.assertRaisesRegex(voice_api.VoiceError, "VOICE_INPUTS_NOT_ALLOWED"):
            bad = self.job(mode="speak", text="hello", format="mp3")
            bad["inputs"] = [{"path": "x"}]
            voice_api.execute(bad)

    def test_successful_json_response_is_rejected_as_non_audio(self):
        job = self.job(mode="speak", text="hello", format="wav")
        with patch.object(voice_api, "_request_audio", return_value=(b"{}", "application/json")):
            with self.assertRaisesRegex(voice_api.VoiceError, "VOICE_OUTPUT_FORMAT_INVALID"):
                voice_api.execute(job)

    def test_operation_cannot_be_used_to_change_voice_mode(self):
        job = self.job("voice_speak", mode="chant", text="hello", format="mp3")
        with self.assertRaisesRegex(voice_api.VoiceError, "VOICE_MODE_OPERATION_MISMATCH"):
            voice_api.execute(job)


if __name__ == "__main__":
    unittest.main()
