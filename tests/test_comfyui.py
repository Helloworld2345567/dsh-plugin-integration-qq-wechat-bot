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


class _BatchSession:
    def __init__(self, count=3):
        self.count = count
        self.posted = None

    def request(self, method, url, **kwargs):
        if method == "POST":
            self.posted = kwargs.get("json")
            return _Response(200, {"prompt_id": "batch-fixture-id"})
        images = [{"filename": f"fixture-{index}.png", "subfolder": "", "type": "output"}
                  for index in range(self.count)]
        return _Response(200, {"batch-fixture-id": {"outputs": {"1": {"images": images}}}})

    def get(self, url, **kwargs):
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

    def test_prompt_injection_updates_effective_impact_wildcard_text(self):
        """Impact Pack executes populated_text, not wildcard_text, in reproduce mode."""
        workflow = {"prompt": {
            "3": {
                "class_type": "ImpactWildcardProcessor",
                "_meta": {"title": "POSITIVE"},
                "inputs": {
                    "wildcard_text": "old prompt",
                    "populated_text": "old prompt",
                    "mode": "reproduce",
                    "seed": 24,
                },
            },
            "4": {
                "class_type": "ImpactWildcardProcessor",
                "_meta": {"title": "NEGATIVE"},
                "inputs": {
                    "wildcard_text": "old negative",
                    "populated_text": "old negative",
                    "mode": "reproduce",
                    "seed": 24,
                },
            },
        }}

        result = image_api._inject_comfy_prompt(workflow, "Hatsune Miku with blue twin-tails")

        positive = result["prompt"]["3"]["inputs"]
        self.assertEqual(positive["wildcard_text"], "Hatsune Miku with blue twin-tails")
        self.assertEqual(positive["populated_text"], "Hatsune Miku with blue twin-tails")
        self.assertEqual(result["prompt"]["4"]["inputs"]["populated_text"], "old negative")

    def test_prompt_injection_updates_primitive_string_prompt_source(self):
        """Local API workflows may feed CLIP from a PrimitiveStringMultiline value."""
        workflow = {"prompt": {
            "973": {
                "class_type": "PrimitiveStringMultiline",
                "_meta": {"title": "Prompt"},
                "inputs": {"value": "stale workflow prompt"},
            },
            "707:696": {
                "class_type": "CLIPTextEncode",
                "_meta": {"title": "Encode Prompt"},
                "inputs": {"text": ["973", 0]},
            },
        }}

        result = image_api._inject_comfy_prompt(workflow, "Hatsune Miku with blue twin-tails")

        self.assertEqual(result["prompt"]["973"]["inputs"]["value"], "Hatsune Miku with blue twin-tails")

    def test_prompt_injection_updates_primitive_prompt_instead_of_lora_metadata(self):
        """Krea API workflows expose the effective prompt through PrimitiveString.value."""
        workflow = {
            "1001": {
                "class_type": "LoraLoader",
                "_meta": {"title": "LoRA metadata"},
                "inputs": {"text": "keep this metadata"},
            },
            "973": {
                "class_type": "PrimitiveStringMultiline",
                "_meta": {"title": "Prompt"},
                "inputs": {"value": "old prompt"},
            },
        }

        result = image_api._inject_comfy_prompt(workflow, "a red fox in a snowy forest")

        self.assertEqual(result["973"]["inputs"]["value"], "a red fox in a snowy forest")
        self.assertEqual(result["1001"]["inputs"]["text"], "keep this metadata")

    def test_comfy_options_update_size_picker_resolution_and_batch(self):
        workflow = {"707:837": {
            "class_type": "SizePicker",
            "_meta": {"title": "Size Picker"},
            "inputs": {"width_override": 720, "height_override": 1024, "batch_size": 1},
        }}

        result = comfyui_image_api._inject_comfy_options(workflow, width=640, height=768, batch_size=3)

        self.assertEqual(result["707:837"]["inputs"], {"width_override": 640, "height_override": 768, "batch_size": 3})

    def test_comfy_options_update_krea_easy_int_controls_and_return_batch_pngs(self):
        workflow = {"prompt": {
            "45": {"class_type": "easy int", "_meta": {"title": "Width"}, "inputs": {"value": 1024}},
            "48": {"class_type": "easy int", "_meta": {"title": "Height"}, "inputs": {"value": 1024}},
            "51": {"class_type": "easy int", "_meta": {"title": "Batch Size"}, "inputs": {"value": 1}},
            "55": {"class_type": "EmptyLatentImage", "inputs": {"width": ["45", 0], "height": ["48", 0], "batch_size": ["51", 0]}},
            "1": {"class_type": "CLIPTextEncode", "_meta": {"title": "Positive Prompt"}, "inputs": {"text": "old"}},
        }}
        session = _BatchSession()

        with tempfile.TemporaryDirectory() as root:
            workflow_path = Path(root) / "workflow.json"
            workflow_path.write_text(json.dumps(workflow), encoding="utf-8")
            outputs = comfyui_image_api._comfy_image_records(
                session, "http://127.0.0.1:8188", workflow_path, "new",
                Path(root), "fixture", timeout=2, output_format="png", output_compression=None,
                width=640, height=768, batch_size=3,
            )

        self.assertEqual([path.suffix for path in outputs], [".png", ".png", ".png"])
        self.assertEqual(session.posted["prompt"]["45"]["inputs"]["value"], 640)
        self.assertEqual(session.posted["prompt"]["48"]["inputs"]["value"], 768)
        self.assertEqual(session.posted["prompt"]["51"]["inputs"]["value"], 3)

    def test_comfy_output_format_jpg_is_materialized_as_jpeg(self):
        workflow = {"prompt": {"1": {"class_type": "CLIPTextEncode", "inputs": {"text": "old"}}}}
        from PIL import Image
        import io
        encoded = io.BytesIO()
        Image.new("RGB", (2, 2), "red").save(encoded, format="PNG")
        class _JpegSession(_Session):
            def get(self, url, **kwargs):
                return _Response(200, content=encoded.getvalue())
        with tempfile.TemporaryDirectory() as root:
            workflow_path = Path(root) / "workflow.json"
            workflow_path.write_text(json.dumps(workflow), encoding="utf-8")
            outputs = comfyui_image_api._comfy_image_records(
                _JpegSession(), "http://127.0.0.1:8188", workflow_path, "new", Path(root), "fixture",
                timeout=2, output_format="jpg", output_compression=None,
            )
        self.assertEqual(outputs[0].suffix, ".jpg")

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
            args = image_api.parse_args(["--protocol", "comfyui", "generate", "--prompt", "test",
                                         "--width", "640", "--height", "768", "--n", "3", "--output-format", "png"])
            self.assertEqual((args.width, args.height, args.n, args.output_format), (640, 768, 3, "png"))

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
