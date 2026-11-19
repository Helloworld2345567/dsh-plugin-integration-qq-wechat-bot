import unittest

from dsh_bot_runtime.skills.image_generation.comfyui.workflow_inspector import (
    WorkflowInspectionError,
    inspect_workflow,
)


class WorkflowInspectorTests(unittest.TestCase):
    def test_reports_only_stable_workflow_capabilities(self):
        result = inspect_workflow({"prompt": {
            "973": {
                "class_type": "PrimitiveStringMultiline",
                "_meta": {"title": "Prompt"},
                "inputs": {"value": "old"},
            },
            "10": {
                "class_type": "LoadImage",
                "inputs": {"image": "reference.png"},
            },
            "20": {
                "class_type": "SizePicker",
                "inputs": {"width_override": 640, "height_override": 768, "batch_size": 1},
            },
            "30": {"class_type": "SaveImage", "inputs": {"images": ["10", 0]}},
        }})
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["nodeCount"], 4)
        self.assertEqual(result["outputNodeCount"], 1)
        self.assertEqual(result["capabilities"]["promptFields"], ["value"])
        self.assertTrue(result["capabilities"]["prompt"])
        self.assertTrue(result["capabilities"]["referenceEdit"])
        self.assertEqual(result["capabilities"]["resolution"], {"width": True, "height": True, "paired": True})
        self.assertTrue(result["capabilities"]["batch"])
        self.assertEqual(result["capabilities"]["outputFormats"], ["png", "jpeg"])

    def test_ignores_negative_prompt_and_rejects_non_object(self):
        result = inspect_workflow({"1": {
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "Negative Prompt"},
            "inputs": {"text": "avoid"},
        }})
        self.assertFalse(result["capabilities"]["prompt"])
        with self.assertRaises(WorkflowInspectionError):
            inspect_workflow([])

    def test_reports_resolution_preset_and_chinese_batch_control(self):
        result = inspect_workflow({"76": {
            "class_type": "ResolutionPreset",
            "inputs": {"resolution_json": '{"version":1,"width":1024,"height":1600}'},
        }, "207": {
            "class_type": "PrimitiveInt",
            "_meta": {"title": "批量大小"},
            "inputs": {"value": 1},
        }})
        self.assertEqual(result["capabilities"]["resolution"], {"width": True, "height": True, "paired": True})
        self.assertTrue(result["capabilities"]["batch"])

    def test_reference_must_reach_the_pixels_of_an_image_output(self):
        graph = {
            "ref": {"class_type": "LoadImage", "inputs": {"image": "reference.png"}},
            "unused": {"class_type": "ComfySwitchNode", "inputs": {"on_false": ["ref", 0]}},
            "gen": {"class_type": "EmptyImage", "inputs": {}},
            "save": {"class_type": "ConditionalSaveImage", "inputs": {"images": ["gen", 0], "metadata": ["ref", 0]}},
            "show": {"class_type": "PreviewImage", "inputs": {"images": ["save", 0]}},
        }
        self.assertFalse(inspect_workflow(graph)["capabilities"]["referenceEdit"])
        for name in ("SaveImage", "PreviewImage", "Image Saver Simple", "ConditionalSaveImage"):
            with self.subTest(output=name):
                graph["save"] = {"class_type": name, "inputs": {"images": ["unused", 0]}}
                self.assertTrue(inspect_workflow(graph)["capabilities"]["referenceEdit"])

    def test_two_distinct_connected_reference_slots_are_ambiguous(self):
        graph = {
            "a": {"class_type": "LoadImage", "inputs": {"image": "one.png"}},
            "b": {"class_type": "LoadImage", "inputs": {"image": "two.png"}},
            "mix": {"class_type": "ImageBlend", "inputs": {"image1": ["a", 0], "image2": ["b", 0]}},
            "save": {"class_type": "SaveImage", "inputs": {"images": ["mix", 0]}},
        }
        self.assertFalse(inspect_workflow(graph)["capabilities"]["referenceEdit"])


if __name__ == "__main__":
    unittest.main()
