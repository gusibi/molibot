"""System icon exports must preserve the supplied artwork and alpha channel."""
import json
import unittest
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1] / "apps/desktop"


class LogoTransparencyTest(unittest.TestCase):
    def test_system_exports_preserve_original_artwork_without_background_or_mask(self):
        for logo in json.loads((ROOT / "src/lib/stores/appLogos.json").read_text()):
            with self.subTest(logo=logo["id"]):
                original = Image.open(ROOT / "public" / logo["src"].lstrip("/")).convert("RGBA")
                for directory, suffix, canvas_size, artwork_size in [
                    ("public/app-icons", ".png", 512, 512),
                    ("src-tauri/icons/logos", "-tray.png", 44, 36),
                ]:
                    artwork = ImageOps.contain(original, (artwork_size, artwork_size), Image.Resampling.LANCZOS)
                    expected = Image.new("RGBA", (canvas_size, canvas_size))
                    # Paste copies every RGBA pixel, including semi-transparent edges.
                    expected.paste(artwork, ((canvas_size - artwork.width) // 2, (canvas_size - artwork.height) // 2))
                    actual = Image.open(ROOT / directory / (logo["id"] + suffix)).convert("RGBA")
                    self.assertEqual(actual.size, expected.size)
                    self.assertTrue(actual.tobytes() == expected.tobytes(), f'{logo["id"]}{suffix}: artwork or transparency changed')


if __name__ == "__main__":
    unittest.main()
