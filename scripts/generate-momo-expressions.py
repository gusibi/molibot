#!/usr/bin/env python3
"""Export Momo expression cut-outs for the Agent home stage (requires Pillow).

The expression list lives in apps/desktop/src/lib/chat/homePresence.ts
(MOMO_EXPRESSIONS); this script reads it so exports and UI cannot drift apart.

Source artwork is apps/desktop/logos-src. Half of the set is painted on an
opaque white square while the stage sits on the desk surface, so the backdrop
is removed from the border inward (flood from near-white border pixels only, so
artwork inside a badge is never reached) and the anti-aliased rim is feathered.
Artwork that already has a transparent surround is exported untouched.
"""
import re
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1] / "apps/desktop"
EXPORT_DIR = ROOT / "public/momo"
SOURCE_DIR = ROOT / "logos-src"
EXPRESSIONS_FILE = ROOT / "src/lib/chat/homePresence.ts"
EXPRESSIONS = re.compile(r"export const MOMO_EXPRESSIONS = \[(.*?)\] as const;", re.S)
MAX_SIDE = 640
SEED = (255, 0, 255, 0)
# Backdrops range from pure white to warm cream, so seed on any near-white border pixel.
SEED_MIN_CHANNEL = 225
FLOOD_TOLERANCE = 100
RIM_MIN_CHANNEL = 170


def min_channel(image):
    red, green, blue, _alpha = image.split()
    return ImageChops.darker(ImageChops.darker(red, green), blue)


def expression_ids():
    match = EXPRESSIONS.search(EXPRESSIONS_FILE.read_text())
    if not match:
        raise SystemExit(f"MOMO_EXPRESSIONS not found in {EXPRESSIONS_FILE}")
    return re.findall(r'"([^"]+)"', match.group(1))


def has_opaque_border(image):
    alpha = image.getchannel("A")
    width, height = image.size
    return any(alpha.getpixel(point) > 0 for point in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)))


def remove_backdrop(image):
    width, height = image.size
    flooded = image.copy()
    for x in range(width):
        for y in (0, height - 1):
            if min(flooded.getpixel((x, y))[:3]) >= SEED_MIN_CHANNEL:
                ImageDraw.floodfill(flooded, (x, y), SEED, thresh=FLOOD_TOLERANCE)
    for y in range(height):
        for x in (0, width - 1):
            if min(flooded.getpixel((x, y))[:3]) >= SEED_MIN_CHANNEL:
                ImageDraw.floodfill(flooded, (x, y), SEED, thresh=FLOOD_TOLERANCE)
    # Flooded pixels carry the sentinel exactly: red and blue at max, green and alpha at zero.
    red, green, blue, alpha = flooded.split()
    backdrop = ImageChops.multiply(red, ImageChops.multiply(blue, ImageChops.multiply(ImageChops.invert(green), ImageChops.invert(alpha))))
    backdrop = backdrop.point(lambda value: 255 if value == 255 else 0)
    # Rim pixels are artwork anti-aliased against the old white backdrop: keep
    # their colour, lower their alpha in proportion to how white they are.
    rim = ImageChops.subtract(backdrop.filter(ImageFilter.MaxFilter(5)), backdrop)
    whitening = min_channel(image).point(lambda value: max(0, min(255, round((value - RIM_MIN_CHANNEL) * 255 / (255 - RIM_MIN_CHANNEL)))))
    reduced_alpha = ImageChops.subtract(image.getchannel("A"), ImageChops.multiply(whitening.point(lambda value: value * 85 // 100), rim))
    result = image.copy()
    result.putalpha(reduced_alpha)
    return Image.composite(result, Image.new("RGBA", image.size, (0, 0, 0, 0)), ImageChops.invert(backdrop))


def export_expression(source, path):
    image = Image.open(source).convert("RGBA")
    if has_opaque_border(image):
        image = remove_backdrop(image)
    image = image.crop(image.getchannel("A").getbbox())
    scale = MAX_SIDE / max(image.size)
    if scale < 1:
        image = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    image.save(path, "WEBP", quality=88, method=6)


def source_for(expression):
    matches = [path for path in SOURCE_DIR.glob("*.png") if path.stem.split("-", 1)[1] == expression]
    if len(matches) != 1:
        raise SystemExit(f"expected one source artwork for {expression}, found {len(matches)}")
    return matches[0]


def main():
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    for expression in expression_ids():
        export_expression(source_for(expression), EXPORT_DIR / f"{expression}.webp")


if __name__ == "__main__":
    main()
