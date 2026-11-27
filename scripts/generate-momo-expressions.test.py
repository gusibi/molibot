"""Momo expression exports must be background-free, bounded and reproducible."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from PIL import Image

# The generator's filename is hyphenated like the other scripts, so load it by path.
_spec = importlib.util.spec_from_file_location("generate_momo_expressions", Path(__file__).with_name("generate-momo-expressions.py"))
generator = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(generator)


class MomoExpressionExportTest(unittest.TestCase):
    def test_export_directory_matches_the_expression_list(self):
        exported = sorted(path.name for path in generator.EXPORT_DIR.glob("*.webp"))
        self.assertEqual(exported, sorted(f"{expression}.webp" for expression in generator.expression_ids()))

    def test_every_expression_is_a_bounded_cutout(self):
        for expression in generator.expression_ids():
            with self.subTest(expression=expression):
                image = Image.open(generator.EXPORT_DIR / f"{expression}.webp").convert("RGBA")
                self.assertEqual(max(image.size), generator.MAX_SIDE)
                width, height = image.size
                alpha = image.getchannel("A")
                for point in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)):
                    self.assertEqual(alpha.getpixel(point), 0, "surround is not transparent")
                histogram = alpha.histogram()
                covered = sum(histogram[250:]) / (width * height)
                self.assertGreater(covered, 0.12, "artwork was erased")
                self.assertLess(covered, 0.92, "backdrop was kept")

    def test_exports_match_the_generator_output(self):
        with tempfile.TemporaryDirectory() as directory:
            for expression in generator.expression_ids():
                with self.subTest(expression=expression):
                    target = Path(directory) / f"{expression}.webp"
                    generator.export_expression(generator.source_for(expression), target)
                    self.assertEqual(target.read_bytes(), (generator.EXPORT_DIR / f"{expression}.webp").read_bytes(), "export was edited by hand")


if __name__ == "__main__":
    unittest.main()
