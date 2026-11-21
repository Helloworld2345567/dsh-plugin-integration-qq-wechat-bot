import base64
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from PIL import Image

from dsh_bot_runtime import worker
from dsh_bot_runtime.skills.image_generation import image_api
from dsh_bot_runtime.skills.image_generation.google import image_api as google_api


ROOT = Path(__file__).resolve().parents[2]


class GoogleImageTests(unittest.TestCase):
    def setUp(self):
        (ROOT / ".codex").mkdir(exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=ROOT / ".codex")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def png(self, name="source.png", color="red"):
        target = self.root / name
        Image.new("RGB", (4, 4), color).save(target, format="PNG")
        return target

    def payload(self, data):
        return {"candidates": [{"content": {"parts": [{"text": "done"}, {"inlineData": {
            "mimeType": "image/png", "data": base64.b64encode(data).decode("ascii")
        }}]}}], "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 4}}

    def test_dispatcher_uses_google_defaults(self):
        args = image_api.parse_args(["generate", "--protocol", "google", "--prompt", "test", "--dry-run"])
        self.assertEqual(args.base_url, google_api.DEFAULT_BASE_URL)
        self.assertEqual(args.model, google_api.DEFAULT_MODEL)
        self.assertEqual(args.api_key_env, google_api.DEFAULT_KEY_ENV)

    def test_google_generation_uses_native_payload_and_header(self):
        source = self.png()
        raw = source.read_bytes()
        response = Mock(status_code=200)
        response.json.return_value = self.payload(raw)
        record = self.root / "result.json"
        with patch.dict(os.environ, {"GEMINI_API_KEY": "fixture-key"}, clear=True), \
                patch.object(google_api, "request_with_retry", return_value=response) as request:
            result = google_api.main(["generate", "--prompt", "draw a red square", "--base-url",
                                      "https://example.invalid/v1beta", "--output-format", "png",
                                      "--output-dir", str(self.root), "--record", str(record)])
        self.assertEqual(result, 0)
        request.assert_called_once()
        _, method, url = request.call_args.args
        self.assertEqual(method, "POST")
        self.assertEqual(url, "https://example.invalid/v1beta/models/gemini-2.5-flash-image:generateContent")
        self.assertEqual(request.call_args.kwargs["headers"]["x-goog-api-key"], "fixture-key")
        body = request.call_args.kwargs["json"]
        self.assertEqual(body["generationConfig"]["responseModalities"], ["TEXT", "IMAGE"])
        self.assertEqual(body["generationConfig"]["candidateCount"], 1)
        self.assertEqual(body["contents"][0]["parts"], [{"text": "draw a red square"}])
        saved = json.loads(record.read_text(encoding="utf-8"))
        self.assertEqual(saved["returned_count"], 1)
        self.assertEqual((self.root / saved["outputs"][0]).read_bytes(), raw)

    def test_google_edit_embeds_reference_image(self):
        source = self.png("reference.png", "blue")
        raw = self.png("generated.png").read_bytes()
        response = Mock(status_code=200)
        response.json.return_value = self.payload(raw)
        with patch.dict(os.environ, {"CUSTOM_GEMINI_KEY": "fixture-key"}, clear=True), \
                patch.object(google_api, "request_with_retry", return_value=response) as request:
            result = google_api.main(["edit", "--prompt", "turn it green", "--model", "models/custom-image",
                                      "--base-url", "https://example.invalid/v1beta", "--api-key-env", "CUSTOM_GEMINI_KEY",
                                      "--image", str(source), "--output-dir", str(self.root)])
        self.assertEqual(result, 0)
        body = request.call_args.kwargs["json"]
        parts = body["contents"][0]["parts"]
        self.assertEqual(parts[0], {"text": "turn it green"})
        self.assertEqual(parts[1]["inlineData"]["mimeType"], "image/png")
        self.assertEqual(base64.b64decode(parts[1]["inlineData"]["data"]), source.read_bytes())
        self.assertIn("models/custom-image:generateContent", request.call_args.args[2])

    def test_google_generation_preserves_distinct_provider_images(self):
        first = self.png("first.png", "red").read_bytes()
        second = self.png("second.png", "blue").read_bytes()
        response = Mock(status_code=200)
        response.json.return_value = {
            "candidates": [{"content": {"parts": [
                {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(first).decode("ascii")}},
                {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(second).decode("ascii")}},
            ]}}]
        }
        record = self.root / "multiple.json"
        with patch.dict(os.environ, {"GEMINI_API_KEY": "fixture-key"}, clear=True), \
                patch.object(google_api, "request_with_retry", return_value=response):
            result = google_api.main(["generate", "--prompt", "two images", "--output-format", "png",
                                      "--output-dir", str(self.root), "--record", str(record)])
        self.assertEqual(result, 0)
        saved = json.loads(record.read_text(encoding="utf-8"))
        self.assertEqual(saved["returned_count"], 2)
        self.assertEqual(len(saved["outputs"]), 2)
        self.assertEqual((self.root / saved["outputs"][0]).read_bytes(), first)
        self.assertEqual((self.root / saved["outputs"][1]).read_bytes(), second)

    def test_google_generation_deduplicates_equivalent_png_and_jpeg(self):
        image = Image.new("RGB", (8, 8), "red")
        png = io.BytesIO(); image.save(png, format="PNG")
        jpeg = io.BytesIO(); image.save(jpeg, format="JPEG", quality=96)
        response = Mock(status_code=200)
        response.json.return_value = {"candidates": [{"content": {"parts": [
            {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(png.getvalue()).decode("ascii")}},
            {"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(jpeg.getvalue()).decode("ascii")}},
        ]}}]}
        record = self.root / "equivalent.json"
        with patch.dict(os.environ, {"GEMINI_API_KEY": "fixture-key"}, clear=True), \
                patch.object(google_api, "request_with_retry", return_value=response):
            result = google_api.main(["generate", "--prompt", "equivalent image", "--output-format", "png",
                                      "--output-dir", str(self.root), "--record", str(record)])
        self.assertEqual(result, 0)
        saved = json.loads(record.read_text(encoding="utf-8"))
        self.assertEqual(saved["returned_count"], 1)
        self.assertEqual(len(saved["outputs"]), 1)

    def test_google_generation_deduplicates_identical_provider_images(self):
        raw = self.png("duplicate.png", "green").read_bytes()
        encoded = base64.b64encode(raw).decode("ascii")
        response = Mock(status_code=200)
        response.json.return_value = {
            "candidates": [{"content": {"parts": [
                {"inlineData": {"mimeType": "image/png", "data": encoded}},
                {"inlineData": {"mimeType": "image/png", "data": encoded}},
            ]}}]
        }
        record = self.root / "duplicate.json"
        with patch.dict(os.environ, {"GEMINI_API_KEY": "fixture-key"}, clear=True), \
                patch.object(google_api, "request_with_retry", return_value=response):
            result = google_api.main(["generate", "--prompt", "duplicate image", "--output-format", "png",
                                      "--output-dir", str(self.root), "--record", str(record)])
        self.assertEqual(result, 0)
        saved = json.loads(record.read_text(encoding="utf-8"))
        self.assertEqual(saved["returned_count"], 1)
        self.assertEqual((self.root / saved["outputs"][0]).read_bytes(), raw)

    def test_google_rejects_openai_only_options_before_network(self):
        for options in (("--n", "2"), ("--output-format", "gif"), ("--complexity", "high"),
                        ("--frame-count", "4")):
            with self.subTest(options=options), patch.object(google_api, "request_with_retry") as request:
                result = google_api.main(["generate", "--prompt", "test", *options, "--dry-run"])
                self.assertEqual(result, 2)
                request.assert_not_called()

    def test_worker_routes_google_and_uses_selected_key(self):
        job = {
            "id": "test", "scope": "scope", "operation": "image_generate", "handler": "image",
            "deadline": time.time() * 1000 + 30000, "timeoutMs": 1000, "inputs": [],
            "parameters": {"prompt": "test", "output_format": "png"}, "output": str(self.root),
            "usagePath": str(self.root / "usage.json"),
            "endpoint": {"protocol": "google", "baseUrl": "https://example.invalid/v1beta", "model": "fixture",
                         "keyEnv": "CUSTOM_GEMINI_KEY"},
        }
        output = self.root / "generated.png"
        output.write_bytes(self.png("worker-source.png").read_bytes())

        def run(command, **kwargs):
            self.assertIn("--protocol", command)
            self.assertEqual(command[command.index("--protocol") + 1], "google")
            self.assertEqual(command[command.index("--api-key-env") + 1], "CUSTOM_GEMINI_KEY")
            (self.root / "image-result.json").write_text(json.dumps({"outputs": [output.name]}), encoding="utf-8")
            return Mock(returncode=0)

        with patch.object(worker.subprocess, "run", side_effect=run):
            result = worker.execute(job)
        self.assertEqual(result["assets"][0]["mime"], "image/png")

    def test_worker_accepts_multiple_google_outputs_from_one_request(self):
        job = {
            "id": "test-multiple", "scope": "scope", "operation": "image_generate", "handler": "image",
            "deadline": time.time() * 1000 + 30000, "timeoutMs": 1000, "inputs": [],
            "parameters": {"prompt": "test", "output_format": "png"}, "output": str(self.root),
            "usagePath": str(self.root / "usage-multiple.json"),
            "endpoint": {"protocol": "google", "baseUrl": "https://example.invalid/v1beta", "model": "fixture",
                         "keyEnv": "CUSTOM_GEMINI_KEY"},
        }
        first = self.png("first-output.png")
        second = self.png("second-output.png", "blue")

        def run(command, **kwargs):
            self.assertEqual(command[command.index("--protocol") + 1], "google")
            (self.root / "image-result.json").write_text(json.dumps({"outputs": [first.name, second.name]}), encoding="utf-8")
            return Mock(returncode=0)

        with patch.object(worker.subprocess, "run", side_effect=run):
            result = worker.execute(job)
        self.assertEqual([asset["mime"] for asset in result["assets"]], ["image/png", "image/png"])


if __name__ == "__main__":
    unittest.main()
