import io
import unittest

from PIL import Image

from dsh_bot_runtime.skills.image_generation.output_inspector import (
    ImageOutputInspectionError,
    inspect_image,
)


def encoded(image: Image.Image, format_name: str) -> bytes:
    output = io.BytesIO()
    image.save(output, format=format_name)
    return output.getvalue()


class ImageOutputInspectorTests(unittest.TestCase):
    def test_reports_dimensions_alpha_and_animation_without_paths(self):
        png = encoded(Image.new("RGBA", (3, 2), (1, 2, 3, 120)), "PNG")
        facts = inspect_image(png)
        self.assertEqual(facts["mime"], "image/png")
        self.assertEqual(facts["width"], 3)
        self.assertEqual(facts["height"], 2)
        self.assertTrue(facts["alpha"])
        self.assertFalse(facts["animated"])
        first = Image.new("RGB", (2, 2), (0, 0, 0))
        second = Image.new("RGB", (2, 2), (255, 0, 0))
        output = io.BytesIO()
        first.save(output, format="GIF", save_all=True, append_images=[second], duration=10, loop=0)
        facts = inspect_image(output.getvalue())
        self.assertTrue(facts["animated"])
        self.assertEqual(facts["frames"], 2)

    def test_rejects_empty_or_corrupt_output(self):
        with self.assertRaises(ImageOutputInspectionError):
            inspect_image(b"")
        with self.assertRaises(ImageOutputInspectionError):
            inspect_image(b"\x89PNG\r\n\x1a\ncorrupt")


if __name__ == "__main__":
    unittest.main()
