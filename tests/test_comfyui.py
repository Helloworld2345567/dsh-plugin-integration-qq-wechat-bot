import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from dsh_bot_runtime.skills.image_generation import image_api
from dsh_bot_runtime.skills.image_generation.comfyui import image_api as comfyui_image_api
from dsh_bot_runtime.skills.image_generation.openai import image_api as openai_image_api


class _Response:
    def __init__(self, status_code, payload=None, content=b""):
        self.status_code = status_code
        self._payload = payload
        self.content = content

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class _Session:
    def __init__(self):
        self.get_calls = []

    def request(self, method, url, **kwargs):
        if method == "POST":
            return _Response(200, {"prompt_id": "fixture-id"})
        return _Response(200, {"fixture-id": {"outputs": {"1": {"images": [{"filename": "fixture.png", "subfolder": "", "type": "output"}]}}}})

    def get(self, url, **kwargs):
        self.get_calls.append((url, kwargs))
        return _Response(200, content=b"\x89PNG\r\n\x1a\n" + b"fixture")


class ComfyUiTests(unittest.TestCase):
    def test_dispatcher_selects_isolated_service_adapters(self):
        self.assertIs(image_api._adapter("openai"), openai_image_api)
        self.assertIs(image_api._adapter("comfyui"), comfyui_image_api)
        self.assertEqual(image_api._protocol(["generate"]), "openai")
        self.assertEqual(image_api._protocol(["--protocol", "comfyui", "generate"]), "comfyui")
        with self.assertRaises(ValueError):
            image_api._adapter("unknown")

    def test_local_http_endpoint_and_workflow_prompt_injection(self):
        self.assertEqual(image_api.normalize_comfyui_base_url("http://127.0.0.1:8188/"), "http://127.0.0.1:8188")
        self.assertRaises(ValueError, image_api.normalize_comfyui_base_url, "http://192.168.1.9:8188")
        workflow = {"prompt": {"1": {"class_type": "CLIPTextEncode", "inputs": {"text": "old"}}}}
        result = image_api._inject_comfy_prompt(workflow, "new prompt")
        self.assertEqual(result["prompt"]["1"]["inputs"]["text"], "new prompt")

    def test_protocol_and_comfyui_configuration_ignore_environment(self):
        retired = {"BOT_IMAGE_PROTOCOL": "comfyui", "BOT_IMAGE_MODEL": "ignored-model",
                   "BOT_COMFYUI_BASE_URL": "https://ignored.example", "BOT_COMFYUI_WORKFLOW": "ignored.json",
                   "BOT_COMFYUI_WORKFLOW_PATH": "ignored-path.json", "COMFYUI_ROOT": "ignored-root"}
        with patch.dict(os.environ, retired, clear=True):
            self.assertEqual(image_api._protocol(["generate"]), "openai")
            args = image_api.parse_args(["--protocol", "comfyui", "generate", "--prompt", "test"])
            self.assertEqual(args.base_url, comfyui_image_api.DEFAULT_BASE_URL)
            self.assertEqual(args.model, comfyui_image_api.DEFAULT_MODEL)
            self.assertIsNone(args.workflow)
            args = image_api.parse_args(["--protocol", "comfyui", "generate", "--prompt", "test",
                                         "--base-url", "https://explicit.example", "--model", "explicit-model", "--workflow", "explicit.json"])
            self.assertEqual((args.base_url, args.model, args.workflow), ("https://explicit.example", "explicit-model", "explicit.json"))

    def test_history_images_are_downloaded_and_recorded(self):
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            workflow = root_path / "workflow.json"
            workflow.write_text(json.dumps({"prompt": {"1": {"class_type": "CLIPTextEncode", "inputs": {"text": "old"}}}}), encoding="utf-8")
            outputs = image_api._comfy_image_records(_Session(), "http://127.0.0.1:8188", workflow, "new", root_path, "fixture", timeout=2, output_format="png", output_compression=None)
            self.assertEqual(len(outputs), 1)
            self.assertEqual(outputs[0].suffix, ".png")


if __name__ == "__main__":
    unittest.main()
