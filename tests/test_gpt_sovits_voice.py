import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import wave

import requests

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


voice_api = load("gpt_sovits_voice_api", ROOT / "skills/voice-generation/scripts/voice_api.py")
worker = load("gpt_sovits_worker", ROOT / "python/worker.py")


def wav_bytes(pcm=b"\x01\x00" * 100):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(24000)
        audio.writeframes(pcm)
    return output.getvalue()


class Response:
    def __init__(self, status=200, result=None, data=b""):
        self.status_code = status
        self.result = {"message": "success"} if result is None else result
        self.data = data

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def json(self):
        if isinstance(self.result, Exception):
            raise self.result
        return self.result

    def iter_content(self, size):
        for offset in range(0, len(self.data), size):
            yield self.data[offset:offset + size]


class Session:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []
        self.trust_env = True

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def _request(self, method, url, kwargs):
        self.calls.append((method, url, kwargs))
        result = next(self.responses)
        if isinstance(result, Exception):
            raise result
        return result

    def get(self, url, **kwargs):
        return self._request("GET", url, kwargs)

    def post(self, url, **kwargs):
        return self._request("POST", url, kwargs)


class GptSovitsVoiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(dir=ROOT / ".codex")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def job(self, **params):
        return {
            "id": "gpt-voice-test", "scope": "scope", "operation": "voice_speak", "handler": "skill",
            "inputs": [], "parameters": {"text": "你好，朋友。", **params},
            "output": str(self.root), "usagePath": str(self.root / "usage.json"),
            "endpoint": {
                "protocol": "gpt_sovits", "baseUrl": "http://127.0.0.1:9880/",
                "modelVersion": "v4", "gptWeightsPath": "models/角色/voice.ckpt",
                "sovitsWeightsPath": "models/角色/voice.pth", "refAudioPath": "references/你好.wav",
                "promptText": "这是参考音频。", "promptLang": "all_zh", "textLang": "auto", "voice": "persona",
            },
            "timeoutMs": 0, "deadline": 0, "quotaUnits": 10,
        }

    def successful_session(self, data=None):
        return Session([Response(), Response(), Response(), Response(data=wav_bytes() if data is None else data)])

    def test_reload_sequence_uses_endpoint_files_and_maps_payload(self):
        session = self.successful_session()
        job = self.job(speed=1.25, refAudioPath="model-supplied.wav", baseUrl="http://wrong.invalid")
        with patch("requests.Session", return_value=session):
            result = voice_api.execute(job)
        self.assertFalse(session.trust_env)
        self.assertEqual([(method, url.rsplit("/", 1)[1]) for method, url, _ in session.calls], [
            ("GET", "set_sovits_weights"), ("GET", "set_gpt_weights"), ("GET", "set_refer_audio"), ("POST", "tts")])
        self.assertEqual(session.calls[0][2]["params"], {"weights_path": job["endpoint"]["sovitsWeightsPath"]})
        self.assertEqual(session.calls[1][2]["params"], {"weights_path": job["endpoint"]["gptWeightsPath"]})
        self.assertEqual(session.calls[2][2]["params"], {"refer_audio_path": job["endpoint"]["refAudioPath"]})
        self.assertEqual(session.calls[3][2]["json"], {
            "text": "你好，朋友。", "text_lang": "auto", "ref_audio_path": "references/你好.wav",
            "prompt_text": "这是参考音频。", "prompt_lang": "all_zh", "aux_ref_audio_paths": [],
            "media_type": "wav", "streaming_mode": False, "batch_size": 1, "speed_factor": 1.25,
        })
        for _, url, kwargs in session.calls:
            self.assertTrue(url.startswith("http://127.0.0.1:9880/"))
            self.assertFalse(kwargs["allow_redirects"])
            self.assertIsNone(kwargs["timeout"])
            self.assertNotIn("Authorization", kwargs.get("headers", {}))
        self.assertEqual(Path(result["assets"][0]["path"]).read_bytes(), wav_bytes())
        self.assertEqual(result["assets"][0]["mime"], "audio/wav")
        calls = json.loads((self.root / "usage.json").read_text())
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0]["attempted"])
        self.assertNotIn("model", calls[0])
        self.assertNotIn("models/", json.dumps(calls))

    def test_every_job_reloads_even_same_persona_or_after_service_restart(self):
        sessions = [self.successful_session(), self.successful_session()]
        with patch("requests.Session", side_effect=sessions):
            voice_api.execute(self.job())
            voice_api.execute(self.job())
        self.assertEqual([len(session.calls) for session in sessions], [4, 4])
        self.assertEqual(sessions[0].calls, sessions[1].calls)

    def test_switch_error_stops_sequence_and_next_job_reloads_from_start(self):
        failed = Session([Response(), Response(status=400)])
        restored = self.successful_session()
        with patch("requests.Session", side_effect=[failed, restored]):
            with self.assertRaisesRegex(voice_api.VoiceError, "GPT_SOVITS_SET_GPT_WEIGHTS_HTTP_400"):
                voice_api.execute(self.job())
            self.assertFalse((self.root / "usage.json").exists())
            voice_api.execute(self.job())
        self.assertEqual(len(failed.calls), 2)
        self.assertEqual(len(restored.calls), 4)
        self.assertTrue(restored.calls[0][1].endswith("/set_sovits_weights"))

    def test_control_json_success_is_required(self):
        for invalid in ({"message": "failed"}, [], ValueError("not JSON")):
            with self.subTest(invalid=invalid):
                session = Session([Response(result=invalid)])
                with patch("requests.Session", return_value=session):
                    with self.assertRaisesRegex(voice_api.VoiceError, "GPT_SOVITS_CONTROL_RESPONSE_INVALID"):
                        voice_api.execute(self.job())
                self.assertEqual(len(session.calls), 1)
        self.assertFalse((self.root / "usage.json").exists())

    def test_timeout_or_connection_error_is_not_replayed(self):
        for failure, code in ((requests.Timeout(), "GPT_SOVITS_TIMEOUT"),
                              (requests.ConnectionError(), "GPT_SOVITS_CONNECTION_FAILED")):
            with self.subTest(code=code):
                session = Session([Response(), failure])
                with patch("requests.Session", return_value=session):
                    with self.assertRaisesRegex(voice_api.VoiceError, code):
                        voice_api.execute(self.job())
                self.assertEqual(len(session.calls), 2)

    def test_tts_http_error_is_not_saved_or_replayed(self):
        session = Session([Response(), Response(), Response(), Response(status=500)])
        with patch("requests.Session", return_value=session):
            with self.assertRaisesRegex(voice_api.VoiceError, "GPT_SOVITS_TTS_HTTP_500"):
                voice_api.execute(self.job())
        self.assertEqual(len(session.calls), 4)
        self.assertFalse((self.root / "voice.wav").exists())
        self.assertEqual(len(json.loads((self.root / "usage.json").read_text())), 1)

    def test_expired_job_does_not_continue_after_a_completed_switch_step(self):
        session = Session([Response()])
        with patch("requests.Session", return_value=session), patch.object(
                voice_api, "remaining", side_effect=[60, 60, voice_api.VoiceError("JOB_EXPIRED")]):
            with self.assertRaisesRegex(voice_api.VoiceError, "JOB_EXPIRED"):
                voice_api.execute(self.job())
        self.assertEqual(len(session.calls), 1)
        self.assertFalse((self.root / "usage.json").exists())

    def test_rejects_unsupported_mode_format_or_voice_before_requests(self):
        for kwargs, code in (({"format": "mp3"}, "GPT_SOVITS_FORMAT_UNSUPPORTED"),
                             ({"voice": "../different.pth"}, "GPT_SOVITS_VOICE_NOT_CONFIGURED")):
            with self.subTest(code=code), patch("requests.Session") as session:
                with self.assertRaisesRegex(voice_api.VoiceError, code):
                    voice_api.execute(self.job(**kwargs))
                session.assert_not_called()
        job = self.job(mode="chant")
        job["operation"] = "voice_chant"
        with patch("requests.Session") as session:
            with self.assertRaisesRegex(voice_api.VoiceError, "GPT_SOVITS_CHANT_UNSUPPORTED"):
                voice_api.execute(job)
            session.assert_not_called()

    def test_style_is_explicit_plain_voice_degradation(self):
        session = self.successful_session()
        with patch("requests.Session", return_value=session):
            result = voice_api.execute(self.job(style="轻快"))
        self.assertEqual(result["coverage"], "VOICE_SYNTHESIS_DEGRADED")
        self.assertIn("普通语音", result["text"])
        self.assertNotIn("style", session.calls[-1][2]["json"])

    def test_malformed_silent_empty_and_truncated_audio_is_rejected(self):
        data = wav_bytes()
        cases = [
            (b"", "EMPTY_VOICE_OUTPUT"), (b'{"message":"error"}', "VOICE_OUTPUT_FORMAT_INVALID"),
            (wav_bytes(b""), "EMPTY_VOICE_OUTPUT"), (wav_bytes(b"\0\0" * 100), "VOICE_SILENT_OUTPUT"),
            (data[:-2], "VOICE_WAV_INCOMPLETE"),
            (data[:4] + struct.pack("<I", len(data) - 8) + data[8:40] + struct.pack("<I", 400) + data[44:], "VOICE_WAV_INCOMPLETE"),
            (data[:40] + struct.pack("<I", 199) + data[44:], "VOICE_WAV_INCOMPLETE"),
        ]
        for audio, code in cases:
            with self.subTest(code=code), patch.object(voice_api, "_request_gpt_audio", return_value=audio):
                with self.assertRaisesRegex(voice_api.VoiceError, code):
                    voice_api.execute(self.job())
        self.assertFalse((self.root / "voice.wav").exists())

    def test_audio_byte_limit_applies_during_read_and_after_stubbed_transport(self):
        with patch.object(voice_api, "MAX_AUDIO_BYTES", 64):
            session = self.successful_session()
            with patch("requests.Session", return_value=session):
                with self.assertRaisesRegex(voice_api.VoiceError, "VOICE_OUTPUT_TOO_LARGE"):
                    voice_api.execute(self.job())
            with patch.object(voice_api, "_request_gpt_audio", return_value=wav_bytes()):
                with self.assertRaisesRegex(voice_api.VoiceError, "VOICE_OUTPUT_TOO_LARGE"):
                    voice_api.execute(self.job())

    def test_cross_version_endpoint_validation_and_worker_protocol_require_no_key(self):
        for version in sorted(voice_api.GPT_SOVITS_VERSIONS):
            job = self.job()
            job["endpoint"]["modelVersion"] = version
            worker._validate_protocol(job)
            self.assertIs(voice_api._endpoint(job), job["endpoint"])
        job = self.job()
        job["endpoint"].update(modelVersion="v1", textLang="ko")
        with self.assertRaisesRegex(voice_api.VoiceError, "GPT_SOVITS_LANGUAGE_INVALID"):
            voice_api.execute(job)
        job = self.job()
        job["operation"] = "video_analyze"
        with self.assertRaisesRegex(worker.JobError, "MEDIA_WORKER_ENDPOINT_INVALID"):
            worker._validate_protocol(job)
        for key in ("gptWeightsPath", "sovitsWeightsPath", "refAudioPath", "promptText", "voice"):
            job = self.job()
            del job["endpoint"][key]
            with self.subTest(key=key), self.assertRaisesRegex(worker.JobError, "MEDIA_WORKER_ENDPOINT_INVALID"):
                worker._validate_protocol(job)

    def test_manifest_dispatch_imports_transport_and_accepts_optional_model_journal(self):
        session = self.successful_session()
        with patch("requests.Session", return_value=session):
            result = worker.execute(self.job())
        self.assertEqual(len(session.calls), 4)
        self.assertEqual(result["assets"][0]["mime"], "audio/wav")
        self.assertEqual(result["coverage"], "VOICE_SYNTHESIS")
        self.assertTrue(json.loads((self.root / "usage.json").read_text())[0]["attempted"])

    def test_invalid_endpoint_is_rejected_without_contacting_service(self):
        for url in ("ftp://localhost/", "http://user:pass@localhost/", "http://localhost/?key=x", "http://localhost/#x", "http://localhost:bad/"):
            with self.subTest(url=url), patch("requests.Session") as session:
                job = self.job()
                job["endpoint"]["baseUrl"] = url
                with self.assertRaisesRegex(voice_api.VoiceError, "MEDIA_PROVIDER_ENDPOINT_INVALID"):
                    voice_api.execute(job)
                session.assert_not_called()


if __name__ == "__main__":
    unittest.main()
