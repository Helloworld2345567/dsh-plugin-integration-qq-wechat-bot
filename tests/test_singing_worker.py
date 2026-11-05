import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[1]
from dsh_bot_runtime import singing_worker
from dsh_bot_runtime.singing_common import SingingError, validate_wav


def audio_data():
    stream = io.BytesIO()
    with wave.open(stream, "wb") as output:
        output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        output.writeframes(b"".join(struct.pack("<h", 4000 if i % 64 < 32 else -4000) for i in range(16000)))
    return stream.getvalue()


class SingingWorkerTests(unittest.TestCase):
    def setUp(self):
        (ROOT / ".codex").mkdir(exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(prefix="singing-worker-test-", dir=ROOT / ".codex")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "song.upload"
        self.source.write_bytes(audio_data())

    def job(self, **parameters):
        return {"id": "singing-job", "scope": "scope", "operation": "singing_convert", "timeoutMs": 30000,
                "deadline": 4102444800000, "output": str(self.root / "outputs"),
                "parameters": {"sourceType": "vocals", "format": "mp3", **parameters},
                "inputs": [{"kind": "file", "path": str(self.source), "name": "song.upload", "mime": "application/octet-stream"}],
                "endpoint": {"protocol": "rvc_http_v1", "baseUrl": "http://127.0.0.1:9881", "jobId": "singing-job",
                             "modelVersion": "v2", "singingModelId": "fixture", "singingWeightsPath": "fixture.pth",
                             "speakerId": 0, "pitchShift": 0, "indexRate": 0}}

    def fake_conversion(self, job, source, target):
        Path(target).write_bytes(Path(source).read_bytes())

    def test_file_audio_is_probed_and_wav_or_mp3_is_fully_validated(self):
        for output_format in ("mp3", "wav"):
            with self.subTest(format=output_format), patch.object(singing_worker, "request_conversion", side_effect=self.fake_conversion):
                result = singing_worker.execute(self.job(format=output_format))
                asset = result["assets"][0]
                self.assertEqual(asset["kind"], "audio")
                self.assertEqual(asset["name"], "singing." + output_format)
                self.assertTrue(Path(asset["path"]).stat().st_size > 100)
                self.assertFalse(list((self.root / "outputs").glob("singing-*")))
                if output_format == "wav":
                    self.assertAlmostEqual(validate_wav(asset["path"]), 1)

    def test_mixed_and_unknown_sources_stop_before_download_or_inference(self):
        for source_type, code in (("mixed", "SINGING_SEPARATION_UNCONFIGURED"), ("unknown", "SINGING_SOURCE_TYPE_REQUIRED")):
            with self.subTest(source_type=source_type), patch.object(singing_worker, "request_conversion") as inference, patch.object(singing_worker, "_download_source") as download:
                job = self.job(sourceType=source_type, url="https://example.test/music.mp3")
                job["inputs"] = []
                with self.assertRaisesRegex(SingingError, code):
                    singing_worker.execute(job)
                inference.assert_not_called()
                download.assert_not_called()

    def test_configured_mixed_attachment_is_submitted_with_separation_settings(self):
        model = self.root / "model_bs_roformer_ep_368_sdr_12.9628.ckpt"
        model.write_bytes(b"operator fixture")
        captured = {}
        def fake_request(job, source, target):
            captured.update(job["parameters"], endpoint=job["endpoint"])
            Path(target).write_bytes(Path(source).read_bytes())
        endpoint = {"protocol": "rvc_http_v1", "baseUrl": "http://127.0.0.1:9881", "jobId": "singing-job",
                    "modelVersion": "v2", "singingModelId": "fixture", "singingWeightsPath": str(self.root / "voice.pth"),
                    "speakerId": 0, "pitchShift": 0, "indexRate": 0,
                    "separation": {"status": "configured", "enabled": True, "modelId": "vocals",
                                    "modelPath": str(model), "instrumentalMix": True, "volume": 0.75}}
        job = self.job(sourceType="mixed")
        job["endpoint"] = endpoint
        with patch.object(singing_worker, "request_conversion", side_effect=fake_request):
            result = singing_worker.execute(job)
        self.assertEqual(captured["sourceType"], "mixed")
        self.assertEqual(captured["endpoint"]["separation"]["modelId"], "vocals")
        self.assertEqual(result["assets"][0]["kind"], "audio")

    def test_html_input_silent_and_truncated_results_do_not_register_assets(self):
        self.source.write_bytes(b"<html>not audio</html>")
        with patch.object(singing_worker, "request_conversion") as inference:
            with self.assertRaisesRegex(SingingError, "SINGING_AUDIO_INVALID"):
                singing_worker.execute(self.job())
            inference.assert_not_called()
        self.source.write_bytes(audio_data())
        silent = audio_data()[:44] + bytes(len(audio_data()) - 44)
        for result in (audio_data()[:-10], b"<html>error</html>", silent):
            with patch.object(singing_worker, "request_conversion", side_effect=lambda job, source, target: Path(target).write_bytes(result)):
                with self.assertRaisesRegex(SingingError, "SINGING_OUTPUT_INVALID"):
                    singing_worker.execute(self.job())
        self.assertFalse((self.root / "outputs" / "singing.mp3").exists())

    def test_output_limit_does_not_truncate_or_change_requested_format(self):
        with patch.object(singing_worker, "request_conversion", side_effect=self.fake_conversion) as inference, patch.object(singing_worker, "MAX_OUTPUT_BYTES", 100):
            with self.assertRaisesRegex(SingingError, "SINGING_OUTPUT_TOO_LARGE"):
                singing_worker.execute(self.job(format="wav"))
            self.assertEqual(inference.call_count, 1)
        self.assertFalse((self.root / "outputs" / "singing.wav").exists())
        self.assertFalse((self.root / "outputs" / "singing.mp3").exists())

    def test_service_error_text_is_not_exposed(self):
        class Response:
            status_code = 400
        for value in ({"error": {"code": "C:/private/weights traceback"}}, [], {"error": "private traceback"}):
            response = Response()
            response.content = json.dumps(value).encode()
            with self.subTest(value=value), self.assertRaisesRegex(SingingError, "SINGING_SERVICE_STATE_UNKNOWN"):
                singing_worker._status(response, "singing-job")

    def test_lost_submit_response_queries_original_id_without_resubmission(self):
        import requests
        from unittest.mock import MagicMock
        session = MagicMock()
        session.__enter__.return_value = session
        session.post.side_effect = requests.ConnectionError("lost response")
        response = MagicMock()
        response.__enter__.return_value = response
        response.status_code = 404
        session.get.return_value = response
        job = self.job()
        Path(job["output"]).mkdir()
        with patch.object(requests, "Session", return_value=session):
            with self.assertRaisesRegex(SingingError, "SINGING_SERVICE_STATE_UNKNOWN"):
                singing_worker.request_conversion(job, self.source, self.root / "result.wav")
        self.assertEqual(session.post.call_count, 1)
        self.assertEqual(session.get.call_args.args[0], "http://127.0.0.1:9881/v1/jobs/singing-job")

    def test_lost_submit_response_can_fetch_existing_success(self):
        import requests
        from unittest.mock import MagicMock
        session = MagicMock()
        session.__enter__.return_value = session
        session.post.side_effect = requests.ConnectionError("lost response")
        status = MagicMock()
        status.__enter__.return_value = status
        status.status_code = 200
        status.content = json.dumps({"jobId": "singing-job", "status": "succeeded"}).encode()
        audio = MagicMock()
        audio.__enter__.return_value = audio
        audio.status_code = 200
        audio.headers = {"Content-Type": "audio/wav"}
        audio.iter_content.return_value = [audio_data()]
        session.get.side_effect = [status, audio]
        job = self.job()
        Path(job["output"]).mkdir()
        target = self.root / "result.wav"
        with patch.object(requests, "Session", return_value=session):
            singing_worker.request_conversion(job, self.source, target)
        self.assertEqual(session.post.call_count, 1)
        self.assertEqual(target.read_bytes(), audio_data())


if __name__ == "__main__":
    unittest.main()
