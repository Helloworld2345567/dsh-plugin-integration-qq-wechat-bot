import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import threading
import time
import unittest
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from singing_common import SingingError, validate_parameters, validate_wav
from rvc_service import JobManager, create_server


def wav_bytes():
    stream = io.BytesIO()
    with wave.open(stream, "wb") as output:
        output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        output.writeframes(b"".join(struct.pack("<h", 8000 if i % 32 < 16 else -8000) for i in range(8000)))
    return stream.getvalue()


def parameters(job_id="test"):
    return {"jobId": job_id, "modelVersion": "v2", "singingModelId": "fixture", "singingWeightsPath": "fixture.pth",
            "speakerId": 0, "pitchShift": 0, "indexRate": 0}


RUNNER = '''import json, pathlib, subprocess, sys, time
job = json.loads(pathlib.Path(sys.argv[1]).read_text())
if job['parameters']['singingModelId'] == 'wait':
    marker = pathlib.Path(sys.argv[2])
    subprocess.Popen([sys.executable, '-c', "import pathlib,sys,time; time.sleep(1.5); pathlib.Path(sys.argv[1]).write_text('alive')", str(marker)])
    pathlib.Path(sys.argv[1]).with_name('started').write_text('started')
    time.sleep(30)
pathlib.Path(job['output']).write_bytes(pathlib.Path(job['input']).read_bytes())
pathlib.Path(job['status']).write_text(json.dumps({'status':'succeeded'}))
'''


class SingingServiceTests(unittest.TestCase):
    def setUp(self):
        (ROOT / ".codex").mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="singing-test-", dir=ROOT / ".codex")
        self.directory = Path(self.temporary.name)
        self.runner = self.directory / "runner.py"
        self.runner.write_text(RUNNER, encoding="utf-8")
        self.marker = self.directory / "child-survived"
        self.manager = JobManager(self.directory, self.directory, command_factory=lambda job:
                                  [sys.executable, "-B", str(self.runner), str(job.directory / "job.json"), str(self.marker)])
        self.addCleanup(self.temporary.cleanup)
        self.addCleanup(self.manager.close)

    def wait_for(self, predicate):
        end = time.monotonic() + 5
        while time.monotonic() < end:
            if predicate():
                return
            time.sleep(0.025)
        self.fail("Job did not reach the expected state")

    def test_job_id_is_idempotent_and_conflicting_config_is_rejected(self):
        first = self.manager.submit(parameters(), wav_bytes())
        second = self.manager.submit(parameters(), wav_bytes())
        self.assertEqual(first["jobId"], second["jobId"])
        self.assertEqual(len(self.manager.jobs), 1)
        with self.assertRaisesRegex(SingingError, "SINGING_JOB_CONFLICT"):
            self.manager.submit({**parameters(), "speakerId": 1}, wav_bytes())
        self.wait_for(lambda: self.manager.get("test")["status"] == "succeeded")
        with self.manager.result("test") as audio:
            self.assertEqual(audio.read(), wav_bytes())

    def test_running_cancel_kills_child_before_next_job_and_queued_cancel_never_runs(self):
        self.manager.submit({**parameters("running"), "singingModelId": "wait"}, wav_bytes())
        self.wait_for(lambda: (self.manager.jobs["running"].directory / "started").exists())
        self.manager.submit(parameters("queued"), wav_bytes())
        self.assertEqual(self.manager.get("queued")["status"], "queued")
        self.assertEqual(self.manager.cancel("queued")["status"], "cancelled")
        self.assertIsNone(self.manager.jobs["queued"].process)
        self.assertEqual(self.manager.cancel("running")["status"], "cancelled")
        self.assertIsNotNone(self.manager.jobs["running"].process.poll())
        self.manager.submit(parameters("next"), wav_bytes())
        self.wait_for(lambda: self.manager.get("next")["status"] == "succeeded")
        time.sleep(1.6)
        self.assertFalse(self.marker.exists(), "Cancelled task left a child process alive")
        self.assertFalse((self.manager.jobs["running"].directory / "result.wav").exists())

    def test_http_multipart_status_result_and_safe_errors(self):
        import requests
        server = create_server(self.manager, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        base = f"http://127.0.0.1:{server.server_port}"
        with requests.Session() as session:
            session.trust_env = False
            self.assertEqual(session.get(base + "/health").json()["protocol"], "rvc_http_v1")
            result = session.post(base + "/v1/jobs", files={"audio": ("private-name.wav", wav_bytes(), "audio/wav")},
                                  data={"parameters": json.dumps(parameters("http"))})
            self.assertEqual(result.status_code, 202, result.text)
            self.wait_for(lambda: self.manager.get("http")["status"] == "succeeded")
            self.assertEqual(session.get(base + "/v1/jobs/http").json()["status"], "succeeded")
            self.assertEqual(session.get(base + "/v1/jobs/http/result").content, wav_bytes())
            self.assertEqual(session.delete(base + "/v1/jobs/http").json()["status"], "succeeded")
            missing = session.get(base + "/v1/jobs/missing")
            self.assertEqual(missing.status_code, 404)
            self.assertEqual(missing.json(), {"error": {"code": "SINGING_JOB_NOT_FOUND"}})
            self.assertNotIn(str(self.directory), result.text + missing.text)

    def test_incompatible_model_configuration_and_bad_pcm_are_rejected(self):
        for delta in ({"modelVersion": "v4"}, {"indexRate": 0.5}, {"pitchShift": 25}, {"speakerId": -1}, {"jobId": "../bad"}):
            with self.subTest(delta=delta), self.assertRaisesRegex(SingingError, "SINGING_CONFIG_INVALID"):
                validate_parameters({**parameters(), **delta})
        path = self.directory / "audio.wav"
        for data in (b"<html>error</html>", wav_bytes()[:-20]):
            path.write_bytes(data)
            with self.assertRaisesRegex(SingingError, "SINGING_OUTPUT_INVALID"):
                validate_wav(path)
        path.write_bytes(wav_bytes())
        self.assertAlmostEqual(validate_wav(path), 0.5)
        with self.assertRaisesRegex(SingingError, "SINGING_OUTPUT_INVALID"):
            validate_wav(path, expected_duration=4)

    def test_cancel_before_upload_prevents_late_submission(self):
        self.assertEqual(self.manager.cancel("late")["status"], "cancelled")
        self.assertEqual(self.manager.submit(parameters("late"), wav_bytes())["status"], "cancelled")
        self.assertIsNone(self.manager.jobs["late"].process)
        self.assertEqual(len(self.manager.queue), 0)

    def test_expired_jobs_release_storage_but_are_not_replayed(self):
        self.manager.submit(parameters("old"), wav_bytes())
        self.wait_for(lambda: self.manager.get("old")["status"] == "succeeded")
        folder = self.manager.jobs["old"].directory
        self.manager.jobs["old"].finished_at = time.monotonic() - 4000
        with self.manager.condition:
            self.manager._prune()
        self.assertNotIn("old", self.manager.jobs)
        self.assertFalse(folder.exists())
        with self.assertRaisesRegex(SingingError, "SINGING_SERVICE_STATE_UNKNOWN"):
            self.manager.submit(parameters("old"), wav_bytes())
        self.assertEqual(self.manager.submit(parameters("fresh"), wav_bytes())["status"], "queued")


if __name__ == "__main__":
    unittest.main()
