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
            "30": {"class_type": "SaveImage", "inputs": {}},
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


if __name__ == "__main__":
    unittest.main()
